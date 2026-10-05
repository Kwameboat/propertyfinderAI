/**
 * Unified live listings pipeline — cache → portal SERP → enrich → DB format → ingest.
 */

import { fetchListingsForChat } from "./listings-store.mjs";
import { fetchPortalLiveListings } from "./portal-live.mjs";
import { fetchN8nLiveSearch, isN8nLiveSearchEnabled } from "./n8n-live-search.mjs";
import { enrichListingsWithImages, listingHasRealPhotos, preferListingImages } from "./listing-images.mjs";
import { enrichListingsWithDetail, listingNeedsDetailEnrich } from "./listing-detail-enrich.mjs";
import { ingestListingBatch, prepareListing } from "./ingest.mjs";
import { upsertListing } from "../hub-db/real-estate.mjs";
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
import { runGhanaLiveSearch } from "./ghana-live-search.mjs";
import { attachClusterMeta, groupListingsByCluster } from "./cluster.mjs";

const MIN_RESULTS = 3;
const PORTAL_HOST = /propertyfinder\.ae|bayut\.com|dubizzle\.com/i;

export function isVerifiedPortalListing(listing = {}) {
  const url = String(listing.source_url || "");
  return PORTAL_HOST.test(url) && Number(listing.price_aed) > 0;
}

function mergeByKey(existing = [], incoming = []) {
  const map = new Map(existing.map((l) => [`${l.source}:${l.external_id}`, l]));
  for (const row of incoming) {
    const key = `${row.source}:${row.external_id}`;
    const prev = map.get(key);
    if (prev) {
      map.set(key, {
        ...prev,
        ...row,
        images: preferListingImages(row.images, prev.images)
      });
    } else {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

function persistGhanaListingGalleries(db, listings = []) {
  if (!db) return;
  for (const listing of listings) {
    if (!listing?.source || !listing?.external_id) continue;
    if (!Array.isArray(listing.images) || !listing.images.length) continue;
    try {
      upsertListing(db, {
        ...listing,
        images: listing.images,
        images_json: JSON.stringify(listing.images)
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          ghanaGalleryPersistError: error.message,
          source: listing.source,
          external_id: listing.external_id
        })
      );
    }
  }
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
    const limit = options.limit || 8;
    const store = await pullGhanaListingsForChat(db, criteria, { limit });
    let listings = store.listings || [];
    const sources = store.ok ? ["ghana_store"] : [];
    const thin = listings.length < 3;
    const wantsLive = thin || options.forcePortal || options.forceLive || Boolean(criteria.community);
    if (wantsLive) {
      try {
        const live = await runGhanaLiveSearch(db, {
          message: options.message || "",
          criteria,
          session: options.session || {},
          limit
        });
        if (live.listings?.length) {
          listings = mergeByKey(listings, live.listings);
          sources.push(...(live.sources || ["gpc_live"]));
        }
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), ghanaLivePullError: error.message }));
      }
    }
    const grouped = groupListingsByCluster(listings);
    listings = grouped.map((g) => attachClusterMeta(g.listing, g.offers)).slice(0, limit);
    if (listings.some((l) => listingNeedsDetailEnrich(l, { minImages: 4 }))) {
      try {
        listings = await enrichListingsWithDetail(listings, { minImages: 4, max: listings.length });
        persistGhanaListingGalleries(db, listings);
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), ghanaGalleryEnrichError: error.message }));
      }
    }
    const loc = criteria.community || criteria.emirate || "Ghana";
    const tx = criteria.transaction_type === "sale" ? "homes for sale" : criteria.transaction_type === "rent" ? "rentals" : "listings";
    return {
      ok: listings.length > 0,
      listings,
      sources,
      searchMessage: sources.includes("gpc_live") || sources.includes("n8n")
        ? `Live-searched Ghana ${tx} in ${loc}.`
        : store.searchMessage || `Searched Ghana ${tx} in ${loc}.`,
      searched: true,
      fetchedAt: new Date().toISOString()
    };
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
