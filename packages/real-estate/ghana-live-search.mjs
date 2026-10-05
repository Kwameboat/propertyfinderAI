/**
 * Ghana live search — n8n/SearXNG URLs plus Ghana Property Centre SERP parse.
 * Index/search pages are treated as result lists, not fake single listings.
 */

import { fetchText } from "./scrapers/http.mjs";
import { parseGpcSearchHtml } from "./scrapers/ghanapropertycentre-html.mjs";
import { scrapeJijiHtml } from "./scrapers/jiji-html.mjs";
import { fetchN8nLiveSearch, isN8nLiveSearchEnabled } from "./n8n-live-search.mjs";
import { prepareListing } from "./ingest.mjs";
import { isSupabaseEnabled, batchSyncListingsToSupabaseWithReturn } from "./supabase.mjs";
import { extractCriteria } from "./qualification.mjs";
import { isGhanaMarket } from "./market.mjs";
import { buildLiveSearchQuery } from "./live-search-query.mjs";
import { formatListingTitle } from "./listing-polish.mjs";

const REGION_SLUG = {
  Accra: "greater-accra",
  Madina: "greater-accra",
  Kasoa: "greater-accra",
  Kumasi: "ashanti",
  Tema: "tema",
  Takoradi: "western",
  "Cape Coast": "central",
  Tamale: "northern"
};

export function isGpcDetailUrl(url = "") {
  return /ghanapropertycentre\.com\/(?:for-rent|for-sale)\/.+\d{3,}-/i.test(url) && !/showtype/i.test(url);
}

