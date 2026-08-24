import { createHash } from "node:crypto";

/** Stable dedup key for listings (matches hub-db/real-estate.mjs). */
export function listingFingerprint(row) {
  const key = [
    row.source,
    row.external_id,
    row.transaction_type,
    row.emirate,
    row.community,
    row.beds,
    row.price_aed
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}
