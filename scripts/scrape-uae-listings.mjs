/**
 * UAE listings scraper — cron entry point (Phase 2).
 *
 * Sources (in order):
 *   1. seed — expanded baseline inventory (Bayut, Property Finder, Dubizzle, Emaar)
 *   2. bayut_api — RapidAPI Bayut (RAPIDAPI_KEY)
 *   3. propertyfinder_api — RapidAPI Property Finder (same key, separate subscription)
 *   4. propertyfinder — Property Finder HTML (__NEXT_DATA__)
 *   5. bayut — Bayut HTML fallback
 *   6. dubizzle — Dubizzle HTML (often captcha)
 *   7. developers — Emaar, Damac off-plan pages
 *
 * Usage:
 *   node scripts/scrape-uae-listings.mjs
 *   node scripts/scrape-uae-listings.mjs --sources=seed,propertyfinder,bayut
 */

import { openHubDb, upsertListing, startScrapeRun, finishScrapeRun, markStaleListings, countActiveListings } from "../packages/hub-db/index.mjs";
import { syncListingToSupabase, isSupabaseEnabled } from "../packages/real-estate/supabase.mjs";
import { scrapeBayutApi, isBayutApiConfigured } from "../packages/real-estate/scrapers/rapidapi-bayut.mjs";
import { scrapePropertyFinderApi, isPropertyFinderApiConfigured } from "../packages/real-estate/scrapers/rapidapi-propertyfinder.mjs";
import { scrapeBayutHtml } from "../packages/real-estate/scrapers/bayut-html.mjs";
import { scrapePropertyFinderHtml } from "../packages/real-estate/scrapers/propertyfinder-html.mjs";
import { scrapeDubizzleHtml } from "../packages/real-estate/scrapers/dubizzle-html.mjs";
import { scrapeDevelopers } from "../packages/real-estate/scrapers/developers.mjs";
import { UAE_EMIRATES } from "../packages/hub-db/real-estate.mjs";
import { loadHubEnv } from "../packages/real-estate/env.mjs";
import { isZeroCostMode } from "../packages/real-estate/mode.mjs";

loadHubEnv();

const args = process.argv.slice(2);
const sourcesArg = args.find((a) => a.startsWith("--sources="));
const defaultSources = isZeroCostMode()
  ? ["emaar", "damac", "propertyfinder", "bayut", "dubizzle"]
  : isBayutApiConfigured()
    ? ["seed", "bayut_api", "propertyfinder_api", "propertyfinder", "developers"]
    : ["seed", "propertyfinder", "bayut", "dubizzle", "developers"];
const sources = sourcesArg ? sourcesArg.split("=")[1].split(",") : defaultSources;

async function scrapeSeed(db) {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-uae-real-estate.mjs");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`seed exit ${code}`))));
  });
  const count = countActiveListings(db);
  return { found: count, upserted: count, errors: [] };
}

async function runSource(db, source) {
  const runId = startScrapeRun(db, { source, emirate: "all", transaction_type: "all" });
  const fn = {
    seed: scrapeSeed,
    bayut_api: (d) => scrapeBayutApi(d, upsertListing, { emirates: UAE_EMIRATES, maxPages: 2 }),
    propertyfinder_api: (d) => scrapePropertyFinderApi(d, upsertListing, { emirates: UAE_EMIRATES, maxPages: 2 }),
    propertyfinder: (d) => scrapePropertyFinderHtml(d, upsertListing, { emirates: UAE_EMIRATES, types: ["rent", "sale"] }),
    bayut: (d) => scrapeBayutHtml(d, upsertListing, { emirates: UAE_EMIRATES, types: ["rent", "sale"] }),
    dubizzle: (d) => scrapeDubizzleHtml(d, upsertListing, { emirates: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman"], types: ["rent", "sale"] }),
    developers: (d) => scrapeDevelopers(d, upsertListing),
    emaar: (d) => scrapeDevelopers(d, upsertListing, { sources: ["emaar"] }),
    damac: (d) => scrapeDevelopers(d, upsertListing, { sources: ["damac"] })
  }[source];

  if (!fn) {
    finishScrapeRun(db, runId, { errors: [`Unknown source: ${source}`] });
    return { source, error: "unknown source" };
  }

  try {
    const result = await fn(db);
    finishScrapeRun(db, runId, {
      listings_found: result.found,
      listings_upserted: result.upserted,
      errors: result.errors
    });
    return { source, ...result };
  } catch (error) {
    finishScrapeRun(db, runId, { errors: [error.message] });
    return { source, error: error.message };
  }
}

async function syncAllToSupabase(db) {
  if (!isSupabaseEnabled()) return 0;
  const { getListing } = await import("../packages/hub-db/real-estate.mjs");
  const rows = db.prepare(`SELECT id FROM re_listings WHERE is_active = 1`).all();
  let synced = 0;
  for (const row of rows) {
    const listing = getListing(db, row.id);
    if (listing) {
      await syncListingToSupabase(listing);
      synced++;
    }
  }
  return synced;
}

async function main() {
  const { db } = openHubDb();
  const results = [];

  for (const source of sources) {
    results.push(await runSource(db, source.trim()));
  }

  const stale = markStaleListings(db);
  let supabaseSynced = 0;
  try {
    supabaseSynced = await syncAllToSupabase(db);
  } catch (error) {
    results.push({ source: "supabase", error: error.message });
  }

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      activeListings: countActiveListings(db),
      sources: results,
      staleMarked: stale,
      supabase: isSupabaseEnabled(),
      supabaseSynced,
      bayutApiConfigured: isBayutApiConfigured(),
      propertyFinderApiConfigured: isPropertyFinderApiConfigured()
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
