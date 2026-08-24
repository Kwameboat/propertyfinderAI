/**
 * Live market search — Gemini RAG (primary) with cache fallback.
 */

import { searchListings } from "../hub-db/real-estate.mjs";
import { searchUaeRealEstateWeb, formatWebBlockForPrompt } from "./web.mjs";
import {
  fetchGeminiMarketIntelligence,
  fetchGeminiMarketSnapshot,
  formatGeminiRagBlockForPrompt,
  geminiStatsToEmirateResults,
  detectCompareEmirates
} from "./gemini-rag.mjs";

export { detectCompareEmirates };

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export function computePriceStats(listings = []) {
  const prices = listings.map((l) => Number(l.price_aed)).filter((p) => p > 0);
  if (!prices.length) return null;
  return {
    median: median(prices),
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    min: Math.min(...prices),
    max: Math.max(...prices),
    p25: percentile(prices, 25),
    p75: percentile(prices, 75),
    sample: prices.length
  };
}

/** Fallback only when Gemini live search unavailable. */
export function fetchCachedEmirateStats(db, emirate, criteria = {}) {
  const beds = criteria.beds != null ? Number(criteria.beds) : null;
  let rows = searchListings(
    db,
    {
      transaction_type: criteria.transaction_type || "rent",
      emirate,
      beds: beds != null ? beds : undefined,
      community: criteria.community
    },
    300
  );
  if (beds === 0) rows = rows.filter((l) => l.beds === 0 || /studio/i.test(l.property_type || ""));
  else if (beds != null) rows = rows.filter((l) => l.beds === beds);

  const stats = computePriceStats(rows);
  if (!stats) return null;
  return { emirate, stats, source: "cached_inventory", listings: rows };
}

export async function fetchLiveEmirateStats(_emirate, criteria = {}, message = "") {
  const gemini = await fetchGeminiMarketIntelligence(message, criteria);
  if (gemini.ok && gemini.emirateStats[_emirate]) {
    return {
      ok: true,
      emirate: _emirate,
      source: "gemini_rag_live",
      fetchedAt: gemini.fetchedAt,
      stats: gemini.emirateStats[_emirate],
      listings: [],
      rawCount: gemini.emirateStats[_emirate].sample || 0
    };
  }
  return { ok: false, emirate: _emirate, error: gemini.error, source: "gemini_rag", stats: null, listings: [] };
}

export async function fetchLiveMarketSnapshot(db, criteria = {}, message = "") {
  const geminiSnap = await fetchGeminiMarketSnapshot(db, criteria, message);

  if (geminiSnap.ok) {
    return {
      ok: true,
      source: "gemini_rag_live",
      fetchedAt: geminiSnap.fetchedAt,
      emirateResults: geminiSnap.emirateResults,
      webHits: geminiSnap.webHits,
      gemini: geminiSnap.gemini
    };
  }

  const compare = detectCompareEmirates(criteria, message);
  const emirates = compare?.length ? compare : [criteria.emirate || criteria.emirates?.[0] || "Dubai"];
  const webHits = geminiSnap.webHits || (await searchUaeRealEstateWeb(message, { limit: 4 }));

  const cached = emirates
    .map((emirate) => {
      const c = fetchCachedEmirateStats(db, emirate, criteria);
      return c ? { ok: true, emirate, stats: c.stats, source: "cached_inventory_fallback", rawCount: c.stats.sample } : null;
    })
    .filter(Boolean);

  if (cached.length) {
    return {
      ok: true,
      source: "cached_inventory_fallback",
      fetchedAt: new Date().toISOString(),
      emirateResults: cached,
      webHits,
      errors: [geminiSnap.error].filter(Boolean)
    };
  }

  return { ok: false, source: "live_failed", emirateResults: [], webHits, errors: [geminiSnap.error].filter(Boolean) };
}

export async function resolveMarketStats(db, emirate, criteria = {}, message = "") {
  const live = await fetchLiveEmirateStats(emirate, criteria, message);
  if (live.ok && live.stats) return live;
  const cached = fetchCachedEmirateStats(db, emirate, criteria);
  if (cached) {
    return { ok: true, emirate, stats: cached.stats, source: "cached_inventory_fallback", listings: cached.listings, fetchedAt: null };
  }
  return { ok: false, emirate, stats: null, source: live.source, error: live.error };
}

export function formatLiveSearchBlockForPrompt(snapshot) {
  if (!snapshot) return "";

  if (snapshot.gemini?.ok) {
    return formatGeminiRagBlockForPrompt(snapshot.gemini, snapshot.webHits);
  }

  const lines = [];
  const asOf = snapshot.fetchedAt?.slice(0, 19) || new Date().toISOString().slice(0, 19);

  if (snapshot.ok && snapshot.emirateResults?.length) {
    lines.push(`MARKET FIGURES (${asOf} UTC — internal, do not mention source to user):`);
    for (const r of snapshot.emirateResults) {
      const s = r.stats;
      lines.push(
        `- ${r.emirate}: median AED ${s.median.toLocaleString()}/yr, range AED ${s.min.toLocaleString()}–${s.max.toLocaleString()}`
      );
    }
  } else {
    lines.push("Market figures unavailable — answer from general UAE knowledge only.");
  }

  if (snapshot.webHits?.length) {
    lines.push("", formatWebBlockForPrompt(snapshot.webHits));
  }

  return lines.join("\n");
}

/** Listings for chat — Supabase inventory (Gemini RAG is for market data, not listing cards). */
export async function fetchLiveListingsForChat(db, criteria = {}) {
  const { fetchListingsForChat } = await import("./listings-store.mjs");
  return fetchListingsForChat(db, criteria, 12);
}

export { fetchGeminiMarketIntelligence, fetchGeminiMarketSnapshot };
