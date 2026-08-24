/**
 * Puppeteer bulk ingest → Supabase (opt-in; does not run existing HTML scrapers).
 *
 * Requires:
 *   JAB_RE_PUPPETEER_SCRAPE=1
 *   SUPABASE_URL + SUPABASE_SECRET_KEY (or service role)
 *   npm install puppeteer (in repo root)
 *
 * Usage:
 *   node scripts/re-puppeteer-ingest.mjs --source=bayut_puppeteer
 *   node scripts/re-puppeteer-ingest.mjs --all
 *   node scripts/re-puppeteer-ingest.mjs --all --maxPages=5
 */

import { loadHubEnv } from "../packages/real-estate/env.mjs";
import {
  runPuppeteerIngestScrape,
  runPuppeteerIngestAll,
  PUPPETEER_INGEST_SOURCES,
  getPuppeteerCronSources,
  isPuppeteerScrapeEnabled
} from "../packages/real-estate/puppeteer-scrape.mjs";
import { isSupabaseEnabled } from "../packages/real-estate/supabase.mjs";
import { closeBrowser } from "../packages/real-estate/scrapers/puppeteer/browser.mjs";

loadHubEnv();

const args = process.argv.slice(2);
const all = args.includes("--all");
const systemd = args.includes("--systemd");
const sourceArg = args.find((a) => a.startsWith("--source="));
const maxPagesArg = args.find((a) => a.startsWith("--maxPages="));
const source = sourceArg ? sourceArg.split("=")[1] : null;
const maxPages = maxPagesArg ? Number(maxPagesArg.split("=")[1]) : undefined;

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("SUPABASE_URL and key required");
    process.exit(systemd ? 0 : 1);
  }
  if (!isPuppeteerScrapeEnabled()) {
    const msg = "Set JAB_RE_PUPPETEER_SCRAPE=1 to enable Puppeteer ingest";
    if (systemd) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: msg }));
      return;
    }
    console.error(msg);
    process.exit(1);
  }

  try {
    if (all) {
      const sources = getPuppeteerCronSources();
      const result = await runPuppeteerIngestAll(sources, { maxPages });
      console.log(JSON.stringify({ at: new Date().toISOString(), sources, ...result }, null, 2));
      return;
    }

    if (!source) {
      console.error(
        `Usage: --source=<name> or --all\nAllowed: ${PUPPETEER_INGEST_SOURCES.join(", ")}\nCron/default --all: ${getPuppeteerCronSources().join(", ")}`
      );
      process.exit(1);
    }

    const result = await runPuppeteerIngestScrape(source, { maxPages });
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
  } finally {
    await closeBrowser();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
