/**
 * Unified live listings pipeline — cache → portal SERP → enrich → DB format → ingest.
 */

import { fetchListingsForChat } from "./listings-store.mjs";
import { fetchPortalLiveListings } from "./portal-live.mjs";
import { fetchN8nLiveSearch, isN8nLiveSearchEnabled } from "./n8n-live-search.mjs";
import { enrichListingsWithImages, listingHasRealPhotos, preferListingImages } from "./listing-images.mjs";
import { enrichListingsWithDetail, listingNeedsDetailEnrich } from "./listing-detail-enrich.mjs";
import { ingestListingBatch, prepareListing } from "./ingest.mjs";
import { isSupabaseEnabled, batchSyncListingsToSupabaseWithReturn } from "./supabase.mjs";
import {
  normalizeSearchCriteria,
  filterListingsByEmirate,
  resolveEmirateScope
} from "./emirate-scope.mjs";
import {
  polishListingsForChat,
  buildSearchStatusMessage,
  listingMatchesSearchCriteria
} from "./listing-polish.mjs";
import { getLivePullFromCache, setLivePullCache, isLiveCacheEnabled } from "./live-cache.mjs";
import { filterShowableListings } from "./listing-verify-filter.mjs";
import { isGhanaMarket } from "./market.mjs";
import { pullGhanaListingsForChat } from "./ghana-search.mjs";

const MIN_RESULTS = 3;
const PORTAL_HOST = /propertyfinder\.ae|bayut\.com|dubizzle\.com/i;

export function isVerifiedPortalListing(listing = {}) {
  const url = String(listing.source_url || "");
  return PORTAL_HOST.test(url) && Number(listing.price_aed) > 0;
}

function mergeByKey(existing = [], incoming = []) {
  const map = new Map(existing.map((l) => [`${l.source}:${l.external_id}`, l]));
  for (const row of incoming) {
    map.set(`${row.source}:${row.external_id}`, row);
  }
  return [...map.values()];
}

async function finalizeListings(listings = [], criteria = {}, { limit = 8, ingestSource = "live_pull", scope } = {}) {
  let rows = listings.filter(isVerifiedPortalListing);
  rows = filterListingsByEmirate(rows, scope);
  rows = await enrichListingsWithDetail(rows, { max: limit + 4 });
  rows = await enrichListingsWithImages(rows, { minImages: 1 });
  rows = rows.filter((l) => listingHasRealPhotos(l) && listingMatchesSearchCriteria(l, criteria));

  rows = polishListingsForChat(rows, criteria, { limit });

  if (rows.length && isSupabaseEnabled()) {
    try {
      const prepared = rows
        .map(({ title, ...rest }) => prepareListing(rest))
        .filter(Boolean);
      const synced = prepared.length ? await batchSyncListingsToSupabaseWithReturn(prepared) : [];
      const byKey = new Map(synced.map((l) => [`${l.source}:${l.external_id}`, l]));
      rows = rows.map((row) => {
        const db = byKey.get(`${row.source}:${row.external_id}`);
        if (!db) return row;
        const images = preferListingImages(row.images, db.images);
        return { ...row, ...db, title: row.title || db.title, images };
      });
    } catch {
      void ingestListingBatch(
        rows.map(({ title, ...rest }) => rest),
        { source: ingestSource }
      ).catch(() => {});
    }
  }

  return rows;
}

/**
 * Pull listings for chat cards — portal photos + DB-normalized shape.
 */
export async function pullLiveListingsForChat(db, criteria = {}, options = {}) {
  if (isLiveCacheEnabled()) {
    const hit = getLivePullFromCache(criteria, options);
    if (hit) return hit;
  }
  const result = await pullLiveListingsForChatInner(db, criteria, options);
  if (isLiveCacheEnabled()) setLivePullCache(criteria, options, result);
  return result;
}

async function pullLiveListingsForChatInner(db, criteria = {}, options = {}) {
  if (isGhanaMarket()) {
    return pullGhanaListingsForChat(db, criteria, { limit: options.limit || 8 });
  }
  const limit = options.limit || 8;
  const wantsPhotos = options.wantsPhotos !== false;
  const sources = [];
  const scopedCriteria = normalizeSearchCriteria(criteria, {
    currentMessage: options.message || "",
    session: options.session || {}
  });
  const scope = resolveEmirateScope(scopedCriteria, {
    currentMessage: options.message || "",
    session: options.session || {}
  });

  const needsExactMatch = scopedCriteria.beds != null;

  let cache = await fetchListingsForChat(db, scopedCriteria, limit, {
    currentMessage: options.message || "",
    session: options.session || {}
  });
  let listings = polishListingsForChat(filterListingsByEmirate(cache.listings || [], scope), scopedCriteria, {
    limit
  });
  listings = listings.filter(listingHasRealPhotos);
  if (listings.length && listings.some((l) => listingNeedsDetailEnrich(l, { minImages: 4 }))) {
    listings = await finalizeListings(listings, scopedCriteria, { limit, scope, ingestSource: "live_cache" });
  }
  if (listings.length) sources.push("cache");

  const thin = listings.length < MIN_RESULTS;
  const forcePortal = thin || needsExactMatch || options.forcePortal;

  if (forcePortal) {
    try {
      const portal = await fetchPortalLiveListings(scopedCriteria, { maxPages: 2, maxHits: limit + 12 });
      if (portal.rows?.length) {
        const merged = mergeByKey(listings, filterListingsByEmirate(portal.rows, scope));
        listings = await finalizeListings(merged, scopedCriteria, { limit, scope });
        if (listings.length) sources.push("portal");
      }
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), portalLiveError: error.message }));
    }
  }

  if (
    isN8nLiveSearchEnabled() &&
    listings.length < MIN_RESULTS
  ) {
    try {
      const live = await fetchN8nLiveSearch(db, options.message || "", scopedCriteria, options.session);
      if (live.listings?.length) {
        const merged = mergeByKey(listings, filterListingsByEmirate(live.listings, scope));
        listings = await finalizeListings(merged, scopedCriteria, { limit, scope });
        if (listings.length) sources.push("n8n");
      }
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), n8nLivePullError: error.message }));
    }
  }

  if (!listings.length && cache.listings?.length) {
    listings = await finalizeListings(filterListingsByEmirate(cache.listings, scope), scopedCriteria, {
      limit,
      scope
    });
    if (listings.length && !sources.includes("cache")) sources.push("cache");
  }

  if (!sources.includes("portal") && forcePortal) sources.push("portal");

  const searchMessage = buildSearchStatusMessage(scopedCriteria, sources);

  listings = await filterShowableListings(listings);

  return {
    ok: listings.length > 0,
    listings,
    sources,
    searchMessage,
    searched: sources.length > 0,
    fetchedAt: new Date().toISOString()
  };
}
