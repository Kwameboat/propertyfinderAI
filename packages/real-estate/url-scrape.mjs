/**
 * On-demand listing pull from a portal SERP or detail URL.
 */

import { extractNextData, sleep, rateLimitMs } from "./scrapers/http.mjs";
import { normalizeListingRow, normalizePropertyFinderHtml, normalizeDubizzleHtml } from "./scrapers/normalize.mjs";
import { fetchPortalHtml, closeBrowser } from "./scrapers/puppeteer/browser.mjs";
import { parsePropertyFinderJinaMarkdown } from "./scrapers/puppeteer/jina-pf.mjs";
import { prepareListing, ingestListingBatch } from "./ingest.mjs";
import {
  isSupabaseEnabled,
  startScrapeRunSupabase,
  finishScrapeRunSupabase
} from "./supabase.mjs";

const ALLOWED_HOSTS = [
  "www.propertyfinder.ae",
  "propertyfinder.ae",
  "www.bayut.com",
  "bayut.com",
  "dubai.dubizzle.com",
  "abudhabi.dubizzle.com",
  "sharjah.dubizzle.com",
  "ajman.dubizzle.com"
];

export function detectPortalFromUrl(rawUrl = "") {
  try {
    const u = new URL(String(rawUrl).trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "propertyfinder.ae") return { portal: "propertyfinder", host: u.hostname };
    if (host === "bayut.com") return { portal: "bayut", host: u.hostname };
    if (host.endsWith(".dubizzle.com") || host === "dubizzle.com") return { portal: "dubizzle", host: u.hostname };
    return { portal: null, host: u.hostname };
  } catch {
    return { portal: null, host: "" };
  }
}

export function validatePortalUrl(rawUrl = "") {
  const url = String(rawUrl || "").trim();
  if (!url) return { ok: false, error: "URL required" };
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return { ok: false, error: "HTTP/HTTPS only" };
    const allowed = ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h.replace(/^www\./, "")}`));
    if (!allowed) {
      return { ok: false, error: `Host not allowed. Use Property Finder, Bayut, or Dubizzle.` };
    }
    const { portal } = detectPortalFromUrl(url);
    if (!portal) return { ok: false, error: "Unrecognized portal URL" };
    return { ok: true, url: u.href, portal };
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
}

function inferEmirateFromUrl(url = "") {
  const s = String(url).toLowerCase();
  const map = [
    ["abu-dhabi", "Abu Dhabi"],
    ["dubai", "Dubai"],
    ["sharjah", "Sharjah"],
    ["ajman", "Ajman"],
    ["ras-al-khaimah", "Ras Al Khaimah"],
    ["fujairah", "Fujairah"],
    ["umm-al-quwain", "Umm Al Quwain"]
  ];
  for (const [slug, name] of map) {
    if (s.includes(slug)) return name;
  }
  return "Dubai";
}

function inferTransactionType(url = "") {
  const s = String(url).toLowerCase();
  if (/\/buy\/|for-sale|to-buy|\/sale\//.test(s)) return "sale";
  return "rent";
}

function nextPageUrl(url, portal, page) {
  if (page <= 1) return url;
  const u = new URL(url);
  if (portal === "propertyfinder") {
    u.searchParams.set("page", String(page));
    return u.href;
  }
  if (portal === "bayut") {
    const path = u.pathname.replace(/\/page-\d+\/?$/, "/");
    const base = path.endsWith("/") ? path.slice(0, -1) : path;
    u.pathname = `${base}/page-${page}/`;
    return u.href;
  }
  if (portal === "dubizzle") {
    u.searchParams.set("page", String(page));
    return u.href;
  }
  return url;
}

function parseBayutNextData(data, emirate, transactionType) {
  const rows = [];
  const hits =
    data?.props?.pageProps?.searchResult?.hits ||
    data?.props?.pageProps?.listings ||
    data?.props?.pageProps?.properties ||
    [];
  for (const hit of hits) {
    const id = hit.externalID || hit.id;
    if (!id) continue;
    rows.push(
      normalizeListingRow({
        source: "bayut",
        external_id: String(id),
        source_url: hit.slug
          ? `https://www.bayut.com/${hit.slug}`
          : `https://www.bayut.com/property/details-${id}.html`,
        transaction_type: transactionType,
        property_type: hit.categories?.[0]?.name?.singular || "apartment",
        beds: hit.rooms,
        baths: hit.baths,
        emirate,
        community: hit.location?.[2]?.name || hit.location?.[1]?.name || "",
        price_aed: Number(hit.price || 0),
        price_period: transactionType === "rent" ? hit.rentFrequency || "yearly" : "total",
        furnished:
          hit.furnishingStatus === "furnished"
            ? true
            : hit.furnishingStatus === "unfurnished"
              ? false
              : null,
        images: hit.coverPhoto?.url ? [hit.coverPhoto.url] : [],
        description: hit.title || "",
        agent_name: hit.contactName || "",
        agency_name: hit.agency?.name || ""
      })
    );
  }
  return rows.filter((r) => Number(r.price_aed) > 0);
}

