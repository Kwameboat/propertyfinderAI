/**
 * Cluster listings that are likely the same physical property
 * advertised by different agents / portals.
 */

import { createHash } from "node:crypto";

function norm(s = "") {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function priceBand(price, step = 250) {
  const n = Number(price) || 0;
  return Math.round(n / step) * step;
}

/** Stable cluster key — ignores source and agent. */
export function clusterKey(row = {}) {
  const city = norm(row.emirate || row.city);
  const area = norm(row.community || row.suburb);
  const type = norm(row.property_type || "apartment");
  const beds = row.beds == null || row.beds === "" ? "x" : String(Number(row.beds));
  const band = priceBand(row.price_aed || row.price_ghs);
  const lat = row.lat != null ? Number(row.lat).toFixed(3) : "";
  const lng = row.lng != null ? Number(row.lng).toFixed(3) : "";
  const geo = lat && lng ? `${lat},${lng}` : "";
  const raw = [city, area, type, beds, band, geo].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function groupListingsByCluster(listings = []) {
  const map = new Map();
  for (const listing of listings) {
    const id = listing.cluster_id || clusterKey(listing);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(listing);
  }
  return [...map.entries()].map(([id, offers]) => ({
    cluster_id: id,
    offers,
    listing: pickCanonicalOffer(offers)
  }));
}

/** Prefer a phone + recent scrape when several agents list one unit. */
export function pickCanonicalOffer(offers = []) {
  const ranked = [...offers].sort((a, b) => {
    const phone = Number(Boolean(b.agent_phone)) - Number(Boolean(a.agent_phone));
    if (phone) return phone;
    return Number(b.scraped_at || 0) - Number(a.scraped_at || 0);
  });
  return ranked[0] || null;
}

export function attachClusterMeta(listing, siblings = []) {
  const others = siblings.filter((s) => s.id !== listing.id);
  return {
    ...listing,
    cluster_id: listing.cluster_id || clusterKey(listing),
    other_agent_count: others.length,
    other_agents: others.slice(0, 4).map((s) => ({
      id: s.id,
      source: s.source,
      agent_name: s.agent_name || s.agency_name || "Agent",
      price_aed: s.price_aed
    }))
  };
}