export function isGpcSearchUrl(url = "") {
  const u = String(url || "");
  if (!/ghanapropertycentre\.com\/(?:for-rent|for-sale)\//i.test(u)) return false;
  if (isGpcDetailUrl(u)) return false;
  return /showtype|\/in\/|\/houses\/|\/flats-apartments\//i.test(u);
}

export function gpcLiveSearchUrls({ city = "Accra", area = "", transactionType = "rent" } = {}) {
  const purpose = transactionType === "sale" ? "for-sale" : "for-rent";
  const citySlug = String(city || "Accra").toLowerCase().replace(/\s+/g, "-");
  const region = REGION_SLUG[city] || "greater-accra";
  const slug = String(area || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug) {
    return [
      `https://ghanapropertycentre.com/${purpose}/houses/${region}/${slug}/showtype`,
      `https://ghanapropertycentre.com/${purpose}/flats-apartments/${region}/${slug}/showtype`
    ];
  }
  return [
    `https://ghanapropertycentre.com/${purpose}/houses/in/${citySlug}`,
    `https://ghanapropertycentre.com/${purpose}/flats-apartments/in/${citySlug}`
  ];
}

function uniqById(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.source}:${row.external_id}`;
    if (!row.source || !row.external_id) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function withTitles(listings, criteria) {
  return listings.map((l) => ({
    ...l,
    title: l.title || formatListingTitle(l, criteria),
    images: Array.isArray(l.images) ? l.images.filter(Boolean) : [],
    image: l.image || (Array.isArray(l.images) ? l.images[0] : null) || null
  }));
}

async function parseSearchUrl(url, { city, transactionType }) {
  const html = await fetchText(url, { timeoutMs: 25000 });
  const tx = /for-sale/i.test(url) ? "sale" : transactionType || "rent";
  return parseGpcSearchHtml(html, { city, transactionType: tx });
}

function urlsFromN8n(live = {}) {
  const urls = [];
  for (const row of live.listings || []) {
    if (row?.source_url) urls.push(String(row.source_url));
  }
  for (const row of live.inventory || []) {
    if (row?.url) urls.push(String(row.url));
  }
  return [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))];
}

export async function runGhanaLiveSearch(db, { query = "", message = "", criteria = {}, session = {}, limit = 12 } = {}) {
  if (!isGhanaMarket()) {
    return { ok: false, listings: [], sources: [], error: "Ghana market only" };
  }

  const inbound = String(message || query || "").trim();
  const merged = extractCriteria(inbound, criteria);
  const city = merged.emirate || criteria.emirate || "Accra";
  const transactionType = merged.transaction_type === "sale" ? "sale" : merged.transaction_type || "rent";
  const area = merged.community || criteria.community || "";
  const searchQuery = inbound || buildLiveSearchQuery(inbound, { ...merged, emirate: city, transaction_type: transactionType }, session);

  const errors = [];
  const sources = [];
  const searchUrls = gpcLiveSearchUrls({ city, area, transactionType });

  const n8nPromise = isN8nLiveSearchEnabled()
    ? fetchN8nLiveSearch(db, searchQuery, { ...merged, emirate: city, transaction_type: transactionType }, session).catch((error) => ({
        listings: [],
        inventory: [],
        error: error.message
      }))
    : Promise.resolve({ listings: [], inventory: [] });

  const serpPromise = Promise.all(
    searchUrls.map(async (url) => {
      try {
        const parsed = await parseSearchUrl(url, { city, transactionType });
        return { url, rows: parsed, error: null };
      } catch (error) {
        return { url, rows: [], error: `${url}: ${error.message}` };
      }
    })
  );

  const jijiPromise = scrapeJijiHtml({
    city,
    transactionType,
    pages: 1,
    query: area || ""
  }).catch((error) => ({ listings: [], errors: [error.message] }));

  const [live, serp, jiji] = await Promise.all([n8nPromise, serpPromise, jijiPromise]);
  if (live.error) errors.push(live.error);
  const n8nUrls = urlsFromN8n(live);
  if (n8nUrls.length) sources.push("n8n");

  let rows = [];
  for (const item of serp) {
    if (item.error) errors.push(item.error);
    if (item.rows.length) {
      rows.push(...item.rows);
      if (!sources.includes("gpc_live")) sources.push("gpc_live");
    }
  }

  const extraSerps = n8nUrls.filter(isGpcSearchUrl).filter((u) => !searchUrls.includes(u)).slice(0, 2);
  for (const url of extraSerps) {
    try {
      rows.push(...(await parseSearchUrl(url, { city, transactionType })));
      if (!sources.includes("gpc_live")) sources.push("gpc_live");
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  for (const row of live.listings || []) {
    if (Number(row.price_aed) > 0 && (isGpcDetailUrl(row.source_url) || /jiji\.com\.gh/i.test(row.source_url || ""))) {
      rows.push(row);
    }
  }

  if (jiji.errors?.length) errors.push(...jiji.errors.slice(0, 3));
  if (jiji.listings?.length) {
    rows.push(...jiji.listings);
    if (!sources.includes("jiji")) sources.push("jiji");
  }

  rows = uniqById(rows).filter((r) => Number(r.price_aed) > 0);
  if (area) {
    const q = area.toLowerCase();
    const areaMatch = rows.filter(
      (r) =>
        String(r.community || "").toLowerCase().includes(q) ||
        String(r.source_url || "").toLowerCase().includes(q.replace(/\s+/g, "-"))
    );
    if (areaMatch.length) rows = areaMatch;
  }
  if (transactionType) {
    rows = rows.filter((r) => r.transaction_type === transactionType);
  }
  rows = rows.slice(0, Math.min(Math.max(Number(limit) || 12, 4), 24));

  let upserted = 0;
  if (rows.length && isSupabaseEnabled()) {
    const prepared = rows.map((row) => prepareListing(row)).filter(Boolean);
    if (prepared.length) {
      const synced = await batchSyncListingsToSupabaseWithReturn(prepared);
      upserted = synced.length;
      const byKey = new Map(synced.map((l) => [`${l.source}:${l.external_id}`, l]));
      rows = rows.map((row) => {
        const dbRow = byKey.get(`${row.source}:${row.external_id}`);
        if (!dbRow) return row;
        return {
          ...row,
          ...dbRow,
          title: row.title || dbRow.title,
          images: (row.images || []).length ? row.images : dbRow.images
        };
      });
    }
  }

  const listings = withTitles(rows, merged);
  return {
    ok: listings.length > 0,
    listings,
    count: listings.length,
    upserted,
    sources,
    searchUrls,
    query: searchQuery,
    emirate: city,
    transaction_type: transactionType,
    community: area,
    n8n: isN8nLiveSearchEnabled(),
    errors: errors.slice(0, 8)
  };
}

export function liveSearchStatus() {
  return {
    enabled: true,
    n8n: isN8nLiveSearchEnabled(),
    webhook: Boolean(String(process.env.N8N_LIVE_SEARCH_WEBHOOK || "").trim())
  };
}
