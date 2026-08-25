/**
 * Multi-source scrape runner — collects listing rows without SQLite writes.
 * Used by n8n ingest and /api/rent/ingest/scrape.
 */

import { scrapeBayutHtml } from "./scrapers/bayut-html.mjs";
import { scrapeBayutAlgolia } from "./scrapers/bayut-algolia.mjs";
import { scrapePropertyFinderHtml } from "./scrapers/propertyfinder-html.mjs";
import { scrapeDubizzleHtml } from "./scrapers/dubizzle-html.mjs";
import { scrapeDevelopers } from "./scrapers/developers.mjs";
import { scrapeBayutApi, isBayutApiConfigured } from "./scrapers/rapidapi-bayut.mjs";
import { scrapePropertyFinderApi, isPropertyFinderApiConfigured } from "./scrapers/rapidapi-propertyfinder.mjs";
import { scrapeBayutApify, scrapeDubizzleApify, scrapePropertyFinderApify, isApifyPrimaryPortal, propertyFinderUsesApify } from "./apify-scrape.mjs";
import { getScrapeEmirates } from "./mode.mjs";
import { isPuppeteerScrapeEnabled, isPuppeteerIngestSource, PUPPETEER_INGEST_SOURCES } from "./puppeteer-mode.mjs";
import { scrapeMeqasaHtml } from "./scrapers/meqasa-html.mjs";
import { scrapeGhanaPropertyCentreHtml } from "./scrapers/ghanapropertycentre-html.mjs";
import { scrapeJijiHtml, scrapeTonatonHtml } from "./scrapers/jiji-html.mjs";
import { GHANA_PORTALS } from "./market.mjs";

async function scrapeBayutCombined(db, upsert, options) {
  const emirates = options.emirates || getScrapeEmirates();
  const types = options.types || ["rent", "sale"];
  const maxPages = options.maxPages || 2;

  if (isApifyPrimaryPortal("bayut")) {
    const apify = await scrapeBayutApify(db, upsert, { emirates, types, maxPages, ...options });
    if (apify.upserted > 0) return apify;
    if (apify.found > 0) return apify;
  }

  const algolia = await scrapeBayutAlgolia(db, upsert, { emirates, types, maxPages });
  if (algolia.upserted > 0) return algolia;

  if (isBayutApiConfigured()) {
    try {
      const api = await scrapeBayutApi(db, upsert, { emirates, maxPages });
      if (api.upserted > 0) return api;
    } catch {
      /* fall through */
    }
  }

  const html = await scrapeBayutHtml(db, upsert, { emirates, types });
  if (html.upserted > 0) return html;

  if (isApifyPrimaryPortal("bayut")) {
    return {
      found: algolia.found + html.found,
      upserted: 0,
      errors: [...(algolia.errors || []), ...(html.errors || []), "Apify Bayut returned no upsertable rows"]
    };
  }

  const apify = await scrapeBayutApify(db, upsert, { emirates, maxPages: options.maxPages });
  if (apify.upserted > 0) return apify;

  return {
    found: algolia.found + html.found + (apify.found || 0),
    upserted: 0,
    errors: [...(algolia.errors || []), ...(html.errors || []), ...(apify.errors || [])]
  };
}

async function scrapeDubizzleCombined(db, upsert, options) {
  const emirates = options.emirates || getScrapeEmirates();
  const types = options.types || ["rent", "sale"];

  if (isApifyPrimaryPortal("dubizzle")) {
    const apify = await scrapeDubizzleApify(db, upsert, { emirates, types, ...options });
    if (apify.upserted > 0) return apify;
    if (apify.found > 0) return apify;
  }

  const htmlEmirates = emirates.filter((e) =>
    ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain"].includes(e)
  );
  const html = await scrapeDubizzleHtml(db, upsert, { emirates: htmlEmirates, types });
  if (html.upserted > 0) return html;

  if (isApifyPrimaryPortal("dubizzle")) {
    return {
      found: html.found,
      upserted: 0,
      errors: [...(html.errors || []), "Apify Dubizzle returned no upsertable rows"]
    };
  }

  const apify = await scrapeDubizzleApify(db, upsert, { emirates, types, ...options });
  if (apify.upserted > 0) return apify;

  return {
    found: html.found + (apify.found || 0),
    upserted: 0,
    errors: [...(html.errors || []), ...(apify.errors || [])]
  };
}

async function scrapePropertyFinderCombined(db, upsert, options) {
  const emirates = options.emirates || getScrapeEmirates();
  const types = options.types || ["rent", "sale"];

  if (propertyFinderUsesApify() || isApifyPrimaryPortal("propertyfinder")) {
    const apify = await scrapePropertyFinderApify(db, upsert, { emirates, types, ...options });
    if (apify.upserted > 0) return apify;
    if (apify.found > 0) return apify;
  }

  if (isPropertyFinderApiConfigured()) {
    try {
      const api = await scrapePropertyFinderApi(db, upsert, { emirates, maxPages: options.maxPages || 2 });
      if (api.upserted > 0) return api;
    } catch {
      /* fall through */
    }
  }

  const html = await scrapePropertyFinderHtml(db, upsert, { emirates, types });
  if (html.upserted > 0) return html;

  if (propertyFinderUsesApify() || isApifyPrimaryPortal("propertyfinder")) {
    return {
      found: html.found,
      upserted: 0,
      errors: [...(html.errors || []), "Apify Property Finder returned no upsertable rows"]
    };
  }

  return html;
}

/** Sources n8n cron branches call independently. */
export const GHANA_INGEST_SOURCES = [...GHANA_PORTALS];

export const INGEST_SOURCES = [
  "bayut",
  "propertyfinder",
  "dubizzle",
  "emaar",
  "damac",
  "bayut_api",
  "propertyfinder_api",
  ...GHANA_INGEST_SOURCES
];

