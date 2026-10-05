/**
 * Jiji Ghana (and Tonaton) listing scrape.
 * Direct HTTP is Cloudflare-blocked from datacenter IPs; FlareSolverr is the working path.
 */

import { fetchText, sleep } from "./http.mjs";
import { normalizeListingRow } from "./normalize.mjs";
import {
  cookieHeader,
  flareSolverrGet,
  isFlareSolverrEnabled,
  jsonFromFlareHtml
} from "./flaresolverr.mjs";

const REGION_SLUG = {
  Accra: "greater-accra",
  Madina: "greater-accra",
  Kasoa: "greater-accra",
  Tema: "greater-accra",
  Kumasi: "ashanti",
  Takoradi: "western",
  "Cape Coast": "central",
  Tamale: "northern"
};

/** Accra and Tema share Greater Accra on Jiji — scrape each region once. */
export function uniqueJijiCities(cities = []) {
  const seen = new Set();
  const out = [];
  for (const city of cities) {
    const slug = REGION_SLUG[city] || String(city || "").toLowerCase();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(city);
  }
  return out.length ? out : ["Accra", "Kumasi"];
}

function parsePrice(text) {
  const m = String(text || "").replace(/,/g, "").match(/([\d]{2,9})/);
  return m ? Number(m[1]) : 0;
}

function decodeEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function attrValue(ad, name) {
  const attrs = Array.isArray(ad?.attrs) ? ad.attrs : [];
  const hit = attrs.find((a) => String(a?.name || "").toLowerCase() === name.toLowerCase());
  return hit?.value ?? hit?.semantic_value ?? null;
}

function cityFromJijiAd(ad, fallback = "Accra") {
  const blob = `${ad.region_parent_name || ""} ${ad.region_name || ""} ${ad.region || ""}`;
  if (/tema/i.test(blob)) return "Tema";
  if (/kumasi|ashanti/i.test(blob)) return "Kumasi";
  if (/takoradi|sekondi|western/i.test(blob)) return "Takoradi";
  if (/cape\s*coast|central/i.test(blob)) return "Cape Coast";
  if (/tamale|northern/i.test(blob)) return "Tamale";
  return fallback || "Accra";
}

function pushJijiUrl(urls, value) {
  const url = typeof value === "string" ? value : value?.url_large || value?.big_url || value?.original || value?.url;
  if (url) urls.push(String(url));
}

function imagesFromJijiAd(ad) {
  const urls = [];
  pushJijiUrl(urls, ad?.image_obj);
  pushJijiUrl(urls, ad?.image_obj?.url_large);
  pushJijiUrl(urls, ad?.image_url);
  for (const img of [...(ad?.images || []), ...(ad?.pictures || []), ...(ad?.photos || [])]) {
    pushJijiUrl(urls, img);
  }
  const unique = [...new Set(urls.filter(Boolean))];
  unique.sort((a, b) => jijiUrlWidth(b) - jijiUrlWidth(a));
  return unique;
}

function jijiUrlWidth(url = "") {
  const m = String(url).match(/_([A-Za-z0-9+/=]+)\.(?:jpe?g|png|webp)(?:\?|$)/i);
  if (!m) return 0;
  try {
    const w = Number(Buffer.from(m[1], "base64").toString("utf8").split("-")[0]);
    return Number.isFinite(w) ? w : 0;
  } catch {
    return 0;
  }
}

function listingUrl(ad, host) {
  const raw = decodeEntities(ad.url || ad.absolute_url || "");
  const path = raw.split("?")[0];
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) return `${host}${path}`;
  if (ad.slug) return `${host}/${ad.slug}`;
  return `${host}/${ad.id || ad.guid}`;
}

function propertyTypeFrom(ad) {
  const text = `${ad.title || ""} ${ad.slug || ""} ${ad.category_slug || ""}`.toLowerCase();
  if (/self-?contain/.test(text)) return "self-contain";
  if (/chamber/.test(text)) return "chamber-and-hall";
  if (/house|townhouse|duplex/.test(text)) return "house";
  return "apartment";
}

export function rowFromJijiAd(ad, city, transactionType, source) {
  const id = ad?.id || ad?.guid || ad?.slug;
  if (!id) return null;
  const host = source === "tonaton" ? "https://tonaton.com" : "https://jiji.com.gh";
  const title = ad.title || ad.name || "";
  const price = Number(ad.price_obj?.value || ad.price?.value || ad.price || parsePrice(ad.price_title || ad.price_text));
  if (!Number.isFinite(price) || price <= 0) return null;
  const resolvedCity = cityFromJijiAd(ad, city);
  const bedsRaw = attrValue(ad, "Bedrooms") ?? ad.bedrooms ?? ad.attrs?.rooms;
  const beds = bedsRaw == null ? null : Number(String(bedsRaw).replace(/[^\d]/g, "")) || null;
  return normalizeListingRow({
    source,
    external_id: String(id),
    source_url: listingUrl(ad, host),
    transaction_type: transactionType,
    property_type: propertyTypeFrom(ad),
    beds,
    baths: Number(attrValue(ad, "Bathrooms")) || null,
    emirate: resolvedCity,
    community: String(ad.region_name || ad.region_item_text || resolvedCity).split(",")[0].trim() || resolvedCity,
    price_aed: price,
    price_period: transactionType === "rent" || /month/i.test(ad.price_obj?.period || "") ? "monthly" : "total",
    images: imagesFromJijiAd(ad),
    description: ad.short_description || title,
    agency_name: `${source} listing`
  });
}

