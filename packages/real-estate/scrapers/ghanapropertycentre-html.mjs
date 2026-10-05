/**
 * Ghana Property Centre public search pages (JSON-LD ItemList + listing cards).
 */

import { fetchText, extractJsonLd, sleep } from "./http.mjs";
import { normalizeListingRow } from "./normalize.mjs";

/** City → GPC region slug (site no longer uses /in/{city}). */
const CITY_REGION = {
  Accra: "greater-accra",
  Kumasi: "ashanti",
  Tema: "greater-accra",
  Takoradi: "western-region",
  "Cape Coast": "central-region",
  Tamale: "northern-region",
  Kasoa: "greater-accra",
  Madina: "greater-accra"
};

const REGION_CITY = {
  "greater-accra": "Accra",
  accra: "Accra",
  ashanti: "Kumasi",
  kumasi: "Kumasi",
  tema: "Tema",
  "western-region": "Takoradi",
  western: "Takoradi",
  takoradi: "Takoradi",
  "central-region": "Cape Coast",
  central: "Cape Coast",
  "northern-region": "Tamale",
  northern: "Tamale",
  tamale: "Tamale"
};

function searchUrls(city, transactionType, page) {
  const region = CITY_REGION[city] || "greater-accra";
  const purpose = transactionType === "sale" ? "for-sale" : "for-rent";
  // Current GPC SERP shape: /for-rent/greater-accra, /for-rent/flats-apartments/greater-accra
  const paths = [
    `/${purpose}/${region}`,
    `/${purpose}/flats-apartments/${region}`,
    `/${purpose}/houses/${region}`
  ];
  return paths.map((path) => {
    const base = `https://ghanapropertycentre.com${path}`;
    return page > 1 ? `${base}?page=${page}` : base;
  });
}

