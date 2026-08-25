/**
 * Ghana listings ingest.
 *
 *   node scripts/scrape-ghana-listings.mjs
 *   node scripts/scrape-ghana-listings.mjs --sources=seed,meqasa
 */

import { openHubDb, upsertListing, startScrapeRun, finishScrapeRun } from "../packages/hub-db/index.mjs";
import { scrapeMeqasaHtml } from "../packages/real-estate/scrapers/meqasa-html.mjs";
import { GHANA_SEED_LISTINGS } from "../packages/real-estate/data/seed-ghana-listings.mjs";
import { clusterKey } from "../packages/real-estate/cluster.mjs";
import { loadHubEnv } from "../packages/real-estate/env.mjs";

loadHubEnv();

const args = process.argv.slice(2);
const sourcesArg = args.find((a) => a.startsWith("--sources="));
const sources = sourcesArg ? sourcesArg.split("=")[1].split(",") : ["seed", "meqasa"];
const cities = ["Accra", "Kumasi", "Tema"];

const { db } = openHubDb();
let upserted = 0;

function saveRows(rows) {
  for (const row of rows) {
    const listing = upsertListing(db, { ...row, cluster_id: clusterKey(row) });
    if (listing?.id) {
      db.prepare(`UPDATE re_listings SET cluster_id = ? WHERE id = ?`).run(clusterKey(listing), listing.id);
      upserted += 1;
    }
  }
}

for (const source of sources) {
  const runId = startScrapeRun(db, { source, emirate: "Ghana", transaction_type: "rent" });
  const errors = [];
  let found = 0;
  try {
    if (source === "seed") {
      saveRows(GHANA_SEED_LISTINGS);
      found = GHANA_SEED_LISTINGS.length;
    } else if (source === "meqasa") {
      for (const city of cities) {
        const result = await scrapeMeqasaHtml({ city, transactionType: "rent", pages: 2 });
        found += result.listings.length;
        errors.push(...result.errors);
        saveRows(result.listings);
      }
    } else {
      errors.push(`unknown source ${source}`);
    }
    finishScrapeRun(db, runId, { listings_found: found, listings_upserted: upserted, errors });
  } catch (error) {
    finishScrapeRun(db, runId, { listings_found: found, listings_upserted: upserted, errors: [error.message] });
  }
}

console.log(JSON.stringify({ ok: true, upserted, sources }, null, 2));
