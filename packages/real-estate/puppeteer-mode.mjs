/**
 * Puppeteer scrape mode — opt-in only (default OFF).
 * Does not affect HTML / Algolia / Apify / live-search paths.
 */

export function isPuppeteerScrapeEnabled() {
  const v = String(process.env.JAB_RE_PUPPETEER_SCRAPE ?? "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getPuppeteerMaxPages() {
  return Math.min(Math.max(Number(process.env.JAB_RE_PUPPETEER_MAX_PAGES || 3), 1), 15);
}

export function getPuppeteerDetailPages() {
  return Math.min(Math.max(Number(process.env.JAB_RE_PUPPETEER_DETAIL_PAGES || 0), 0), 20);
}

export function getPuppeteerPageDelayMs() {
  const fallback = Number(process.env.JAB_RE_SCRAPE_DELAY_MS || 3000);
  return Math.max(Number(process.env.JAB_RE_PUPPETEER_DELAY_MS || fallback), 1500);
}

export const PUPPETEER_INGEST_SOURCES = ["bayut_puppeteer", "propertyfinder_puppeteer", "dubizzle_puppeteer"];

/** Sources the daily timer / `--all` runs (default: Property Finder only). */
export function getPuppeteerCronSources() {
  const raw = String(process.env.JAB_RE_PUPPETEER_SOURCES || "propertyfinder_puppeteer").trim();
  const picked = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => PUPPETEER_INGEST_SOURCES.includes(s));
  return picked.length ? picked : ["propertyfinder_puppeteer"];
}

export function isPuppeteerIngestSource(source = "") {
  return PUPPETEER_INGEST_SOURCES.includes(String(source || "").trim());
}