function parseJijiHtml(html, city, transactionType, source) {
  const rows = [];
  const seen = new Set();
  const hrefRe = /href="(https?:\/\/(?:jiji\.com\.gh|tonaton\.com)\/[^"]+)"/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const url = match[1].split("?")[0];
    if (!/houses-apartments|real-estate|property|\d{6,}/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const around = html.slice(Math.max(0, match.index - 300), match.index + 800);
    const price = parsePrice(around.match(/GH[S₵¢]?\s*([\d,]+)/i)?.[0]);
    const title = around.match(/>([A-Za-z0-9][^<]{8,90})</)?.[1] || city;
    const id = url.replace(/https?:\/\/[^/]+\//i, "").slice(0, 180);
    rows.push(
      normalizeListingRow({
        source,
        external_id: id,
        source_url: url,
        transaction_type: transactionType,
        property_type: /self-?contain/i.test(url + title) ? "self-contain" : "apartment",
        emirate: city,
        community: title.slice(0, 80),
        price_aed: price,
        price_period: transactionType === "rent" ? "monthly" : "total",
        description: title,
        agency_name: `${source} listing`
      })
    );
  }
  return rows.filter((r) => Number(r.price_aed) > 0);
}

function adsFromPayload(data) {
  return (
    data?.adverts_list?.adverts ||
    data?.data?.adverts ||
    data?.adverts ||
    []
  );
}

async function fetchJijiListingJson(url, session) {
  if (session.cookie) {
    try {
      const text = await fetchText(url, {
        timeoutMs: 25000,
        headers: {
          Accept: "application/json",
          "User-Agent": session.userAgent || "Mozilla/5.0",
          Cookie: session.cookie,
          Referer: "https://jiji.com.gh/"
        }
      });
      return JSON.parse(text);
    } catch {
      session.cookie = "";
    }
  }

  if (isFlareSolverrEnabled()) {
    const solution = await flareSolverrGet(url, { timeoutMs: 60000 });
    session.userAgent = solution.userAgent || session.userAgent;
    session.cookie = cookieHeader(solution.cookies);
    return jsonFromFlareHtml(solution.response);
  }

  const text = await fetchText(url, {
    timeoutMs: 20000,
    headers: { Accept: "application/json", Referer: "https://jiji.com.gh/" }
  });
  return JSON.parse(text);
}

function listingApiUrl({ host, category, regionSlug, page, query }) {
  const params = new URLSearchParams({
    slug: category,
    init_page: page === 1 ? "true" : "false",
    page: String(page)
  });
  if (regionSlug) params.set("region_slug", regionSlug);
  if (query) params.set("query", query);
  return `${host}/api_web/v1/listing?${params.toString()}`;
}

async function scrapeJijiLike({
  city = "Accra",
  transactionType = "rent",
  pages = 2,
  source = "jiji",
  query = ""
} = {}) {
  const listings = [];
  const errors = [];
  const host = source === "tonaton" ? "https://jiji.com.gh" : "https://jiji.com.gh";
  const category = transactionType === "sale" ? "houses-apartments-for-sale" : "houses-apartments-for-rent";
  const regionSlug = REGION_SLUG[city] || "greater-accra";
  const session = { cookie: "", userAgent: "" };

  for (let page = 1; page <= pages; page += 1) {
    const apiUrl = listingApiUrl({ host, category, regionSlug, page, query });
    try {
      const data = await fetchJijiListingJson(apiUrl, session);
      const ads = adsFromPayload(data);
      if (Array.isArray(ads) && ads.length) {
        for (const ad of ads) {
          const row = rowFromJijiAd(ad, city, transactionType, source);
          if (row) listings.push(row);
        }
        await sleep(Number(process.env.JAB_RE_SCRAPE_DELAY_MS || 1500));
        continue;
      }
      errors.push(`${apiUrl}: empty adverts`);
    } catch (error) {
      errors.push(`${apiUrl}: ${error.message}`);
    }

    const htmlUrl = `https://jiji.com.gh/${regionSlug}/${category}`;
    try {
      const html = await fetchText(htmlUrl, { timeoutMs: 20000 });
      listings.push(...parseJijiHtml(html, city, transactionType, source));
      await sleep(Number(process.env.JAB_RE_SCRAPE_DELAY_MS || 2500));
    } catch (error) {
      errors.push(`${htmlUrl}: ${error.message}`);
    }
  }

  const uniq = new Map();
  for (const row of listings) uniq.set(row.external_id, row);
  return { listings: [...uniq.values()], errors };
}

export function scrapeJijiHtml(options) {
  return scrapeJijiLike({ ...options, source: "jiji" });
}

export function scrapeTonatonHtml(options) {
  return scrapeJijiLike({ ...options, source: "tonaton" });
}