export const DEFAULT_N8N_SOURCES = ["bayut", "propertyfinder", "dubizzle", "emaar", "damac"];

export { PUPPETEER_INGEST_SOURCES };

async function runPuppeteerSource(source, stubDb, upsert, options) {
  if (!isPuppeteerScrapeEnabled()) {
    return { found: 0, upserted: 0, errors: ["JAB_RE_PUPPETEER_SCRAPE not enabled"] };
  }
  const { scrapeBayutPuppeteer } = await import("./scrapers/puppeteer/bayut.mjs");
  const { scrapePropertyFinderPuppeteer } = await import("./scrapers/puppeteer/propertyfinder.mjs");
  const { scrapeDubizzlePuppeteer } = await import("./scrapers/puppeteer/dubizzle.mjs");
  const emirates = options.emirates || getScrapeEmirates();
  const types = options.types || ["rent", "sale"];
  const maxPages = options.maxPages;
  const map = {
    bayut_puppeteer: () => scrapeBayutPuppeteer(stubDb, upsert, { emirates, types, maxPages }),
    propertyfinder_puppeteer: () => scrapePropertyFinderPuppeteer(stubDb, upsert, { emirates, types, maxPages }),
    dubizzle_puppeteer: () => scrapeDubizzlePuppeteer(stubDb, upsert, { emirates, types, maxPages })
  };
  const fn = map[source];
  if (!fn) return { found: 0, upserted: 0, errors: [`Unknown puppeteer source: ${source}`] };
  return fn();
}

export const GHANA_SCRAPE_TYPES = ["rent", "sale"];

async function scrapeGhanaSource(scrapeFn, stubDb, upsert, options) {
  const cities = options.emirates?.length ? options.emirates : getScrapeEmirates();
  const types = options.types?.length ? options.types : GHANA_SCRAPE_TYPES;
  const pages = options.maxPages || 3;
  const errors = [];
  let found = 0;
  for (const city of cities) {
    for (const transactionType of types) {
      const result = await scrapeFn({ city, transactionType, pages });
      errors.push(...(result.errors || []));
      for (const row of result.listings || []) {
        upsert(stubDb, row);
        found += 1;
      }
    }
  }
  return { found, upserted: found, errors };
}

function collectRows() {
  const rows = [];
  const stubDb = {};
  const upsert = (_db, row) => {
    rows.push(row);
    return row;
  };
  return { stubDb, upsert, rows };
}

export async function scrapeSourceToRows(source, options = {}) {
  const { stubDb, upsert, rows } = collectRows();
  const emirates = options.emirates || getScrapeEmirates();
  const portalEmirates = options.emirates || getScrapeEmirates();
  const types = options.types || ["rent", "sale"];
  let found = 0;
  let errors = [];

  const runners = {
    bayut: () => scrapeBayutCombined(stubDb, upsert, { emirates: portalEmirates, types, maxPages: options.maxPages }),
    propertyfinder: () => scrapePropertyFinderCombined(stubDb, upsert, { emirates: portalEmirates, types, maxPages: options.maxPages }),
    dubizzle: () => scrapeDubizzleCombined(stubDb, upsert, { emirates: portalEmirates, types }),
    emaar: () => scrapeDevelopers(stubDb, upsert, { sources: ["emaar"] }),
    damac: () => scrapeDevelopers(stubDb, upsert, { sources: ["damac"] }),
    bayut_api: () => scrapeBayutApi(stubDb, upsert, { emirates: portalEmirates, maxPages: options.maxPages || 2 }),
    propertyfinder_api: () =>
      scrapePropertyFinderApi(stubDb, upsert, { emirates: portalEmirates, maxPages: options.maxPages || 2 }),
    meqasa: () => scrapeGhanaSource(scrapeMeqasaHtml, stubDb, upsert, options),
    jiji: () => scrapeGhanaSource(scrapeJijiHtml, stubDb, upsert, options),
    ghanapropertycentre: () => scrapeGhanaSource(scrapeGhanaPropertyCentreHtml, stubDb, upsert, options),
    tonaton: () => scrapeGhanaSource(scrapeTonatonHtml, stubDb, upsert, options)
  };

  const fn = runners[source];
  if (!fn) {
    if (isPuppeteerIngestSource(source)) {
      try {
        const result = await runPuppeteerSource(source, stubDb, upsert, options);
        found = result.found ?? rows.length;
        errors = result.errors || [];
      } catch (error) {
        errors = [error.message];
      }
      return {
        ok: errors.length === 0 || rows.length > 0,
        source,
        rows,
        found,
        upserted: rows.length,
        errors
      };
    }
    return { ok: false, source, rows: [], found: 0, upserted: 0, errors: [`Unknown source: ${source}`] };
  }

  if (source === "bayut_api" && !isBayutApiConfigured()) {
    return { ok: false, source, rows: [], found: 0, upserted: 0, errors: ["RAPIDAPI_KEY not set"] };
  }
  if (source === "propertyfinder_api" && !isPropertyFinderApiConfigured()) {
    return { ok: false, source, rows: [], found: 0, upserted: 0, errors: ["RAPIDAPI_KEY not set for Property Finder API"] };
  }

  try {
    const result = await fn();
    found = result.found ?? rows.length;
    errors = result.errors || [];
  } catch (error) {
    errors = [error.message];
  }

  return {
    ok: errors.length === 0 || rows.length > 0,
    source,
    rows,
    found,
    upserted: rows.length,
    errors
  };
}

export async function scrapeAllSourcesToSupabase(sources = DEFAULT_N8N_SOURCES, options = {}) {
  const results = [];
  for (const source of sources) {
    results.push(await scrapeSourceToRows(source, options));
  }
  return results;
}
