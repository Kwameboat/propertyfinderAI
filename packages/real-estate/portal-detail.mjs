/**
 * Parse portal listing detail pages — __NEXT_DATA__ / JSON-LD / og:image.
 * Returns full listing rows with photo galleries (same shape as Apify ingest).
 */

import { fetchText, extractNextData, extractJsonLd } from "./scrapers/http.mjs";
import { hasNextData, isBlockedHtml } from "./scrapers/puppeteer/browser.mjs";
import {
  normalizePropertyFinderHtml,
  normalizeRapidApiProperty,
  normalizeDubizzleHtml,
  normalizeListingRow
} from "./scrapers/normalize.mjs";
import { filterValidPortalImages, extractImagesFromText } from "./listing-images.mjs";

const EMIRATE_FROM_SLUG = {
  dubai: "Dubai",
  "abu-dhabi": "Abu Dhabi",
  sharjah: "Sharjah",
  ajman: "Ajman",
  "ras-al-khaimah": "Ras Al Khaimah",
  fujairah: "Fujairah",
  "umm-al-quwain": "Umm Al Quwain"
};

export function detectPortalFromUrl(url = "") {
  const u = String(url);
  if (/propertyfinder\.ae/i.test(u)) return "propertyfinder";
  if (/bayut\.com/i.test(u)) return "bayut";
  if (/dubizzle\.com/i.test(u)) return "dubizzle";
  return null;
}

function inferTransactionType(url = "", prop = {}) {
  const u = String(url).toLowerCase();
  const text = JSON.stringify(prop).toLowerCase();
  if (/to-rent|for-rent|property-for-rent|\/rent\/|purpose.*rent/i.test(u + text)) return "rent";
  if (/for-sale|property-for-sale|\/buy\/|off.plan|off_plan|new-projects/i.test(u + text)) {
    return /off.plan|new-projects|under-construction/i.test(u + text) ? "off_plan" : "sale";
  }
  if (prop.purpose === "for-rent" || prop.listing_category === "rent") return "rent";
  return "rent";
}

function emirateFromUrl(url = "") {
  const u = String(url).toLowerCase();
  for (const [slug, name] of Object.entries(EMIRATE_FROM_SLUG)) {
    if (u.includes(slug) || u.includes(name.toLowerCase().replace(/\s+/g, "-"))) return name;
  }
  if (/abudhabi\.dubizzle|abu-dhabi/i.test(u)) return "Abu Dhabi";
  if (/sharjah\.dubizzle/i.test(u)) return "Sharjah";
  if (/ajman\.dubizzle/i.test(u)) return "Ajman";
  return "Dubai";
}

function emirateFromProp(prop = {}, url = "") {
  const loc = prop.location;
  if (Array.isArray(loc)) {
    const hit = loc.find((l) => l.level === 1);
    const name = hit?.name?.en || hit?.name;
    if (name) return String(name).trim();
  }
  if (prop.location?.name) {
    return String(prop.location.name).split(",")[0].trim();
  }
  if (prop.location?.path_name) {
    return String(prop.location.path_name).split(",")[0].trim();
  }
  return emirateFromUrl(url);
}

function findPropertyPayload(next = {}) {
  const pp = next?.props?.pageProps || {};
  return (
    pp.property ||
    pp.listing?.property ||
    pp.listing ||
    pp.ad ||
    pp.adDetail ||
    pp.propertyData ||
    pp.data?.property ||
    pp.data?.listing ||
    pp.initialState?.listing ||
    null
  );
}

function extractOgImages(html = "") {
  const found = new Set();
  const src = String(html);
  for (const m of src.matchAll(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/gi)) {
    found.add(m[1]);
  }
  for (const m of src.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/gi)) {
    found.add(m[1]);
  }
  return [...found];
}

function parseJsonLdListing(blocks = [], url = "") {
  const flat = blocks.flatMap((b) => (Array.isArray(b) ? b : [b])).filter(Boolean);
  for (const block of flat) {
    const type = String(block["@type"] || "").toLowerCase();
    if (!/apartment|house|product|realestate|residence|offer/i.test(type)) continue;

    const images = [];
    if (block.image) {
      const imgs = Array.isArray(block.image) ? block.image : [block.image];
      for (const img of imgs) {
        if (typeof img === "string") images.push(img);
        else if (img?.url) images.push(img.url);
        else if (img?.contentUrl) images.push(img.contentUrl);
      }
    }

    const price =
      block.offers?.price ||
      block.price ||
      block.offers?.[0]?.price ||
      "";
    const name = block.name || block.headline || "";
    const desc = block.description || "";

    if (!images.length && !name && !price) continue;

    const portal = detectPortalFromUrl(url) || "live_search";
    const tx = inferTransactionType(url, block);
    const emirate = emirateFromUrl(url);

    return normalizeListingRow({
      source: portal === "live_search" ? "live_search" : portal,
      external_id: String(block.sku || block.identifier || url.replace(/[^\d]/g, "").slice(-12) || Date.now()),
      source_url: url,
      transaction_type: tx,
      property_type: "apartment",
      emirate,
      community: block.address?.addressLocality || "",
      price_aed: Number(String(price).replace(/[^0-9.]/g, "")) || 0,
      images: filterValidPortalImages(images),
      description: String(desc || name).slice(0, 2000)
    });
  }
  return null;
}

function parsePropertyFinderDetail(next, url) {
  const prop = findPropertyPayload(next);
  if (!prop?.id && !prop?.externalID) return null;
  const emirate = emirateFromProp(prop, url);
  const tx = inferTransactionType(url, prop);
  return normalizePropertyFinderHtml(prop, emirate, tx === "off_plan" ? "sale" : tx);
}

