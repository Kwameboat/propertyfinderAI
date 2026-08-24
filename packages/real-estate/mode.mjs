/**
 * Operating mode — $0 (HTML + Gemini RAG) vs paid (Apify/RapidAPI).
 */

import { isApifyConfigured, isApifyFreeMode, propertyFinderUsesApify, isApifyPrimaryPortal, ALL_UAE_EMIRATES } from "./apify-client.mjs";

export function isZeroCostMode() {
  const v = String(process.env.JAB_RE_ZERO_COST_MODE ?? "1").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const ZERO_COST_N8N_SOURCES = ["bayut", "propertyfinder", "dubizzle", "emaar", "damac"];

export function getN8nIngestSources() {
  if (isZeroCostMode()) return [...ZERO_COST_N8N_SOURCES];
  const raw = String(process.env.JAB_RE_N8N_SOURCES || "").trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [...ZERO_COST_N8N_SOURCES];
}

export function getStaleHours() {
  const fallback = isZeroCostMode() ? 96 : 72;
  return Number(process.env.JAB_RE_STALE_HOURS || fallback);
}

export function getScrapeDelayMs() {
  const fallback = isZeroCostMode() ? 3000 : 1500;
  return Number(process.env.JAB_RE_SCRAPE_DELAY_MS || fallback);
}

/** Emirates to scrape for portal HTML sources ($0 mode focuses on Dubai + Abu Dhabi). */
export function getScrapeEmirates() {
  const raw = String(process.env.JAB_RE_SCRAPE_EMIRATES || "").trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return isZeroCostMode() ? ["Dubai", "Abu Dhabi"] : ["Dubai", "Abu Dhabi", "Sharjah", "Ajman"];
}

export function getModeSummary() {
  return {
    zeroCost: isZeroCostMode(),
    ingestSources: getN8nIngestSources(),
    staleHours: getStaleHours(),
    scrapeDelayMs: getScrapeDelayMs(),
    rag: "gemini_google_search",
    listings: isApifyPrimaryPortal("propertyfinder")
      ? "supabase_apify_portals"
      : "supabase_html_scrape",
    propertyFinderScraper: propertyFinderUsesApify() ? "apify" : "html",
    apifyFallback: isApifyConfigured() ? ["bayut", "dubizzle"] : [],
    apifyPrimary: isApifyConfigured() ? ["bayut", "propertyfinder", "dubizzle"] : [],
    apifyEmirates: ALL_UAE_EMIRATES,
    apifyFreeMode: isApifyConfigured() && isApifyFreeMode()
  };
}
