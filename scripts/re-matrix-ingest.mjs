#!/usr/bin/env node
/**
 * Bulk matrix ingest — top communities × rent/sale across emirates.
 * Usage: node scripts/re-matrix-ingest.mjs [--emirate Dubai] [--limit 20] [--dry-run]
 */

import { listMatrixJobs } from "../packages/real-estate/scrape-matrix.mjs";
import { fetchPortalLiveListings } from "../packages/real-estate/portal-live.mjs";
import { searchBayutAlgoliaRows } from "../packages/real-estate/scrapers/bayut-algolia.mjs";
import { ingestListingBatch } from "../packages/real-estate/ingest.mjs";
import { enrichListingsWithImages } from "../packages/real-estate/listing-images.mjs";

function parseArgs(argv = []) {
  const out = { emirate: null, limit: 20, dryRun: false, types: ["rent", "sale"] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--emirate") out.emirate = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]) || 20;
    else if (a === "--rent-only") out.types = ["rent"];
    else if (a === "--sale-only") out.types = ["sale"];
  }
  return out;
}

function mergeRows(a = [], b = []) {
  const map = new Map(a.map((r) => [`${r.source}:${r.external_id}`, r]));
  for (const row of b) map.set(`${row.source}:${row.external_id}`, row);
  return [...map.values()];
}

async function main() {
  const args = parseArgs(process.argv);
  const emirates = args.emirate ? [args.emirate] : undefined;
  const jobs = listMatrixJobs({ emirates, types: args.types }).slice(0, args.limit);

  let found = 0;
  let upserted = 0;
  const errors = [];

  for (const job of jobs) {
    const criteria = {
      emirate: job.emirate,
      community: job.community,
      transaction_type: job.transaction_type
    };

    let rows = [];

    try {
      const bayut = await searchBayutAlgoliaRows(criteria, { maxPages: 1, maxHits: 15 });
      rows = mergeRows(rows, bayut.rows || []);
    } catch (error) {
      errors.push(`${job.community}/${job.transaction_type} bayut: ${error.message}`);
    }

    try {
      const portal = await fetchPortalLiveListings(criteria, { maxPages: 1, maxHits: 20 });
      rows = mergeRows(rows, portal.rows || []);
      if (portal.errors?.length) errors.push(...portal.errors.slice(0, 1));
    } catch (error) {
      errors.push(`${job.community}/${job.transaction_type} portal: ${error.message}`);
    }

    if (!rows.length) continue;

    rows = await enrichListingsWithImages(rows, { minImages: 1 });
    rows = rows.filter((r) => r.source_url && Number(r.price_aed) > 0 && (r.images || []).length);
    found += rows.length;

    if (args.dryRun) {
      console.log(JSON.stringify({ job, count: rows.length, sample: rows[0]?.source_url }));
      continue;
    }

    const batch = await ingestListingBatch(rows, { source: "matrix_ingest" });
    upserted += batch.upserted || 0;
    if (batch.errors?.length) errors.push(...batch.errors.slice(0, 2));
  }

  console.log(
    JSON.stringify({
      ok: true,
      jobs: jobs.length,
      found,
      upserted,
      dryRun: args.dryRun,
      errors: errors.slice(0, 10)
    })
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
