/**
 * Direct landlord/agent listings from the PropertyFinder Gh Ghana PWA.
 * Source `fie_direct` is searchable with Ghana portals but is not scraped or stale-cleaned.
 */

import { randomUUID } from "node:crypto";
import { upsertListing } from "../hub-db/real-estate.mjs";
import { clusterKey } from "./cluster.mjs";
import { prepareListing } from "./ingest.mjs";
import { GHANA_CITIES, GHANA_DIRECT_SOURCE, isGhanaMarket } from "./market.mjs";
import { normalizeGhanaPhone } from "./qualification.mjs";
import { isSupabaseEnabled, batchSyncListingsToSupabase } from "./supabase.mjs";

export const OWNER_PROPERTY_TYPES = [
  "apartment",
  "house",
  "self-contain",
  "chamber-and-hall",
  "compound",
  "single-room",
  "studio",
  "villa",
  "townhouse"
];

const MAX_PHOTOS = 5;
const MAX_PRICE_GHS = 50_000_000;

function cleanText(value, max) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parsePrice(value) {
  const n = Number(String(value || "").replace(/,/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseBeds(value) {
  if (value == null || value === "") return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 20) return null;
  return Math.round(n);
}

function parseTransactionType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "sale" || raw === "buy" || raw === "for sale") return "sale";
  if (raw === "rent" || raw === "rental" || raw === "for rent") return "rent";
  return "";
}

function parsePropertyType(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (OWNER_PROPERTY_TYPES.includes(raw)) return raw;
  if (/self/.test(raw)) return "self-contain";
  if (/chamber/.test(raw)) return "chamber-and-hall";
  if (/single/.test(raw)) return "single-room";
  if (raw) return cleanText(raw, 40) || "apartment";
  return "apartment";
}

function parseCity(value) {
  const raw = cleanText(value, 40);
  if (!raw) return "";
  const match = GHANA_CITIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  return match || raw;
}

export function sanitizeOwnerPhotoUrls(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/[\n,]+/)
        .map((s) => s.trim());
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const url = String(raw || "").trim();
    if (!url || seen.has(url)) continue;
    const local = /^\/uploads\/owner-listings\/[A-Za-z0-9/_-]+\.(?:png|jpe?g|webp)$/i.test(url);
    const remote = /^https?:\/\/[^\s<>"']{8,500}$/i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
    if (!local && !remote) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

function truthyConsent(value) {
  return value === true || value === "on" || value === "true" || value === "1" || value === "yes";
}

export function buildOwnerListing(input = {}) {
  if (!isGhanaMarket()) {
    return { ok: false, error: "Direct listing is available on PropertyFinder Gh Ghana only" };
  }
  if (!truthyConsent(input.consent)) {
    return { ok: false, error: "Please confirm you have the right to list this property" };
  }

  const name = cleanText(input.name || input.agent_name, 80);
  const phone = normalizeGhanaPhone(input.phone || input.agent_phone);
  const city = parseCity(input.city || input.emirate);
  const area = cleanText(input.area || input.community, 80);
  const transactionType = parseTransactionType(input.transaction_type || input.purpose);
  const propertyType = parsePropertyType(input.property_type);
  const beds = parseBeds(input.beds);
  const baths = input.baths === "" || input.baths == null ? null : parseBeds(input.baths);
  const price = parsePrice(input.price || input.price_aed);
  const description = cleanText(input.description, 2000);
  const role = String(input.role || "landlord").toLowerCase() === "agent" ? "agent" : "landlord";
  const agency = cleanText(input.agency_name || input.agency, 80);
  const photos = sanitizeOwnerPhotoUrls(input.photos || input.photoUrls || input.photo_urls);

  if (name.length < 2) return { ok: false, error: "Enter your name" };
  if (!/^\+233\d{9}$/.test(phone)) return { ok: false, error: "Enter a valid Ghana phone number" };
  if (city.length < 2) return { ok: false, error: "Enter the city" };
  if (area.length < 2) return { ok: false, error: "Enter the area or neighbourhood" };
  if (!transactionType) return { ok: false, error: "Choose rent or buy" };
  if (beds == null) return { ok: false, error: "Enter the number of bedrooms" };
  if (baths === null && input.baths != null && input.baths !== "") {
    return { ok: false, error: "Enter a valid number of bathrooms" };
  }
  if (!(price > 0) || price > MAX_PRICE_GHS) return { ok: false, error: "Enter a valid price in GH₵" };

  const externalId = `own-${randomUUID()}`;
  const row = {
    source: GHANA_DIRECT_SOURCE,
    external_id: externalId,
    source_url: "",
    transaction_type: transactionType,
    property_type: propertyType,
    beds,
    baths: baths == null ? null : baths,
    emirate: city,
    community: area,
    price_aed: price,
    price_period: transactionType === "rent" ? "monthly" : "total",
    furnished: false,
    images: photos,
    description: description || `${propertyType.replace(/-/g, " ")} in ${area}, ${city}`,
    agent_name: name,
    agent_phone: phone,
    agency_name: agency || (role === "agent" ? "Agent listing" : "Landlord listing"),
    listing_status: "available"
  };

  return { ok: true, row };
}

export async function submitOwnerListing(db, input = {}) {
  const built = buildOwnerListing(input);
  if (!built.ok) return built;
  const row = { ...built.row, cluster_id: clusterKey(built.row), scraped_at: Date.now(), is_active: true };
  const listing = upsertListing(db, row);
  if (isSupabaseEnabled()) {
    const prepared = prepareListing(row);
    if (prepared) await batchSyncListingsToSupabase([prepared]);
  }
  return { ok: true, listing, source: GHANA_DIRECT_SOURCE };
}
