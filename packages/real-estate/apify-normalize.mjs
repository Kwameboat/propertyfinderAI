/**
 * Map Apify actor output → listing input shape for Supabase ingest.
 */

import { createHash } from "node:crypto";
import { normalizeListingRow } from "./scrapers/normalize.mjs";

function idFromUrl(url = "") {
  const match = String(url).match(/details-(\d+)/i) || String(url).match(/(\d{6,})/);
  if (match?.[1]) return match[1];
  return createHash("sha256").update(String(url)).digest("hex").slice(0, 16);
}

function splitAddress(fullAddress = "") {
  const parts = String(fullAddress)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    emirate: parts[0] || "Dubai",
    community: parts[1] || "",
    sub_community: parts[2] || "",
    building: parts[3] || ""
  };
}

function txFromPurpose(purpose = "") {
  const p = String(purpose).toLowerCase();
  if (p.includes("rent")) return "rent";
  if (p.includes("off") && p.includes("plan")) return "off_plan";
  return "sale";
}

function parseBayutLocation(item = {}) {
  if (Array.isArray(item.location) && item.location.length) {
    const byLevel = Object.fromEntries(item.location.map((l) => [l.level, l.name]));
    return {
      emirate: byLevel[1] || "Dubai",
      community: byLevel[2] || "",
      sub_community: byLevel[3] || "",
      building: byLevel[4] || ""
    };
  }
  return splitAddress(item.fullAddress || item.address || "");
}

export function normalizeApifyBayutItem(item = {}) {
  const sourceUrl =
    item.propertyUrl ||
    item.url ||
    item.link ||
    item.listingUrl ||
    (item.slug ? `https://www.bayut.com/property/details-${item.externalID || item.id}.html` : "");
  let externalId = String(
    item.externalID ||
      item.external_id ||
      item.externalId ||
      item.listingId ||
      item.id ||
      item.objectID ||
      ""
  ).trim();
  if (!externalId && sourceUrl) externalId = idFromUrl(sourceUrl);
  if (!externalId) return null;

  const addr = parseBayutLocation(item);
  const purpose = item.purpose || item.category?.[0]?.slug || "for-rent";
  const transaction_type = txFromPurpose(purpose);
  const images = [];
  if (item.coverImageUrl) images.push(item.coverImageUrl);
  if (item.coverPhoto?.url) images.push(item.coverPhoto.url);
  if (Array.isArray(item.images)) images.push(...item.images.filter(Boolean));
  if (Array.isArray(item.photoUrls)) images.push(...item.photoUrls.filter(Boolean));

  const phone =
    item.phoneNumber?.mobile ||
    item.phoneNumber?.phone ||
    item.phoneNumber?.whatsapp ||
    item.agentPhone ||
    "";

  return normalizeListingRow({
    source: "bayut",
    external_id: externalId,
    source_url: sourceUrl || `https://www.bayut.com/property/details-${externalId}.html`,
    transaction_type,
    property_type: String(item.propertyType || item.category?.[1]?.slug || "apartment").toLowerCase(),
    beds: item.rooms ?? item.bedrooms ?? null,
    baths: item.baths ?? item.bathrooms ?? null,
    emirate: addr.emirate,
    community: addr.community,
    sub_community: addr.sub_community,
    building: addr.building,
    price_aed: Number(item.price || 0),
    price_period: transaction_type === "rent" ? item.rentFrequency || "yearly" : "total",
    furnished: /furnished/i.test(String(item.furnishingStatus || ""))
      ? !/unfurnished/i.test(String(item.furnishingStatus || ""))
      : null,
    amenities: item.amenities || [],
    images: [...new Set(images)],
    description: item.title || item.description || item.priceFormatted || "",
    agent_name: item.agentName || item.contactName || "",
    agent_phone: phone,
    agency_name: item.agencyName || "",
    rera_permit: item.permitNumber || item.reraPermit || "",
    lat: item.geography?.lat ?? item.lat ?? null,
    lng: item.geography?.lng ?? item.lng ?? null
  });
}

