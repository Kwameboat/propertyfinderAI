/**
 * Apply listing availability + optional verify pass before chat display.
 * Only runs verification when JAB_RE_VERIFY_LISTINGS=1 (default off).
 */

import { isListingShowable, verifyListingsEnabled, verifyAndPatchListing } from "./listing-availability.mjs";

export async function filterShowableListings(listings = [], { verify = verifyListingsEnabled() } = {}) {
  let rows = listings.filter(isListingShowable);
  if (!verify || !rows.length) return rows;

  const verified = [];
  for (const row of rows.slice(0, 8)) {
    const needsCheck =
      !row.last_verified_at ||
      Date.now() - new Date(row.last_verified_at).getTime() > 24 * 3600 * 1000;
    if (needsCheck && row.source_url) {
      const updated = await verifyAndPatchListing(row);
      if (isListingShowable(updated)) verified.push(updated);
    } else if (isListingShowable(row)) {
      verified.push(row);
    }
  }
  return verified.length ? verified : rows.filter(isListingShowable);
}
