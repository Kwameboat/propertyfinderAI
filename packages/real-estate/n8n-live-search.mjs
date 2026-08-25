/**
 * Call n8n Live Search RAG webhook (SearXNG → Hub enrich-url → Supabase).
 */

import { mapInventoryRowsToListings } from "./inventory-map.mjs";
import { searchListingsStore } from "./listings-store.mjs";
import { enrichInventoryRows } from "./enrich-url.mjs";
import { buildLiveSearchQuery } from "./live-search-query.mjs";
import { filterValidPortalImages, isChatListingImage } from "./listing-images.mjs";
import { isGhanaMarket } from "./market.mjs";

const WEBHOOK = () => String(process.env.N8N_LIVE_SEARCH_WEBHOOK || "").trim();
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.N8N_LIVE_SEARCH_TIMEOUT_MS || 120000), 30000), 180000);

/** Hub runs on the VPS host (systemd) — not inside Docker. */
function resolveWebhookUrl() {
  const raw = WEBHOOK();
  if (!raw) return "";
  if (raw.includes("host.docker.internal")) {
    return raw.replace("host.docker.internal", "127.0.0.1");
  }
  return raw;
}

export function isN8nLiveSearchEnabled() {
  return Boolean(WEBHOOK());
}

export async function fetchN8nLiveSearch(db, query = "", criteria = {}, session = {}) {
  const url = resolveWebhookUrl();
  if (!url) return { ok: false, listings: [], source: "disabled" };

  const searchQuery = buildLiveSearchQuery(query, criteria, session);
  const body = {
    query: searchQuery,
    emirate: criteria.emirate || criteria.emirates?.[0] || (String(process.env.JAB_RE_MARKET || "").toUpperCase() === "GH" ? "Accra" : "Dubai"),
    message: searchQuery
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    const text = await response.text();
    if (!text.trim()) {
      throw new Error("n8n live search empty response");
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`n8n live search invalid JSON: ${text.slice(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(data.error || `n8n HTTP ${response.status}`);
    }

    let listings = Array.isArray(data.listings) ? data.listings : [];
    const inventory = Array.isArray(data.inventory) ? data.inventory : [];

    if (!listings.length && inventory.length) {
      listings = mapInventoryRowsToListings(inventory);
    }

    const needsEnrich = isGhanaMarket()
      ? false
      : listings.some((l) => filterValidPortalImages(l.images || []).length < 1);
    if (needsEnrich && inventory.length) {
      const enriched = await enrichInventoryRows(inventory, { sync: true });
      if (enriched.listings?.length) listings = enriched.listings;
    } else if (needsEnrich && listings.length) {
      const enriched = await enrichInventoryRows(
        listings.map((l) => ({ url: l.source_url, ...l })),
        { sync: true }
      );
      if (enriched.listings?.length) listings = enriched.listings;
    }

    if (!listings.length && data.ok) {
      listings = await searchListingsStore(
        db,
        {
          transaction_type: criteria.transaction_type || "rent",
          emirate: body.emirate,
          community: criteria.community
        },
        8
      );
    }

    listings = listings.filter((l) =>
      isGhanaMarket()
        ? Number(l.price_aed) > 0 || (l.images || []).some(isChatListingImage)
        : filterValidPortalImages(l.images || (l.image ? [l.image] : [])).length > 0
    );
    if (!listings.length && Array.isArray(data.listings) && data.listings.length) {
      listings = data.listings;
    }

    return {
      ok: listings.length > 0,
      listings,
      inventory: data.inventory || inventory,
      source: "n8n_live_search",
      fetchedAt: data.at || new Date().toISOString()
    };
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), n8nLiveSearchError: error.message }));
    return { ok: false, listings: [], source: "n8n_live_search", error: error.message };
  }
}
