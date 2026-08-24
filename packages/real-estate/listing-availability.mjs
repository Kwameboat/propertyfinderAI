/**
 * Listing availability — detect rented/sold/withdrawn from portal pages.
 * Opt-in filters: JAB_RE_HIDE_UNAVAILABLE=1 (default 0 = show all, existing behavior).
 */

import { isSupabaseEnabled, supabaseRequest } from "./supabase.mjs";

export const UNAVAILABLE_STATUSES = new Set([
  "rented",
  "sold",
  "withdrawn",
  "unavailable",
  "under_offer"
]);

const GONE_RE =
  /no longer available|listing (?:has been )?(?:removed|expired|unavailable)|property (?:is )?(?:sold|rented)|this (?:property|listing) (?:is )?no longer|not available anymore|page not found|404/i;

export function hideUnavailableListings() {
  return String(process.env.JAB_RE_HIDE_UNAVAILABLE || "0").trim() === "1";
}

export function verifyListingsEnabled() {
  return String(process.env.JAB_RE_VERIFY_LISTINGS || "0").trim() === "1";
}

export function isListingShowable(listing = {}) {
  if (!hideUnavailableListings()) return true;
  if (listing.is_active === false) return false;
  const status = String(listing.listing_status || "available").toLowerCase();
  return !UNAVAILABLE_STATUSES.has(status);
}

export function detectAvailabilityFromHtml(html = "", { statusCode = 200 } = {}) {
  if (statusCode === 404 || statusCode === 410) {
    return { status: "unavailable", available: false };
  }
  const text = String(html || "").slice(0, 120_000);
  if (!text.trim()) return { status: "unknown", available: true };
  if (GONE_RE.test(text)) {
    if (/sold/i.test(text)) return { status: "sold", available: false };
    if (/rented|leased/i.test(text)) return { status: "rented", available: false };
    return { status: "unavailable", available: false };
  }
  if (/under offer/i.test(text)) return { status: "under_offer", available: true };
  return { status: "available", available: true };
}

export async function verifyListingUrl(sourceUrl = "") {
  const url = String(sourceUrl || "").trim();
  if (!url.startsWith("http")) {
    return { status: "unknown", available: true, verifiedAt: Date.now() };
  }
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DarConciergeBot/1.0)" },
      signal: AbortSignal.timeout(15000)
    });
    const html = await res.text();
    const detected = detectAvailabilityFromHtml(html, { statusCode: res.status });
    return { ...detected, verifiedAt: Date.now() };
  } catch (error) {
    return { status: "unknown", available: true, verifiedAt: Date.now(), error: error.message };
  }
}

export async function patchListingAvailability(source, externalId, patch = {}) {
  if (!isSupabaseEnabled() || !source || !externalId) return null;
  const body = {
    listing_status: patch.listing_status || "unknown",
    last_verified_at: new Date(patch.verifiedAt || Date.now()).toISOString(),
    is_active: patch.available !== false
  };
  return supabaseRequest(
    `listings?source=eq.${encodeURIComponent(source)}&external_id=eq.${encodeURIComponent(externalId)}`,
    { method: "PATCH", body }
  );
}

export async function verifyAndPatchListing(listing = {}) {
  const result = await verifyListingUrl(listing.source_url);
  if (isSupabaseEnabled() && listing.source && listing.external_id) {
    await patchListingAvailability(listing.source, listing.external_id, {
      listing_status: result.status,
      available: result.available,
      verifiedAt: result.verifiedAt
    }).catch(() => {});
  }
  return {
    ...listing,
    listing_status: result.status,
    last_verified_at: result.verifiedAt,
    is_active: result.available !== false
  };
}

export async function verifyListingBatch(listings = [], { max = 20, delayMs = 800 } = {}) {
  const out = [];
  const cap = Math.min(listings.length, max);
  for (let i = 0; i < cap; i++) {
    const row = listings[i];
    const updated = await verifyAndPatchListing(row);
    out.push(updated);
    if (i < cap - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return out;
}

export async function fetchListingsNeedingVerification({ limit = 30, maxAgeHours = 24 } = {}) {
  if (!isSupabaseEnabled()) return [];
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const rows = await supabaseRequest(
    `listings?select=source,external_id,source_url,listing_status,scraped_at,last_verified_at&is_active=eq.true&or=(last_verified_at.is.null,last_verified_at.lt.${encodeURIComponent(cutoff)})&limit=${limit}&order=scraped_at.desc`
  );
  return Array.isArray(rows) ? rows : [];
}