function parsePrice(value) {
  const n = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseCardPrice(around) {
  const ghs = parsePrice(around.match(/GH₵\s*([\d,]+)/i)?.[1]);
  if (ghs > 0) return ghs;
  const usd = parsePrice(around.match(/\$([\d,]+)/)?.[1]);
  if (usd > 0) return Math.round(usd * Number(process.env.JAB_RE_GHS_PER_USD || 12));
  return 0;
}

function enrichRowsFromCards(html, rows) {
  for (const row of rows) {
    const token = `product_id=${row.external_id}`;
    const idx = html.indexOf(token);
    if (idx < 0) continue;
    const around = html.slice(idx, idx + 3500);
    const price = parseCardPrice(around);
    if (price > 0 && !row.price_aed) row.price_aed = price;
    const agent = around.match(/<p class="flex items-center gap-1.5 text-sm font-semibold[^"]*">\s*([^<]+)/)?.[1]?.trim();
    if (agent) row.agent_name = agent;
    const phone = around.match(/tel:([+\d]+)/)?.[1];
    if (phone) row.agent_phone = phone;
    const baths = around.match(/>(\d+)<span class="max-md:hidden">&nbsp;Baths/);
    if (baths) row.baths = Number(baths[1]);
  }
  return rows;
}

function cityFromUrl(url, fallback) {
  const u = String(url || "").toLowerCase();
  for (const [slug, city] of Object.entries(REGION_CITY)) {
    if (u.includes(`/${slug}/`) || u.includes(`/in/${slug}`)) return city;
  }
  return fallback;
}

function communityFromUrl(url, fallback) {
  const parts = String(url || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean);
  const idIdx = parts.findIndex((p) => /^\d{3,}-/.test(p));
  if (idIdx > 0) {
    const slug = parts[idIdx - 1];
    if (slug && !REGION_CITY[slug] && slug !== "showtype") {
      return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return fallback;
}

function propertyTypeFrom(url, name) {
  const text = `${url} ${name}`.toLowerCase();
  if (/self-?contain/.test(text)) return "self-contain";
  if (/chamber/.test(text)) return "chamber-and-hall";
  if (/house|townhouse|duplex/.test(text)) return "house";
  return "apartment";
}

function bedsFrom(url, name) {
  const m = `${url} ${name}`.match(/(\d+)\s*-?\s*bed/i);
  return m ? Number(m[1]) : null;
}

function isResidential(url) {
  const u = String(url || "").toLowerCase();
  if (/\/(commercial|land|office|shop|warehouse|industrial)\b/.test(u)) return false;
  return /\/(for-rent|for-sale)\//.test(u) && /\d{3,}-/.test(u);
}

function externalIdFromUrl(url) {
  const m = String(url || "").match(/\/(\d{3,})-[^/]+\/?$/);
  return m ? m[1] : String(url).replace(/https?:\/\/ghanapropertycentre\.com\//i, "").slice(0, 180);
}

function unescapeGpcJson(raw = "") {
  return String(raw).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function isGpcListingPhoto(url = "") {
  const u = cleanGpcImageUrl(url);
  if (!/^https?:\/\/images\.ghanapropertycentre\.com\/properties\/images\/\d+\//i.test(u)) return false;
  if (/\/(thumbs|branded|profiles)\//i.test(u)) return false;
  return /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(u);
}

export function gpcFullImageUrl(url = "") {
  return cleanGpcImageUrl(url).replace(/\/properties\/images\/thumbs\//i, "/properties/images/");
}

function cleanGpcImageUrl(url = "") {
  return String(url || "").replace(/\\\//g, "/").split("?")[0];
}

/** Drop SERP thumbs when the matching full-size photo is already present. */
export function preferFullGpcImages(images = []) {
  const list = (images || []).map(String).filter(Boolean);
  const trueFull = new Set(list.map(gpcFullImageUrl).filter((u, i) => isGpcListingPhoto(list[i])));
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const cleaned = cleanGpcImageUrl(raw);
    const full = gpcFullImageUrl(cleaned);
    if (/\/thumbs\//i.test(cleaned) && trueFull.has(full)) continue;
    const key = full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/** Alpine `propertyGallery(JSON.parse('...'))` on GPC detail pages — full photo set, not the SERP thumb. */
export function parseGpcGalleryHtml(html = "") {
  const src = String(html || "");
  const match = src.match(/propertyGallery\(\s*JSON\.parse\('((?:\\'|[^'])*)'\)/);
  if (!match) return [];
  try {
    const photos = JSON.parse(unescapeGpcJson(match[1]));
    if (!Array.isArray(photos)) return [];
    const urls = [];
    for (const photo of photos) {
      const full = gpcFullImageUrl(photo?.full || photo?.url || "");
      const thumb = gpcFullImageUrl(photo?.thumb || "");
      const chosen = isGpcListingPhoto(full) ? full : isGpcListingPhoto(thumb) ? thumb : "";
      if (chosen) urls.push(chosen);
    }
    return [...new Set(urls)].slice(0, 16);
  } catch {
    return [];
  }
}

export function parseGpcSearchHtml(html, { city = "Accra", transactionType = "rent" } = {}) {
  const rows = [];
  const seen = new Set();

  const blocks = extractJsonLd(html);
  for (const block of blocks) {
    if (block?.["@type"] !== "ItemList") continue;
    for (const el of block.itemListElement || []) {
      const url = String(el.url || el.item || "").split("?")[0];
      if (!isResidential(url) || seen.has(url)) continue;
      seen.add(url);
      const name = el.name || "";
      const price = parsePrice(el.offers?.price);
      const currency = String(el.offers?.priceCurrency || "GHS").toUpperCase();
      if (currency === "USD" && price > 0 && price < 500) continue;
      const image = typeof el.image === "string" ? el.image : el.image?.url;
      const resolvedCity = cityFromUrl(url, city);
      rows.push(
        normalizeListingRow({
          source: "ghanapropertycentre",
          external_id: externalIdFromUrl(url),
          source_url: url,
          transaction_type: transactionType,
          property_type: propertyTypeFrom(url, name),
          beds: bedsFrom(url, name),
          emirate: resolvedCity,
          community: communityFromUrl(url, resolvedCity),
          price_aed: price,
          price_period: transactionType === "rent" ? "monthly" : "total",
          images: image ? [image] : [],
          description: name,
          agency_name: "Ghana Property Centre listing"
        })
      );
    }
  }

  const hrefRe =
    /href="(https:\/\/ghanapropertycentre\.com\/(?:for-rent|for-sale)\/[^"]+\d{3,}-[^"]+)"/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const url = match[1].split("?")[0];
    if (!isResidential(url) || seen.has(url)) continue;
    seen.add(url);
    const around = html.slice(Math.max(0, match.index - 200), match.index + 1400);
    const name = around.match(/aria-label="([^"]{4,120})"/)?.[1] || around.match(/alt="([^"]{4,120})"/)?.[1] || "";
    const price = parsePrice(around.match(/GH₵\s*([\d,]+)/i)?.[1]);
    const image = around.match(/src="(https:\/\/images\.ghanapropertycentre\.com\/[^"]+)"/)?.[1];
    const resolvedCity = cityFromUrl(url, city);
    rows.push(
      normalizeListingRow({
        source: "ghanapropertycentre",
        external_id: externalIdFromUrl(url),
        source_url: url,
        transaction_type: transactionType,
        property_type: propertyTypeFrom(url, name),
        beds: bedsFrom(url, name),
        emirate: resolvedCity,
        community: communityFromUrl(url, resolvedCity),
        price_aed: price,
        price_period: transactionType === "rent" ? "monthly" : "total",
        images: image ? [image] : [],
        description: name,
        agency_name: "Ghana Property Centre listing"
      })
    );
  }

  return enrichRowsFromCards(
    html,
    rows.filter((r) => Number(r.price_aed) > 0 || (r.images || []).length > 0)
  );
}

export async function scrapeGhanaPropertyCentreHtml({
  city = "Accra",
  transactionType = "rent",
  pages = 3
} = {}) {
  const listings = [];
  const errors = [];
  for (let page = 1; page <= pages; page += 1) {
    for (const url of searchUrls(city, transactionType, page)) {
      try {
        const html = await fetchText(url, { timeoutMs: 25000 });
        listings.push(...parseGpcSearchHtml(html, { city, transactionType }));
        await sleep(Number(process.env.JAB_RE_SCRAPE_DELAY_MS || 2500));
      } catch (error) {
        if (!/HTTP 404/.test(error.message)) errors.push(`${url}: ${error.message}`);
      }
    }
  }
  const uniq = new Map();
  for (const row of listings) uniq.set(row.external_id, row);
  return { listings: [...uniq.values()], errors };
}
