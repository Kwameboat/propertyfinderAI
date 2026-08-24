/**
 * Puppeteer ingest entry — isolated from default scrape paths.
 */

import { isPuppeteerScrapeEnabled, isPuppeteerIngestSource, PUPPETEER_INGEST_SOURCES, getPuppeteerCronSources } from "./puppeteer-mode.mjs";
import { scrapeSourceToRows } from "./scrape-runner.mjs";
import { runIngestScrape } from "./ingest.mjs";

export { PUPPETEER_INGEST_SOURCES, getPuppeteerCronSources, isPuppeteerScrapeEnabled, isPuppeteerIngestSource };

export async function runPuppeteerIngestScrape(source, options = {}) {
  if (!isPuppeteerScrapeEnabled()) {
    return {
      ok: false,
      source,
      found: 0,
      upserted: 0,
      errors: ["Puppeteer scrape disabled — set JAB_RE_PUPPETEER_SCRAPE=1 on the server"]
    };
  }
  if (!isPuppeteerIngestSource(source)) {
    return {
      ok: false,
      source,
      found: 0,
      upserted: 0,
      errors: [`Not a puppeteer source. Allowed: ${PUPPETEER_INGEST_SOURCES.join(", ")}`]
    };
  }
  return runIngestScrape(source, options);
}

export async function runPuppeteerIngestAll(sources = getPuppeteerCronSources(), options = {}) {
  if (!isPuppeteerScrapeEnabled()) {
    return {
      ok: false,
      errors: ["Puppeteer scrape disabled — set JAB_RE_PUPPETEER_SCRAPE=1"],
      results: []
    };
  }
  const results = [];
  for (const source of sources) {
    results.push(await runIngestScrape(source, options));
  }
  const upserted = results.reduce((n, r) => n + (r.upserted || 0), 0);
  return { ok: results.every((r) => r.ok || r.upserted > 0), upserted, results };
}

/** Dry-run row count without Supabase write (health check). */
export async function probePuppeteerSource(source) {
  if (!isPuppeteerScrapeEnabled()) return { ok: false, error: "disabled" };
  const result = await scrapeSourceToRows(source, { maxPages: 1 });
  return { ok: result.rows?.length > 0, found: result.found, errors: result.errors };
}
