/**
 * Map Supabase `inventory` rows → listing shape for chat cards / ingest.
 */

import { createHash } from "node:crypto";

function hashUrl(url = "") {
  return createHash("sha256").update(String(url)).digest("hex").slice(0, 16);
}

function parsePriceAed(price = "") {
  const n = Number(String(price).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function mapInventoryRowToListing(row = {}) {
  if (!row?.url) return null;

  const location = String(row.location || "Dubai");
  const parts = location.split(/[,·]/).map((s) => s.trim()).filter(Boolean);
  const priceStr = String(row.price || "");
  const transaction_type = /sale|buy|off.plan/i.test(priceStr + (row.description || ""))
    ? /off.plan/i.test(priceStr + (row.description || ""))
      ? "off_plan"
      : "sale"
    : "rent";

  const images = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
  const amenities = Array.isArray(row.amenities) ? row.amenities : [];
  const unitTypes = Array.isArray(row.unit_types) ? row.unit_types : [];

  let beds = null;
  const bedMatch = unitTypes.join(" ").match(/(\d)\s*(?:bed|br|bhk)/i) || priceStr.match(/(\d)\s*bed/i);
  if (bedMatch) beds = Number(bedMatch[1]);

  return {
    id: row.id,
    source: row.source || "live_search",
    external_id: hashUrl(row.url),
    source_url: row.url,
    transaction_type,
    property_type: "apartment",
    beds,
    baths: null,
    emirate: parts[0] || "Dubai",
    community: parts[1] || parts[0] || "",
    sub_community: "",
    building: "",
    price_aed: parsePriceAed(row.price),
    price_period: /month|\/mo/i.test(priceStr) ? "monthly" : "yearly",
    handover_date: null,
    payment_plan: row.payment_plan || "",
    developer: row.developer || "",
    furnished: null,
    amenities,
    images,
    description: String(row.description || row.title || "").trim(),
    agent_name: "",
    agent_phone: "",
    agency_name: "",
    scraped_at: row.last_updated || new Date().toISOString(),
    is_active: true
  };
}

export function mapInventoryRowsToListings(rows = []) {
  return rows.map(mapInventoryRowToListing).filter(Boolean);
}
