/**
 * Ghana listing ingest for FIE AI on Vercel.
 * Scrapes public portals → Supabase. Designed as short cron "ticks"
 * so each invocation fits serverless time limits.
 */
import { isGhanaMarket, GHANA_PORTALS } from "./market.mjs";
import { getScrapeEmirates } from "./mode.mjs";
import { runIngestScrape, runIngestStaleCleanup, ingestListingBatch } from "./ingest.mjs";
import { isSupabaseEnabled } from "./supabase.mjs";
import { clusterKey } from "./cluster.mjs";

/**
 * Portals that work from Vercel without FlareSolverr/Puppeteer.
 * Ghana Property Centre is the primary live source; Meqasa is best-effort
 * (often JS-rendered / empty from datacenter IPs).
 */
export const VERCEL_SAFE_GHANA_SOURCES = ["ghanapropertycentre", "meqasa"];

export function jijiScrapeAvailable() {
  return Boolean(String(process.env.FLARESOLVERR_URL || "").trim());
}

export function ghanaIngestSources({ includeJiji = jijiScrapeAvailable() } = {}) {
  const raw = String(process.env.JAB_RE_N8N_SOURCES || process.env.JAB_FIE_SCRAPE_SOURCES || "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => GHANA_PORTALS.includes(s) || s === "tonaton");
  }
  const sources = [...VERCEL_SAFE_GHANA_SOURCES];
  if (includeJiji) sources.push("jiji");
  return sources;
}

/**
 * Fixed tick queue — one city × one type × one source per cron run.
 * Keeps each Vercel invocation under ~60s.
 */
export function buildGhanaScrapeTicks({
  sources = ghanaIngestSources(),
  cities = getScrapeEmirates(),
  types = ["rent", "sale"],
  maxPages = Number(process.env.JAB_FIE_SCRAPE_MAX_PAGES || 1)
} = {}) {
  const ticks = [];
  for (const source of sources) {
    for (const city of cities) {
      for (const type of types) {
        ticks.push({
          source,
          emirates: [city],
          types: [type],
          maxPages: Math.max(1, Math.min(3, maxPages))
        });
      }
    }
  }
  return ticks;
}

export function pickGhanaScrapeTick(ticks = buildGhanaScrapeTicks(), atMs = Date.now()) {
  if (!ticks.length) return null;
  const slotMinutes = Number(process.env.JAB_FIE_SCRAPE_TICK_MINUTES || 120);
  const slot = Math.floor(atMs / (Math.max(15, slotMinutes) * 60 * 1000));
  return { ...ticks[slot % ticks.length], tickIndex: slot % ticks.length, tickCount: ticks.length };
}

export async function runGhanaScrapeTick(options = {}) {
  if (!isSupabaseEnabled()) {
    throw new Error("Supabase required — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!isGhanaMarket() && process.env.JAB_FIE_STANDALONE !== "1") {
    // Still allow when explicitly Ghana env is set by caller.
  }

  const tick = options.tick || pickGhanaScrapeTick(buildGhanaScrapeTicks({
    sources: options.sources,
    cities: options.emirates || options.cities,
    types: options.types,
    maxPages: options.maxPages
  }));
  if (!tick) throw new Error("No Ghana scrape ticks configured");

  const result = await runIngestScrape(tick.source, {
    emirates: tick.emirates,
    types: tick.types,
    maxPages: tick.maxPages
  });

  let stale = null;
  if (options.staleCleanup !== false && (result.upserted || 0) > 0) {
    try {
      stale = await runIngestStaleCleanup();
    } catch (error) {
      stale = { ok: false, error: error.message };
    }
  }

  return {
    ok: Boolean(result.ok),
    mode: "tick",
    tick: {
      index: tick.tickIndex,
      count: tick.tickCount,
      source: tick.source,
      emirates: tick.emirates,
      types: tick.types,
      maxPages: tick.maxPages
    },
    ...result,
    stale
  };
}

export async function runGhanaScrapeAll(options = {}) {
  if (!isSupabaseEnabled()) {
    throw new Error("Supabase required — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  const sources = options.sources?.length ? options.sources : ghanaIngestSources();
  const results = [];
  for (const source of sources) {
    try {
      results.push(
        await runIngestScrape(source, {
          emirates: options.emirates || getScrapeEmirates(),
          types: options.types || ["rent", "sale"],
          maxPages: options.maxPages ?? Number(process.env.JAB_FIE_SCRAPE_MAX_PAGES || 2)
        })
      );
    } catch (error) {
      results.push({ ok: false, source, found: 0, upserted: 0, errors: [error.message] });
    }
  }
  let stale = null;
  try {
    stale = await runIngestStaleCleanup();
  } catch (error) {
    stale = { ok: false, error: error.message };
  }
  return {
    ok: results.some((r) => r.ok),
    mode: "all",
    sources,
    results,
    totalUpserted: results.reduce((n, r) => n + (r.upserted || 0), 0),
    stale
  };
}

/** Ensure cluster_id is set before Supabase upsert. */
export function withClusterId(listing) {
  if (!listing || typeof listing !== "object") return listing;
  return { ...listing, cluster_id: listing.cluster_id || clusterKey(listing) };
}

export async function ingestGhanaListingBatch(rawListings = [], { source } = {}) {
  const rows = (rawListings || []).map(withClusterId);
  return ingestListingBatch(rows, { source });
}