function parseBayutDetail(next, url) {
  const prop = findPropertyPayload(next);
  if (!prop) return null;
  const purpose = inferTransactionType(url, prop) === "rent" ? "for-rent" : "for-sale";
  const row = normalizeRapidApiProperty(prop, purpose);
  if (!row.source_url || row.source_url === "https://www.bayut.com/") {
    row.source_url = url;
  }
  return row;
}

function parseDubizzleDetail(next, url) {
  const hit = findPropertyPayload(next);
  if (!hit) return null;
  const emirate = emirateFromProp(hit, url);
  const tx = inferTransactionType(url, hit);
  const row = normalizeDubizzleHtml(hit, emirate, tx === "off_plan" ? "sale" : tx);
  if (!row.source_url || row.source_url.includes("dubai.dubizzle.com/") && !url.includes(row.source_url)) {
    row.source_url = url;
  }
  return row;
}

function mergeListing(partial = {}, parsed = {}) {
  const images = filterValidPortalImages([...(partial.images || []), ...(parsed.images || [])]);
  return {
    ...partial,
    ...parsed,
    source_url: parsed.source_url || partial.source_url,
    external_id: parsed.external_id || partial.external_id,
    images,
    description: (parsed.description || partial.description || "").slice(0, 2000)
  };
}

async function fetchDetailHtml(url) {
  try {
    const html = await fetchText(url, { timeoutMs: 45000 });
    if (hasNextData(html) || extractOgImages(html).length || extractJsonLd(html).length) {
      return { html, engine: "fetch" };
    }
    if (!isBlockedHtml(html)) return { html, engine: "fetch" };
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), portalDetailFetchError: error.message, url: url.slice(0, 80) }));
  }

  const { fetchPortalHtml } = await import("./scrapers/puppeteer/browser.mjs");
  const result = await fetchPortalHtml(url);
  return { html: result.html, engine: result.engine || "puppeteer", format: result.format };
}

function parseListingFromHtml(html, url, partial = {}) {
  const portal = detectPortalFromUrl(url);
  let listing = null;

  const next = extractNextData(html);
  if (next && portal === "propertyfinder") listing = parsePropertyFinderDetail(next, url);
  else if (next && portal === "bayut") listing = parseBayutDetail(next, url);
  else if (next && portal === "dubizzle") listing = parseDubizzleDetail(next, url);

  if (!listing?.images?.length) {
    const ld = parseJsonLdListing(extractJsonLd(html), url);
    if (ld) listing = listing ? mergeListing(listing, ld) : ld;
  }

  if (!listing?.images?.length) {
    const og = filterValidPortalImages(extractOgImages(html));
    const inline = filterValidPortalImages(extractImagesFromText(html));
    const imgs = [...new Set([...og, ...inline])];
    if (imgs.length) {
      listing = mergeListing(listing || partial, {
        source: portal || partial.source || "live_search",
        source_url: url,
        external_id: partial.external_id || url.replace(/[^\dA-Za-z]/g, "").slice(-16),
        images: imgs,
        emirate: partial.emirate || emirateFromUrl(url),
        transaction_type: partial.transaction_type || inferTransactionType(url),
        price_aed: partial.price_aed || 0
      });
    }
  }

  if (listing) listing = mergeListing(partial, listing);
  return listing;
}

/**
 * Fetch a portal listing URL and return a normalized row with images.
 */
export async function enrichListingFromPortalUrl(sourceUrl = "", partial = {}) {
  const url = String(sourceUrl || partial.source_url || "").trim();
  if (!url.startsWith("http")) {
    return { ok: false, listing: partial, error: "invalid url", portal: null };
  }

  const portal = detectPortalFromUrl(url);
  if (!portal) {
    return { ok: false, listing: partial, error: "unsupported portal", portal: null };
  }

  try {
    const { html, engine, format } = await fetchDetailHtml(url);

    if (format === "markdown") {
      const fromMd = filterValidPortalImages(extractImagesFromText(html));
      if (fromMd.length) {
        const listing = mergeListing(partial, {
          source: portal,
          source_url: url,
          images: fromMd,
          emirate: partial.emirate || emirateFromUrl(url),
          transaction_type: partial.transaction_type || inferTransactionType(url)
        });
        return { ok: listingHasPhotos(listing), listing, portal, engine: "jina-markdown" };
      }
    }

    const listing = parseListingFromHtml(html, url, { ...partial, source: partial.source || portal });
    const ok = Boolean(listing && filterValidPortalImages(listing.images || []).length);
    return { ok, listing: listing || partial, portal, engine };
  } catch (error) {
    return { ok: false, listing: partial, error: error.message, portal };
  }
}

function listingHasPhotos(listing) {
  return filterValidPortalImages(listing?.images || []).length > 0;
}

async function mapWithConcurrency(items, fn, concurrency = 3) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker()));
  return out;
}

/** Enrich multiple portal URLs (for n8n / batch). */
export async function enrichListingsFromPortalUrls(entries = [], { concurrency = 3 } = {}) {
  const rows = entries.map((entry) => {
    if (typeof entry === "string") return { url: entry, partial: {} };
    const url = entry.url || entry.source_url || "";
    const partial = entry.partial ? { ...entry.partial, source_url: url } : { ...entry, source_url: url };
    return { url, partial };
  });
  return mapWithConcurrency(
    rows,
    async ({ url, partial }) => enrichListingFromPortalUrl(url, partial || {}),
    concurrency
  );
}

export { inferTransactionType, emirateFromUrl };
