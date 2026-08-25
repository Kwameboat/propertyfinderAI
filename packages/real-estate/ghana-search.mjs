/**
 * Ghana inventory search for chat cards.
 * Skips UAE portal-photo gates so seed + Meqasa rows can surface.
 */

import { searchListingsStore } from "./listings-store.mjs";
import { formatListingTitle } from "./listing-polish.mjs";
import { attachClusterMeta, groupListingsByCluster } from "./cluster.mjs";
import { isGhanaMarket } from "./market.mjs";

function ghanaQuery(criteria = {}) {
  const query = {
    transaction_type: criteria.transaction_type || "rent",
    include_seed: true
  };
  const city = String(criteria.emirate || "").trim();
  if (city && !/^(dubai|abu dhabi|sharjah|ajman|rak|fujairah|uaq)$/i.test(city)) {
    query.emirate = city;
  }
  if (criteria.community) query.community = criteria.community;
  if (criteria.beds != null) query.beds = criteria.beds;
  if (criteria.max_price != null) query.max_price = criteria.max_price;
  if (criteria.min_price != null) query.min_price = criteria.min_price;
  if (criteria.property_type) query.property_type = criteria.property_type;
  return query;
}

function withTitles(listings, criteria) {
  return listings.map((l) => {
    const images = Array.isArray(l.images) ? l.images.filter(Boolean) : [];
    return {
      ...l,
      title: l.title || formatListingTitle(l, criteria),
      images,
      image: l.image || images[0] || null
    };
  });
}

export async function pullGhanaListingsForChat(db, criteria = {}, { limit = 8 } = {}) {
  if (!isGhanaMarket()) {
    return { ok: false, listings: [], sources: [], searchMessage: "", searched: false };
  }

  const query = ghanaQuery(criteria);
  let listings = await searchListingsStore(db, query, 24);
  if (!listings.length && (query.emirate || query.community || query.beds != null)) {
    listings = await searchListingsStore(db, { transaction_type: query.transaction_type, include_seed: true }, 24);
  }

  listings = withTitles(listings, criteria);
  const grouped = groupListingsByCluster(listings);
  const cards = grouped
    .map((g) => attachClusterMeta(g.listing, g.offers))
    .slice(0, limit);

  const loc = criteria.community || criteria.emirate || "Ghana";
  const type = criteria.property_type ? ` ${criteria.property_type}` : "";
  return {
    ok: cards.length > 0,
    listings: cards,
    sources: ["ghana_store"],
    searchMessage: `Searched Ghana listings for${type} rentals in ${loc}.`,
    searched: true,
    fetchedAt: new Date().toISOString()
  };
}
