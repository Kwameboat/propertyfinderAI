/**
 * Jiji Ghana (and Tonaton) public listing scrape.
 * Jiji often returns 403 to datacenter IPs — caller should treat empty as a miss.
 */

import { fetchText, sleep } from "./http.mjs";
import { normalizeListingRow } from "./normalize.mjs";

const CITY_SLUG = {
  Accra: "accra",
  Kumasi: "kumasi",
  Tema: "tema",
  Takoradi: "takoradi",
  "Cape Coast": "cape-coast",
  Tamale: "tamale"
};

function parsePrice(text) {
  const m = String(text || "").replace(/,/g, "").match(/([\d]{2,9})/);
  return m ? Number(m[1]) : 0;
}

function rowFromJijiAd(ad, city, transactionType, source) {
  const id = ad.id || ad.guid || ad.slug;
  if (!id) return null;
  const url =
    ad.url ||
    ad.absolute_url ||
    (ad.slug ? `https://jiji.com.gh/${ad.slug}` : `https://jiji.com.gh/${id}`);
  const title = ad.title || ad.name || "";
  const price = Number(ad.price?.value || ad.price || parsePrice(ad.price_text));
  const images = []
    .concat(ad.image_url ? [ad.image_url] : [])
    .concat((ad.images || ad.photos || []).map((p) => (typeof p === "string" ? p : p?.url)))
    .filter(Boolean);
  const loc = ad.region_text || ad.location || city;
  return normalizeListingRow({
    source,
    external_id: String(id),
    source_url: String(url).startsWith("http") ? url : `https://jiji.com.gh${url}`,
    transaction_type: transactionType,
    property_type: /self-?contain/i.test(title) ? "self-contain" : /chamber/i.test(title) ? "chamber-and-hall" : "apartment",
    beds: Number(ad.attrs?.rooms || ad.bedrooms) || null,
    emirate: city,
    community: String(loc).split(",")[0].trim() || city,
    price_aed: price,
    price_period: transactionType === "rent" ? "monthly" : "total",
    images,
    description: title,
    agent_phone: ad.phone || "",
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

async function scrapeJijiLike({
  city = "Accra",
  transactionType = "rent",
  pages = 2,
  source = "jiji"
} = {}) {
  const listings = [];
  const errors = [];
  const slug = CITY_SLUG[city] || "accra";
  const category = transactionType === "sale" ? "houses-apartments-for-sale" : "houses-apartments-for-rent";
  const host = source === "tonaton" ? "https://tonaton.com" : "https://jiji.com.gh";

  for (let page = 1; page <= pages; page += 1) {
    const apiUrl = `${host.replace("tonaton.com", "jiji.com.gh")}/api_web/v1/listing?slug=${category}&region_slug=${slug}&page=${page}`;
    try {
      const text = await fetchText(apiUrl, {
        timeoutMs: 20000,
        headers: { Accept: "application/json", Referer: `${host}/` }
      });
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      const ads = data?.adverts_list?.adverts || data?.data?.adverts || data?.adverts || [];
      if (Array.isArray(ads) && ads.length) {
        for (const ad of ads) {
          const row = rowFromJijiAd(ad, city, transactionType, source);
          if (row) listings.push(row);
        }
        await sleep(Number(process.env.JAB_RE_SCRAPE_DELAY_MS || 2500));
        continue;
      }
    } catch (error) {
      errors.push(`${apiUrl}: ${error.message}`);
    }

    const htmlUrl = `${host}/${slug}/${category}`;
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
