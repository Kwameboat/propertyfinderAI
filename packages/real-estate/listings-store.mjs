/**
 * Unified listing reads — Supabase primary when configured, SQLite for local dev fallback.
 */

import {
  searchListings,
  getListing,
  countActiveListings,
  countListingsBySource
} from "../hub-db/real-estate.mjs";
import {
  isSupabaseEnabled,
  searchListingsSupabase,
  mapSupabaseListing,
  getListingSupabase,
  countActiveListingsSupabase,
  countListingsBySourceSupabase
} from "./supabase.mjs";
import { normalizeSearchCriteria, filterListingsByEmirate, resolveEmirateScope } from "./emirate-scope.mjs";
import { listingNeedsDetailEnrich, enrichListingFromDetailPage } from "./listing-detail-enrich.mjs";
import { isGhanaMarket, ghanaListingSources } from "./market.mjs";

export function listingsUseSupabase() {
  return isSupabaseEnabled();
}

export async function searchListingsStore(db, criteria = {}, limit = 10) {
  if (isSupabaseEnabled()) {
    try {
      const rows = await searchListingsSupabase(criteria, limit);
      return (rows || []).map(mapSupabaseListing).filter(Boolean);
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), listingsStoreSearchError: error.message }));
      throw error;
    }
  }
  return searchListings(db, criteria, limit);
}

export async function getListingStore(db, id, { enrich = false } = {}) {
  if (!id) return null;
  let listing = null;
  if (isSupabaseEnabled()) {
    try {
      listing = await getListingSupabase(id);
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), listingsStoreGetError: error.message }));
    }
  }
  if (!listing) listing = getListing(db, id);
  if (enrich && listing && listingNeedsDetailEnrich(listing, { minImages: 4 })) {
    try {
      listing = await enrichListingFromDetailPage(listing);
    } catch {
      /* keep store row */
    }
  }
  return listing;
}

export async function getListingsStatus(db) {
  if (isSupabaseEnabled()) {
    const [total, bySource] = await Promise.all([
      countActiveListingsSupabase(),
      countListingsBySourceSupabase(isGhanaMarket() ? ghanaListingSources() : null)
    ]);
    const sources = bySource || {};
    if (isGhanaMarket()) {
      const allowed = new Set(ghanaListingSources());
      const ghanaSources = Object.fromEntries(
        Object.entries(sources).filter(([source]) => allowed.has(source))
      );
      const ghanaTotal = Object.values(ghanaSources).reduce((n, c) => n + Number(c || 0), 0);
      return { listings: ghanaTotal, sources: ghanaSources, store: "supabase" };
    }
    return {
      listings: total ?? 0,
      sources,
      store: "supabase"
    };
  }
  const bySourceRows = countListingsBySource(db);
  const sources = bySourceRows.reduce((acc, row) => {
    acc[row.source] = row.count;
    return acc;
  }, {});
  return {
    listings: countActiveListings(db),
    sources,
    store: "sqlite"
  };
}

/** Filter/sort listings for chat cards (images required). */
export function polishListingsForChat(listings = [], { limit = 8, fallbackEmirate, transactionType } = {}) {
  let rows = listings
    .filter((l) => (l.images || []).length > 0 || l.image)
    .sort((a, b) => (b.images || []).length - (a.images || []).length)
    .slice(0, limit);

  if (!rows.length && fallbackEmirate) {
    return listings.filter((l) => (l.images || []).length > 0).slice(0, limit + 4);
  }
  return rows;
}

export async function fetchListingsForChat(db, criteria = {}, limit = 8, options = {}) {
  const searchCriteria = normalizeSearchCriteria(criteria, {
    currentMessage: options.currentMessage || "",
    session: options.session || {}
  });
  const scope = resolveEmirateScope(searchCriteria, {
    currentMessage: options.currentMessage || "",
    session: options.session || {}
  });

  const query = {
    transaction_type: searchCriteria.transaction_type || "rent",
    emirates: searchCriteria.emirates,
    emirate: searchCriteria.emirate,
    beds: searchCriteria.beds,
    max_price: searchCriteria.max_price,
    min_price: searchCriteria.min_price,
    community: searchCriteria.community,
    furnished: searchCriteria.furnished,
    developer: searchCriteria.developer,
    property_type: searchCriteria.property_type
  };

  let listings = await searchListingsStore(db, query, limit + 4);
  listings = filterListingsByEmirate(listings, scope);
  listings = polishListingsForChat(listings, {
    limit,
    fallbackEmirate: !listings.length ? searchCriteria.emirate || null : null
  });

  if (!listings.length && searchCriteria.emirate) {
    listings = polishListingsForChat(
      filterListingsByEmirate(
        await searchListingsStore(
          db,
          { transaction_type: query.transaction_type, emirate: searchCriteria.emirate },
          limit + 4
        ),
        scope
      ),
      { limit }
    );
  }

  listings = filterListingsByEmirate(listings, scope).slice(0, limit);

  return {
    ok: listings.length > 0,
    listings,
    source: isSupabaseEnabled() ? "supabase" : "sqlite",
    fetchedAt: new Date().toISOString()
  };
}