function parsePropertyFinderNextData(data, emirate, transactionType) {
  const rows = [];
  const listings = data?.props?.pageProps?.searchResult?.listings || [];
  for (const item of listings) {
    const prop = item?.property;
    if (!prop?.id) continue;
    rows.push(normalizePropertyFinderHtml(prop, emirate, transactionType));
  }
  return rows.filter((r) => Number(r.price_aed) > 0);
}

function parseDubizzleNextData(data, emirate, transactionType) {
  const rows = [];
  const hits =
    data?.props?.pageProps?.listings?.hits ||
    data?.props?.pageProps?.searchResults?.hits ||
    data?.props?.pageProps?.initialReduxState?.listings?.items ||
    [];
  for (const hit of hits) {
    const id = hit.objectID || hit.id || hit.listing_id;
    if (!id) continue;
    rows.push(normalizeDubizzleHtml(hit, emirate, transactionType));
  }
  return rows.filter((r) => Number(r.price_aed) > 0);
}

async function parsePageRows(html, portal, meta, format) {
  if (portal === "propertyfinder" && format === "markdown") {
    return parsePropertyFinderJinaMarkdown(html, {
      emirate: meta.emirate,
      transactionType: meta.transactionType
    });
  }
  const next = extractNextData(html);
  if (!next) return [];
  if (portal === "propertyfinder") {
    return parsePropertyFinderNextData(next, meta.emirate, meta.transactionType);
  }
  if (portal === "bayut") return parseBayutNextData(next, meta.emirate, meta.transactionType);
  if (portal === "dubizzle") return parseDubizzleNextData(next, meta.emirate, meta.transactionType);
  return [];
}

export async function scrapeListingsFromUrl(rawUrl, options = {}) {
  const check = validatePortalUrl(rawUrl);
  if (!check.ok) return { ok: false, errors: [check.error], found: 0, upserted: 0 };

  const maxListings = Math.min(Math.max(Number(options.maxListings || 50), 1), 100);
  const maxPages = Math.min(Math.max(Number(options.maxPages || 5), 1), 10);
  const portal = check.portal;
  const emirate = options.emirate || inferEmirateFromUrl(check.url);
  const transactionType = options.transactionType || inferTransactionType(check.url);
  const meta = { emirate, transactionType };

  const errors = [];
  const engines = new Set();
  const collected = [];
  const seen = new Set();

  let runId = null;
  if (isSupabaseEnabled()) {
    runId = await startScrapeRunSupabase({ source: `manual_url_${portal}` }).catch(() => null);
  }

  try {
    for (let page = 1; page <= maxPages && collected.length < maxListings; page++) {
      const pageUrl = nextPageUrl(check.url, portal, page);
      try {
        const { html, engine, format } = await fetchPortalHtml(pageUrl);
        engines.add(engine);
        const rows = await parsePageRows(html, portal, meta, format);
        if (!rows.length) {
          errors.push(`page ${page}: no listings parsed`);
          break;
        }
        for (const row of rows) {
          const key = `${row.source}:${row.external_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push(row);
          if (collected.length >= maxListings) break;
        }
      } catch (e) {
        errors.push(`page ${page}: ${e.message}`);
        break;
      }
      if (page < maxPages && collected.length < maxListings) {
        await sleep(rateLimitMs());
      }
    }
  } finally {
    await closeBrowser();
  }

  let upserted = 0;
  if (collected.length && options.dryRun !== true) {
    const batch = await ingestListingBatch(collected, { source: `manual_url_${portal}` });
    upserted = batch.upserted || 0;
    if (batch.errors?.length) errors.push(...batch.errors);
  }

  if (runId) {
    await finishScrapeRunSupabase(runId, {
      listings_found: collected.length,
      listings_upserted: upserted,
      errors
    }).catch(() => {});
  }

  return {
    ok: upserted > 0 || (options.dryRun && collected.length > 0),
    portal,
    url: check.url,
    found: collected.length,
    upserted,
    errors,
    engine: [...engines].join("+") || "none",
    preview: collected.slice(0, 5).map((r) => ({
      source: r.source,
      external_id: r.external_id,
      emirate: r.emirate,
      community: r.community,
      beds: r.beds,
      price_aed: r.price_aed,
      source_url: r.source_url
    })),
    runId
  };
}
