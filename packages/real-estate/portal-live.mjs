/**
 * On-demand portal SERP pull — Property Finder + Bayut Algolia for live chat.
 */

import { extractNextData, sleep, rateLimitMs } from "./scrapers/http.mjs";
import { normalizePropertyFinderHtml } from "./scrapers/normalize.mjs";
import { searchBayutAlgoliaRows } from "./scrapers/bayut-algolia.mjs";
import { fetchPortalHtml } from "./scrapers/puppeteer/browser.mjs";
import { parsePropertyFinderJinaMarkdown } from "./scrapers/puppeteer/jina-pf.mjs";
import { communityToPfSlug } from "./scrape-matrix.mjs";
import { inferEmirateFromListing } from "./emirate-scope.mjs";
import { inferBedsFromListing } from "./listing-polish.mjs";
import { withPortalSlot } from "./portal-semaphore.mjs";

const EMIRATE_SLUGS = {
  Dubai: "dubai",
  "Abu Dhabi": "abu-dhabi",
  Sharjah: "sharjah",
  Ajman: "ajman",
  "Ras Al Khaimah": "ras-al-khaimah",
  Fujairah: "fujairah",
  "Umm Al Quwain": "umm-al-quwain"
};

function serpPath(transactionType, beds) {
  const base = transactionType === "rent" ? "apartments-for-rent" : "apartments-for-sale";
  if (beds === 0) return `studio-${base}`;
  if (beds != null && Number(beds) > 0) return `${Number(beds)}-bedroom-${base}`;
  return base;
}

function parsePfNextData(data, emirate, transactionType) {
  const rows = [];
  const listings = data?.props?.pageProps?.searchResult?.listings || [];
  for (const item of listings) {
    const prop = item?.property;
    if (!prop?.id) continue;
    rows.push(normalizePropertyFinderHtml(prop, emirate, transactionType));
  }
  return rows.filter((r) => Number(r.price_aed) > 0);
}

export function buildPropertyFinderSerpUrl(criteria = {}) {
  const emirate = criteria.emirate || criteria.emirates?.[0] || "Dubai";
  const emSlug = EMIRATE_SLUGS[emirate] || "dubai";
  const tx = criteria.transaction_type === "sale" ? "sale" : "rent";
  const segment = tx === "rent" ? "rent" : "buy";
  const serp = serpPath(tx, criteria.beds);
  const commSlug = criteria.community ? communityToPfSlug(criteria.community, emirate) : null;
  if (commSlug) {
    return `https://www.propertyfinder.ae/en/${segment}/${emSlug}/${serp}-${commSlug}.html`;
  }
  return `https://www.propertyfinder.ae/en/${segment}/${emSlug}/${serp}.html`;
}

function matchesCriteria(row, criteria = {}) {
  const wantEmirate = criteria.emirate || criteria.emirates?.[0];
  const rowEmirate = inferEmirateFromListing(row) || row.emirate;
  if (wantEmirate && rowEmirate && rowEmirate !== wantEmirate) return false;
  if (criteria.emirates?.length > 1 && rowEmirate && !criteria.emirates.includes(rowEmirate)) return false;
  if (criteria.beds != null) {
    const beds = inferBedsFromListing(row);
    if (beds == null || Number(beds) !== Number(criteria.beds)) return false;
  }
  if (criteria.max_price != null && Number(row.price_aed) > Number(criteria.max_price)) return false;
  if (criteria.min_price != null && Number(row.price_aed) < Number(criteria.min_price)) return false;
  if (criteria.community && row.community) {
    const want = String(criteria.community).toLowerCase().replace(/\s+/g, " ");
    const have = String(row.community).toLowerCase();
    if (!have.includes(want.slice(0, Math.min(5, want.length))) && !want.includes(have.slice(0, 5))) {
      return false;
    }
  }
  return true;
}

export async function fetchPortalLiveListings(criteria = {}, { maxPages = 2, maxHits = 40 } = {}) {
  return withPortalSlot(() => fetchPortalLiveListingsInner(criteria, { maxPages, maxHits }));
}

async function fetchPortalLiveListingsInner(criteria = {}, { maxPages = 2, maxHits = 40 } = {}) {
  const emirate = criteria.emirate || criteria.emirates?.[0] || "Dubai";
  const tx = criteria.transaction_type === "sale" ? "sale" : "rent";
  const rows = [];
  const seen = new Set();
  const errors = [];

  function addRow(row) {
    if (!row?.source_url || !Number(row.price_aed)) return;
    if (criteria.beds != null && (row.beds == null || row.beds === "")) {
      row = { ...row, beds: Number(criteria.beds) };
    }
    const key = `${row.source}:${row.external_id}`;
    if (seen.has(key)) return;
    if (!matchesCriteria(row, criteria)) return;
    seen.add(key);
    rows.push(row);
  }

  try {
    const bayut = await searchBayutAlgoliaRows(criteria, { maxPages, maxHits: Math.min(maxHits, 30) });
    for (const row of bayut.rows || []) addRow(row);
    if (bayut.errors?.length) errors.push(...bayut.errors.slice(0, 2));
  } catch (error) {
    errors.push(`bayut: ${error.message}`);
  }

  const baseUrl = buildPropertyFinderSerpUrl({ ...criteria, emirate, transaction_type: tx });
  for (let page = 1; page <= maxPages && rows.length < maxHits; page++) {
    const url = page <= 1 ? baseUrl : `${baseUrl}?page=${page}`;
    try {
      const { html, format } = await fetchPortalHtml(url);
      let pageRows = [];
      if (format === "markdown") {
        pageRows = parsePropertyFinderJinaMarkdown(html, { emirate, transactionType: tx });
      } else {
        const next = extractNextData(html);
        if (next) pageRows = parsePfNextData(next, emirate, tx);
      }
      if (!pageRows.length) break;
      for (const row of pageRows) addRow(row);
    } catch (error) {
      errors.push(`pf page ${page}: ${error.message}`);
      break;
    }
    await sleep(rateLimitMs());
  }

  return { rows: rows.slice(0, maxHits), errors };
}
