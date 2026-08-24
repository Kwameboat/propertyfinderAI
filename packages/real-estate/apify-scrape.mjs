/**
 * Apify scrape adapters — Bayut, Property Finder, Dubizzle (all 7 emirates, rent + sale).
 */

import {
  isApifyConfigured,
  runApifyActorAndGetItems,
  defaultApifyEmirates,
  normalizeApifyTransactionTypes,
  bayutPurposeFromType,
  propertyFinderPurposeFromType,
  isApifyPrimaryPortal,
  apifyBayutActorId,
  apifyBayutUsesStartUrls,
  apifyPropertyFinderActorId,
  buildPropertyFinderApifyInput,
  propertyFinderUsesApify,
  apifyDubizzleActorId,
  apifyMaxPages,
  apifyMaxResults,
  apifyProxyConfiguration,
  apifyWaitForFinishSec,
  isApifyFreeMode
} from "./apify-client.mjs";
import { normalizeApifyItems } from "./apify-normalize.mjs";

const EMIRATE_SLUGS = {
  Dubai: "dubai",
  "Abu Dhabi": "abu-dhabi",
  Sharjah: "sharjah",
  Ajman: "ajman",
  "Ras Al Khaimah": "ras-al-khaimah",
  Fujairah: "fujairah",
  "Umm Al Quwain": "umm-al-quwain"
};

export function isApifyFallbackSource(source) {
  return isApifyPrimaryPortal(source);
}

export { propertyFinderUsesApify, isApifyPrimaryPortal };

function propertyFinderSearchUrl(emirate, transactionType) {
  const slug = EMIRATE_SLUGS[emirate];
  if (!slug) return null;
  const tx = transactionType === "rent" ? "rent" : "buy";
  const path = transactionType === "rent" ? "apartments-for-rent" : "apartments-for-sale";
  return `https://www.propertyfinder.ae/en/${tx}/${slug}/${path}.html`;
}

function bayutSearchUrl(emirate, transactionType) {
  const slug = EMIRATE_SLUGS[emirate] || emirate.toLowerCase().replace(/\s+/g, "-");
  const path = transactionType === "rent" ? "to-rent" : "for-sale";
  return `https://www.bayut.com/${path}/apartments/${slug}/`;
}

function resolveScrapeOptions(options = {}) {
  return {
    emirates: options.emirates || defaultApifyEmirates(),
    types: normalizeApifyTransactionTypes(options.types || options.purposes),
    maxResults: options.maxResults || apifyMaxResults(),
    maxPages: options.maxPages || apifyMaxPages(),
    waitForFinishSec: options.waitForFinishSec || apifyWaitForFinishSec(),
    actorId: options.actorId,
    useResidentialProxy: options.useResidentialProxy
  };
}

export async function fetchPropertyFinderApifyRows(options = {}) {
  if (!isApifyConfigured()) {
    return { rows: [], found: 0, errors: ["APIFY_API_TOKEN not set"], actorId: null };
  }

  const { emirates, types, maxResults, waitForFinishSec, actorId, useResidentialProxy } =
    resolveScrapeOptions(options);
  const pfActor = actorId || apifyPropertyFinderActorId();
  const errors = [];
  const allRows = [];
  let found = 0;

  for (const type of types) {
    const purpose = propertyFinderPurposeFromType(type);
    try {
      const input = buildPropertyFinderApifyInput({
        locations: emirates,
        purpose,
        maxResults,
        searchUrls: [],
        useResidentialProxy
      });
      const { items } = await runApifyActorAndGetItems(pfActor, input, {
        waitForFinishSec,
        limit: maxResults * emirates.length * 2
      });
      const rows = normalizeApifyItems("propertyfinder", items).map((row) => ({
        ...row,
        transaction_type: row.transaction_type || type
      }));
      found += rows.length;
      allRows.push(...rows);
    } catch (error) {
      errors.push(`propertyfinder/all/${type}: ${error.message}`);
    }
  }

  return { rows: allRows, found, errors, actorId: pfActor };
}

export async function scrapePropertyFinderApify(db, upsertListing, options = {}) {
  const { rows, found, errors } = await fetchPropertyFinderApifyRows(options);
  let upserted = 0;
  for (const row of rows) {
    upsertListing(db, row);
    upserted++;
  }
  return { found, upserted, errors };
}

