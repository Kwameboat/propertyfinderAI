/**
 * Ghana listings ingest → SQLite + Supabase when configured.
 *
 *   node scripts/scrape-ghana-listings.mjs
 *   node scripts/scrape-ghana-listings.mjs --sources=meqasa,jiji,ghanapropertycentre
 */

import { openHubDb, upsertListing, startScrapeRun, finishScrapeRun } from "../packages/hub-db/index.mjs";
import { GHANA_SEED_LISTINGS } from "../packages/real-estate/data/seed-ghana-listings.mjs";
import { clusterKey } from "../packages/real-estate/cluster.mjs";
import { loadHubEnv } from "../packages/real-estate/env.mjs";
import { scrapeSourceToRows, GHANA_INGEST_SOURCES, GHANA_SCRAPE_TYPES } from "../packages/real-estate/scrape-runner.mjs";
import { isSupabaseEnabled, batchSyncListingsToSupabase } from "../packages/real-estate/supabase.mjs";
import { prepareListing } from "../packages/real-estate/ingest.mjs";
import { getN8nIngestSources } from "../packages/real-estate/mode.mjs";

loadHubEnv();

const args = process.argv.slice(2);
const sourcesArg = args.find((a) => a.startsWith("--sources="));
const includeSeed = args.includes("--seed");
const defaultSources = getN8nIngestSources().filter((s) => GHANA_INGEST_SOURCES.includes(s));
const sources = sourcesArg
  ? sourcesArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean)
  : includeSeed
    ? ["seed", ...defaultSources]
    : defaultSources;

const { db } = openHubDb();
let upserted = 0;

function saveSqlite(rows) {
  for (const row of rows) {
    const listing = upsertListing(db, { ...row, cluster_id: clusterKey(row) });
    if (listing?.id) {
      db.prepare(`UPDATE re_listings SET cluster_id = ? WHERE id = ?`).run(clusterKey(listing), listing.id);
      upserted += 1;
    }
  }
}

async function saveSupabase(rows) {
  if (!isSupabaseEnabled()) return 0;
  const prepared = rows.map((row) => prepareListing(row)).filter(Boolean);
  if (!prepared.length) return 0;
  const result = await batchSyncListingsToSupabase(prepared);
  return result.upserted || 0;
}

const summary = [];

for (const source of sources) {
  const runId = startScrapeRun(db, { source, emirate: "Ghana", transaction_type: GHANA_SCRAPE_TYPES.join(",") });
  const errors = [];
  let found = 0;
  let supabaseUpserted = 0;
  try {
    if (source === "seed") {
      saveSqlite(GHANA_SEED_LISTINGS);
      found = GHANA_SEED_LISTINGS.length;
    } else {
      const scrape = await scrapeSourceToRows(source, { types: GHANA_SCRAPE_TYPES, maxPages: 3 });
      found = scrape.found;
      errors.push(...(scrape.errors || []));
      saveSqlite(scrape.rows);
      supabaseUpserted = await saveSupabase(scrape.rows);
    }
    finishScrapeRun(db, runId, { listings_found: found, listings_upserted: upserted, errors });
    summary.push({ source, found, sqlite: upserted, supabase: supabaseUpserted, errors });
  } catch (error) {
    finishScrapeRun(db, runId, { listings_found: found, listings_upserted: upserted, errors: [error.message] });
    summary.push({ source, found, error: error.message, errors });
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      upserted,
      supabase: isSupabaseEnabled(),
      sources,
      summary
    },
    null,
    2
  )
);
