/**
 * Hub enrich-url — portal HTML → full listing with images → Supabase sync.
 */

import { enrichListingFromPortalUrl, enrichListingsFromPortalUrls } from "./portal-detail.mjs";
import { prepareListing, ingestListingBatch } from "./ingest.mjs";
import {
  isSupabaseEnabled,
  batchSyncListingsToSupabaseWithReturn,
  upsertInventoryRow
} from "./supabase.mjs";
import { filterValidPortalImages } from "./listing-images.mjs";
import { mapInventoryRowToListing } from "./inventory-map.mjs";

function listingToInventory(listing = {}) {
  const price =
    listing.price_aed > 0
      ? `AED ${Number(listing.price_aed).toLocaleString()}${listing.price_period === "monthly" ? "/mo" : "/yr"}`
      : "";
  return {
    url: listing.source_url,
    title: listing.description?.slice(0, 200) || listing.title || "",
    description: listing.description || "",
    price,
    location: [listing.emirate, listing.community].filter(Boolean).join(", "),
    developer: listing.developer || "",
    unit_types: listing.beds != null ? [`${listing.beds} bed`] : [],
    amenities: listing.amenities || [],
    images: listing.images || [],
    payment_plan: listing.payment_plan || "",
    source: listing.source || "live_search",
    metadata: { enriched_at: new Date().toISOString() }
  };
}

async function syncEnrichedListing(listing = {}) {
  if (!isSupabaseEnabled()) return { synced: false, listing };

  const prepared = prepareListing({ ...listing, source: listing.source || "live_search" });
  let syncedListing = listing;

  if (prepared) {
    const rows = await batchSyncListingsToSupabaseWithReturn([prepared]);
    if (rows[0]) syncedListing = { ...listing, ...rows[0] };
  } else {
    await ingestListingBatch([listing], { source: listing.source || "live_search" }).catch(() => {});
  }

  const inventory = listingToInventory(syncedListing);
  await upsertInventoryRow(inventory).catch(() => {});

  return { synced: true, listing: syncedListing, inventory };
}

/**
 * Enrich one portal URL and optionally sync to Supabase.
 */
export async function runEnrichPortalUrl(url, options = {}) {
  const partial = options.partial || options.listing || {};
  const result = await enrichListingFromPortalUrl(url, partial);
  const images = filterValidPortalImages(result.listing?.images || []);
  result.listing = result.listing ? { ...result.listing, images } : null;
  result.ok = Boolean(result.ok && images.length);

  if (options.sync && result.listing && result.ok) {
    const sync = await syncEnrichedListing(result.listing);
    result.listing = sync.listing;
    result.inventory = sync.inventory;
    result.synced = sync.synced;
  } else if (result.listing) {
    result.inventory = listingToInventory(result.listing);
  }

  return result;
}

/**
 * Enrich multiple URLs (n8n live search batch).
 */
export async function runEnrichPortalUrls(urls = [], options = {}) {
  const entries = urls.map((u) => (typeof u === "string" ? { url: u } : u));
  const enriched = await enrichListingsFromPortalUrls(entries, {
    concurrency: options.concurrency || 3
  });

  const listings = [];
  const inventory = [];
  const errors = [];

  for (const row of enriched) {
    if (row.ok && row.listing) {
      if (options.sync) {
        const sync = await syncEnrichedListing(row.listing);
        listings.push(sync.listing);
        inventory.push(sync.inventory);
      } else {
        listings.push(row.listing);
        inventory.push(listingToInventory(row.listing));
      }
    } else {
      errors.push({ url: row.listing?.source_url, error: row.error || "no images" });
    }
  }

  return {
    ok: listings.length > 0,
    count: listings.length,
    listings,
    inventory,
    errors,
    at: new Date().toISOString()
  };
}

/** Map inventory stub → enrich via portal HTML. */
export async function enrichInventoryRows(rows = [], options = {}) {
  const entries = rows
    .filter((r) => r?.url)
    .map((r) => ({
      url: r.url,
      partial: mapInventoryRowToListing(r) || { source_url: r.url, description: r.description || r.title }
    }));

  return runEnrichPortalUrls(entries, options);
}