function buildBayutBatchInput(actorId, emirates, types, options) {
  if (!apifyBayutUsesStartUrls(actorId)) return null;
  const startUrls = [];
  for (const emirate of emirates) {
    for (const type of types) {
      startUrls.push(bayutSearchUrl(emirate, type));
    }
  }
  return { startUrls, maxItems: options.maxResults || apifyMaxResults() };
}

export async function fetchBayutApifyRows(options = {}) {
  if (!isApifyConfigured()) {
    return { rows: [], found: 0, errors: ["APIFY_API_TOKEN not set"], actorId: null };
  }

  const opts = resolveScrapeOptions(options);
  const bayutActor = opts.actorId || apifyBayutActorId();
  const errors = [];
  const allRows = [];
  let found = 0;

  const batchInput = buildBayutBatchInput(bayutActor, opts.emirates, opts.types, opts);
  if (batchInput) {
    try {
      const { items } = await runApifyActorAndGetItems(bayutActor, batchInput, {
        waitForFinishSec: opts.waitForFinishSec,
        limit: opts.maxResults * opts.emirates.length * opts.types.length * 2
      });
      const rows = normalizeApifyItems("bayut", items);
      found += rows.length;
      allRows.push(...rows);
    } catch (error) {
      errors.push(`bayut/batch: ${error.message}`);
    }
    return { rows: allRows, found, errors, actorId: bayutActor };
  }

  for (const emirate of opts.emirates) {
    for (const type of opts.types) {
      const purpose = bayutPurposeFromType(type);
      try {
        const input = {
          purpose,
          location: emirate,
          category: "residential",
          subCategory: "apartments",
          status: "all",
          maxPages: opts.maxPages,
          maxItems: opts.maxResults,
          proxyConfiguration: apifyProxyConfiguration()
        };
        const { items } = await runApifyActorAndGetItems(bayutActor, input, {
          waitForFinishSec: opts.waitForFinishSec,
          limit: opts.maxResults * 2
        });
        const rows = normalizeApifyItems("bayut", items);
        found += rows.length;
        allRows.push(...rows);
      } catch (error) {
        errors.push(`bayut/${emirate}/${type}: ${error.message}`);
      }
    }
  }

  return { rows: allRows, found, errors, actorId: bayutActor };
}

export async function scrapeBayutApify(db, upsertListing, options = {}) {
  const { rows, found, errors } = await fetchBayutApifyRows(options);
  let upserted = 0;
  for (const row of rows) {
    upsertListing(db, row);
    upserted++;
  }
  return { found, upserted, errors };
}

export async function fetchDubizzleApifyRows(options = {}) {
  if (!isApifyConfigured()) {
    return { rows: [], found: 0, errors: ["APIFY_API_TOKEN not set"], actorId: null };
  }

  const opts = resolveScrapeOptions(options);
  const dubizzleActor = opts.actorId || apifyDubizzleActorId();
  const errors = [];
  const allRows = [];
  let found = 0;
  const cities = opts.emirates.map((e) => EMIRATE_SLUGS[e]).filter(Boolean);

  if (!cities.length) {
    return { rows: [], found: 0, errors: ["No Dubizzle city slugs for emirates"], actorId: dubizzleActor };
  }

  for (const type of opts.types) {
    try {
      const input = {
        cities,
        purpose: type,
        maxResults: opts.maxResults,
        useResidentialProxy: opts.useResidentialProxy ?? !isApifyFreeMode()
      };
      const { items } = await runApifyActorAndGetItems(dubizzleActor, input, {
        waitForFinishSec: opts.waitForFinishSec,
        limit: opts.maxResults * cities.length * 2
      });
      const rows = normalizeApifyItems("dubizzle", items).map((row) => ({
        ...row,
        transaction_type: row.transaction_type || type
      }));
      found += rows.length;
      allRows.push(...rows);
    } catch (error) {
      errors.push(`dubizzle/all/${type}: ${error.message}`);
    }
  }

  return { rows: allRows, found, errors, actorId: dubizzleActor };
}

export async function scrapeDubizzleApify(db, upsertListing, options = {}) {
  const { rows, found, errors } = await fetchDubizzleApifyRows(options);
  let upserted = 0;
  for (const row of rows) {
    upsertListing(db, row);
    upserted++;
  }
  return { found, upserted, errors };
}
