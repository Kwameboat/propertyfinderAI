#!/usr/bin/env node
/**
 * Verify listing URLs still live — mark rented/sold/unavailable in Supabase.
 * Usage: node scripts/re-verify-listings.mjs [--limit=30]
 */
import { fetchListingsNeedingVerification, verifyListingBatch } from "../packages/real-estate/listing-availability.mjs";

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number(process.env.JAB_RE_VERIFY_BATCH || 30);

const rows = await fetchListingsNeedingVerification({ limit: Math.min(limit, 100), maxAgeHours: 24 });
console.log(JSON.stringify({ at: new Date().toISOString(), queued: rows.length }));

if (!rows.length) {
  console.log("Nothing to verify.");
  process.exit(0);
}

const results = await verifyListingBatch(rows, { max: rows.length, delayMs: 900 });
const summary = results.reduce((acc, r) => {
  const s = r.listing_status || "unknown";
  acc[s] = (acc[s] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({ verified: results.length, summary }, null, 2));
