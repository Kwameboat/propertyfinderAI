/**
 * Normalize listing rows for chat cards — same shape as DB ingest + quality gates.
 */

import { prepareListing } from "./ingest.mjs";
import { mapSupabaseListing } from "./supabase.mjs";
import { isValidPortalListingImage, listingHasRealPhotos } from "./listing-images.mjs";
import { inferEmirateFromListing } from "./emirate-scope.mjs";
import { isGhanaMarket } from "./market.mjs";

const PORTAL_HOST = /propertyfinder\.ae|bayut\.com|dubizzle\.com/i;

export function inferBedsFromText(text = "") {
  const t = String(text || "");
  const m =
    t.match(/(\d+)\s*(?:bhk|br|bed|bedroom)s?\b/i) ||
    t.match(/\b(?:bhk|br)\s*(\d+)\b/i) ||
    t.match(/\b(\d+)bhk\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function inferBedsFromListing(listing = {}) {
  if (listing.beds != null && listing.beds !== "") return Number(listing.beds);
  const fromDesc = inferBedsFromText(listing.description || listing.title || "");
  return fromDesc;
}

export function bedsDisplayLabel(beds, propertyType = "") {
  if (beds === 0 || String(propertyType).toLowerCase() === "studio") return "Studio";
  if (beds != null && beds !== "" && Number.isFinite(Number(beds))) return `${Number(beds)}BR`;
  return null;
}

export function formatListingTitle(listing = {}, criteria = {}) {
  const beds = inferBedsFromListing(listing) ?? criteria.beds;
  const label = bedsDisplayLabel(beds, listing.property_type);
  const type = String(listing.property_type || "apartment").replace(/_/g, " ");
  const loc = listing.community || listing.emirate || (isGhanaMarket() ? "Ghana" : "UAE");
  if (label) return `${label} ${type} · ${loc}`;
  return `${type.charAt(0).toUpperCase() + type.slice(1)} · ${loc}`;
}

export function filterPortalImages(images = []) {
  return [...new Set((images || []).filter(Boolean).map(String))].filter(isValidPortalListingImage).slice(0, 12);
}

export function listingMatchesSearchCriteria(listing = {}, criteria = {}) {
  const emirate = criteria.emirate || criteria.emirates?.[0];
  const rowEmirate = inferEmirateFromListing(listing) || listing.emirate;
  if (emirate && rowEmirate && rowEmirate !== emirate) return false;

  if (criteria.beds != null) {
    const beds = inferBedsFromListing(listing);
    if (beds == null) return false;
    if (Number(beds) !== Number(criteria.beds)) return false;
  }

  if (criteria.max_price != null && Number(listing.price_aed) > Number(criteria.max_price)) return false;
  if (criteria.min_price != null && Number(listing.price_aed) < Number(criteria.min_price)) return false;

  const url = String(listing.source_url || "");
  if (!PORTAL_HOST.test(url) || !Number(listing.price_aed)) return false;

  return listingHasRealPhotos(listing);
}

export function polishListingForChat(raw = {}, criteria = {}) {
  const beds = inferBedsFromListing(raw);
  const row = {
    ...raw,
    beds: beds ?? raw.beds,
    images: filterPortalImages(raw.images || [])
  };
  if (!row.images.length) return null;

  const prepared = prepareListing(row);
  if (!prepared) return null;

  prepared.images = filterPortalImages(prepared.images);
  if (!prepared.images.length) return null;

  if (!listingMatchesSearchCriteria(prepared, criteria)) return null;

  const mapped = mapSupabaseListing({
    ...prepared,
    id: raw.id || prepared.external_id,
    amenities: prepared.amenities || raw.amenities || []
  });

  return {
    ...mapped,
    id: mapped.id || raw.id || `${mapped.source}:${mapped.external_id}`,
    title: formatListingTitle(mapped, criteria)
  };
}

export function polishListingsForChat(listings = [], criteria = {}, { limit = 8 } = {}) {
  const out = [];
  for (const row of listings) {
    const polished = polishListingForChat(row, criteria);
    if (polished) out.push(polished);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildSearchStatusMessage(criteria = {}, sources = []) {
  const parts = [];
  if (criteria.beds != null) {
    parts.push(criteria.beds === 0 ? "studio" : `${criteria.beds}-bedroom`);
  }
  if (criteria.community) parts.push(criteria.community);
  else if (criteria.emirate) parts.push(criteria.emirate);
  if (criteria.transaction_type === "sale") parts.push("for sale");
  else parts.push("for rent");
  if (criteria.max_price) parts.push(`under AED ${Number(criteria.max_price).toLocaleString()}`);

  const query = parts.length ? parts.join(" · ") : "your criteria";
  const portals = [];
  if (sources.includes("portal") || sources.includes("cache")) {
    portals.push("Property Finder", "Bayut");
  }
  if (sources.includes("n8n")) portals.push("Dubizzle");
  const portalText = portals.length ? portals.join(", ") : "Property Finder, Bayut & Dubizzle";

  return `Searched ${portalText} for ${query}.`;
}
