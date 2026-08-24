/**
 * Apify-powered ingest — Bayut, Property Finder, Dubizzle → Supabase.
 */

import { isApifyConfigured, defaultApifyEmirates, normalizeApifyTransactionTypes } from "./apify-client.mjs";
import {
  fetchPropertyFinderApifyRows,
  fetchBayutApifyRows,
  fetchDubizzleApifyRows
} from "./apify-scrape.mjs";
import { normalizeApifyItems } from "./apify-normalize.mjs";
import { prepareListing, ingestListingBatch } from "./ingest.mjs";
import {
  batchSyncListingsToSupabase,
  startScrapeRunSupabase,
  finishScrapeRunSupabase,
  isSupabaseEnabled
} from "./supabase.mjs";

async function upsertPrepared(rows, source) {
  const prepared = rows.map((r) => prepareListing(r)).filter(Boolean);
  if (!prepared.length) return { found: rows.length, upserted: 0 };
  const { upserted } = await batchSyncListingsToSupabase(prepared);
  return { found: rows.length, upserted };
}

function baseApifyOptions(options = {}) {
  return {
    emirates: options.emirates || defaultApifyEmirates(),
    types: normalizeApifyTransactionTypes(options.types || options.purposes),
    purposes: options.purposes,
    maxResults: options.maxResults,
    maxPages: options.maxPages,
    actorId: options.actorId,
    waitForFinishSec: options.waitForFinishSec,
    useResidentialProxy: options.useResidentialProxy
  };
}

export async function runApifyBayutIngest(options = {}) {
  if (!isApifyConfigured()) throw new Error("APIFY_API_TOKEN not set");
  if (!isSupabaseEnabled()) throw new Error("Supabase required");

  const { rows, found, errors, actorId } = await fetchBayutApifyRows(baseApifyOptions(options));
  const result = await upsertPrepared(rows, "bayut_apify");

  return {
    ok: result.upserted > 0 || found > 0,
    source: "bayut_apify",
    found,
    upserted: result.upserted,
    errors,
    actorId,
    emirates: options.emirates || defaultApifyEmirates()
  };
}

export async function runApifyPropertyFinderIngest(options = {}) {
  if (!isApifyConfigured()) throw new Error("APIFY_API_TOKEN not set");
  if (!isSupabaseEnabled()) throw new Error("Supabase required");

  const { rows, found, errors, actorId } = await fetchPropertyFinderApifyRows(baseApifyOptions(options));
  const result = await upsertPrepared(rows, "propertyfinder_apify");

  return {
    ok: result.upserted > 0 || found > 0,
    source: "propertyfinder_apify",
    found,
    upserted: result.upserted,
    errors,
    actorId,
    emirates: options.emirates || defaultApifyEmirates()
  };
}

export async function runApifyDubizzleIngest(options = {}) {
  if (!isApifyConfigured()) throw new Error("APIFY_API_TOKEN not set");
  if (!isSupabaseEnabled()) throw new Error("Supabase required");

  const { rows, found, errors, actorId } = await fetchDubizzleApifyRows(baseApifyOptions(options));
  const result = await upsertPrepared(rows, "dubizzle_apify");

  return {
    ok: result.upserted > 0 || found > 0,
    source: "dubizzle_apify",
    found,
    upserted: result.upserted,
    errors,
    actorId,
    emirates: options.emirates || defaultApifyEmirates()
  };
}

export async function runApifyIngest(source, options = {}) {
  if (!isApifyConfigured()) {
    throw new Error("APIFY_API_TOKEN not set — get one at apify.com");
  }

  const normalized = String(source).replace(/_apify$/, "");
  const runId = await startScrapeRunSupabase({ source: `${normalized}_apify` }).catch(() => null);

  try {
    let result;
    if (normalized === "bayut") {
      result = await runApifyBayutIngest(options);
    } else if (normalized === "propertyfinder") {
      result = await runApifyPropertyFinderIngest(options);
    } else if (normalized === "dubizzle") {
      result = await runApifyDubizzleIngest(options);
    } else {
      throw new Error(`Apify ingest not supported for source: ${source}`);
    }

    if (runId) {
      await finishScrapeRunSupabase(runId, {
        listings_found: result.found,
        listings_upserted: result.upserted,
        errors: result.errors
      }).catch(() => {});
    }

    return result;
  } catch (error) {
    if (runId) {
      await finishScrapeRunSupabase(runId, { errors: [error.message] }).catch(() => {});
    }
    throw error;
  }
}

/** Ingest pre-fetched Apify dataset items (for n8n Apify node → Hub). */
export async function ingestApifyItems(source, items = []) {
  const rows = normalizeApifyItems(source, items);
  return ingestListingBatch(rows, { source: `${source}_apify` });
}

export { isApifyConfigured } from "./apify-client.mjs";
