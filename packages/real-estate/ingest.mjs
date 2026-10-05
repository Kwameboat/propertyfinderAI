import { timingSafeEqual } from "node:crypto";
import { normalizeListingRow } from "./scrapers/normalize.mjs";
import { listingFingerprint } from "./fingerprint.mjs";
import {
  isSupabaseEnabled,
  batchSyncListingsToSupabase,
  startScrapeRunSupabase,
  finishScrapeRunSupabase,
  markStaleListingsSupabase
} from "./supabase.mjs";
import { scrapeSourceToRows } from "./scrape-runner.mjs";
import { getN8nIngestSources, getStaleHours } from "./mode.mjs";
import { clusterKey } from "./cluster.mjs";

import { isDemoListingRow } from "./supabase.mjs";

export function prepareListing(input = {}) {
  const normalized = normalizeListingRow(input);
  if (!normalized.source || !normalized.external_id) return null;
  if (isDemoListingRow(normalized)) return null;
  if (!normalized.transaction_type || !normalized.emirate) return null;
  if (!Number.isFinite(normalized.price_aed)) normalized.price_aed = 0;

  return {
    ...normalized,
    cluster_id: input.cluster_id || normalized.cluster_id || clusterKey(normalized),
    fingerprint: listingFingerprint(normalized),
    scraped_at: Date.now(),
    is_active: true,
    listing_status: normalized.listing_status || "available"
  };
}

export async function ingestListingBatch(rawListings = [], { source } = {}) {
  if (!isSupabaseEnabled()) {
    throw new Error("Supabase required — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const prepared = rawListings.map((row) => prepareListing(row)).filter(Boolean);
  if (!prepared.length) {
    return { ok: true, source: source || "batch", found: rawListings.length, upserted: 0, errors: ["No valid listings"] };
  }

  const { upserted } = await batchSyncListingsToSupabase(prepared);
  return {
    ok: true,
    source: source || prepared[0]?.source || "batch",
    found: rawListings.length,
    upserted,
    errors: []
  };
}

export async function runIngestScrape(source, options = {}) {
  if (!isSupabaseEnabled()) {
    throw new Error("Supabase required — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const runId = await startScrapeRunSupabase({ source }).catch((error) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), scrapeRunStartError: error.message, source }));
    return null;
  });
  const scrape = await scrapeSourceToRows(source, options);

  try {
    const prepared = scrape.rows.map((row) => prepareListing(row)).filter(Boolean);
    const { upserted } = prepared.length ? await batchSyncListingsToSupabase(prepared) : { upserted: 0 };

    if (runId) {
      await finishScrapeRunSupabase(runId, {
        listings_found: scrape.found,
        listings_upserted: upserted,
        errors: scrape.errors
      }).catch((error) => {
        console.error(JSON.stringify({ at: new Date().toISOString(), scrapeRunFinishError: error.message, source }));
      });
    }

    return {
      ok: scrape.ok,
      source,
      found: scrape.found,
      upserted,
      errors: scrape.errors,
      runId
    };
  } catch (error) {
    if (runId) {
      await finishScrapeRunSupabase(runId, {
        listings_found: scrape.found,
        listings_upserted: 0,
        errors: [...(scrape.errors || []), error.message]
      }).catch(() => {});
    }
    throw error;
  }
}

/** Run all sources independently (n8n multi-branch equivalent in one call). */
export async function runIngestScrapeAll(sources = getN8nIngestSources(), options = {}) {
  if (!isSupabaseEnabled()) {
    throw new Error("Supabase required — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  const results = [];
  for (const source of sources) {
    try {
      results.push(await runIngestScrape(source, options));
    } catch (error) {
      results.push({ ok: false, source, found: 0, upserted: 0, errors: [error.message] });
    }
  }

  try {
    await markStaleListingsSupabase({ maxAgeHours: getStaleHours() });
  } catch (error) {
    results.push({ ok: false, source: "stale_cleanup", errors: [error.message] });
  }

  const totalUpserted = results.reduce((n, r) => n + (r.upserted || 0), 0);
  return { ok: results.some((r) => r.ok), results, totalUpserted };
}

export async function runIngestStaleCleanup() {
  if (!isSupabaseEnabled()) {
    throw new Error("Supabase required");
  }
  await markStaleListingsSupabase({ maxAgeHours: getStaleHours() });
  return { ok: true, maxAgeHours: getStaleHours() };
}

export function verifyIngestToken(headerValue) {
  const expected = String(process.env.JAB_RE_INGEST_TOKEN || "").trim();
  if (!expected) return false;
  const provided = String(headerValue || "").trim();
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