export function normalizeApifyPropertyFinderItem(item = {}) {
  const externalId = String(item.id || item.reference || "").trim();
  if (!externalId) return null;

  const purpose = String(item.purpose || "rent").toLowerCase();
  const transaction_type = purpose === "buy" || purpose === "sale" ? "sale" : "rent";
  const communityParts = String(item.community || item.address || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const images = [];
  if (item.image) images.push(item.image);
  if (Array.isArray(item.images)) images.push(...item.images.filter(Boolean));

  return normalizeListingRow({
    source: "propertyfinder",
    external_id: externalId,
    source_url: item.url || "https://www.propertyfinder.ae/",
    transaction_type,
    property_type: String(item.property_type || "apartment").toLowerCase(),
    beds: item.bedrooms != null && item.bedrooms !== "" ? Number(item.bedrooms) : null,
    baths: item.bathrooms != null && item.bathrooms !== "" ? Number(item.bathrooms) : null,
    emirate: communityParts[0] || "Dubai",
    community: communityParts[1] || item.location_name || "",
    sub_community: communityParts[2] || "",
    building: item.location_name || "",
    price_aed: Number(item.price || 0),
    price_period:
      transaction_type === "rent"
        ? item.price_period === "yearly" || item.price_period === "sell"
          ? "yearly"
          : item.price_period || "yearly"
        : "total",
    furnished: /^yes$/i.test(String(item.furnished || ""))
      ? true
      : /^no$/i.test(String(item.furnished || ""))
        ? false
        : null,
    amenities: item.amenities || [],
    images: [...new Set(images)],
    description: item.title || "",
    agent_name: item.agent_name || "",
    agent_phone: item.contact_phone || item.broker_phone || item.contact_whatsapp || "",
    agency_name: item.broker_name || "",
    rera_permit: item.rera || "",
    lat: item.latitude ?? null,
    lng: item.longitude ?? null
  });
}

export function normalizeApifyDubizzleItem(item = {}) {
  const sourceUrl = item.url || item.listing_url || item.link || "";
  let externalId = String(item.id || item.listing_id || item.objectID || item.external_id || "").trim();
  if (!externalId && sourceUrl) externalId = idFromUrl(sourceUrl);
  if (!externalId) return null;

  const purpose = String(item.purpose || item.category || "rent").toLowerCase();
  const transaction_type = purpose.includes("rent") ? "rent" : "sale";
  const images = [];
  if (item.cover_photo) images.push(item.cover_photo);
  if (item.image) images.push(item.image);
  if (Array.isArray(item.images)) images.push(...item.images.filter(Boolean));
  if (Array.isArray(item.photos)) images.push(...item.photos.filter(Boolean));

  const location = item.location || item.area || item.community || "";
  const emirate = item.emirate || item.city || String(location).split(",")[0]?.trim() || "Dubai";

  return normalizeListingRow({
    source: "dubizzle",
    external_id: externalId,
    source_url: sourceUrl || `https://dubai.dubizzle.com/`,
    transaction_type,
    property_type: String(item.property_type || item.type || "apartment").toLowerCase(),
    beds: item.bedrooms ?? item.beds ?? item.rooms ?? null,
    baths: item.bathrooms ?? item.baths ?? null,
    emirate,
    community: item.community || item.neighborhood || String(location).split(",")[1]?.trim() || "",
    price_aed: Number(item.price || item.price_aed || 0),
    price_period: transaction_type === "rent" ? item.price_period || "yearly" : "total",
    furnished: /^yes|furnished/i.test(String(item.furnished || ""))
      ? !/^no|unfurnished/i.test(String(item.furnished || ""))
      : null,
    amenities: item.amenities || [],
    images: [...new Set(images)],
    description: item.title || item.name || item.description || "",
    agent_name: item.agent_name || item.agent?.name || "",
    agent_phone: item.agent_phone || item.contact_phone || item.phone || "",
    agency_name: item.agency_name || item.broker_name || item.agency || "",
    lat: item.latitude ?? item.lat ?? null,
    lng: item.longitude ?? item.lng ?? null
  });
}

export function normalizeApifyItems(source, items = []) {
  const fn =
    source === "bayut" || source === "bayut_apify"
      ? normalizeApifyBayutItem
      : source === "propertyfinder" || source === "propertyfinder_apify"
        ? normalizeApifyPropertyFinderItem
        : source === "dubizzle" || source === "dubizzle_apify"
          ? normalizeApifyDubizzleItem
          : null;
  if (!fn) return [];
  return items.map(fn).filter(Boolean);
}
