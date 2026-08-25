/**
 * Meqasa.com HTML listing scrape (Ghana).
 * Best-effort parse of public search pages; seed data is the local fallback.
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

function searchUrl(city, transactionType, page = 1) {
  const slug = CITY_SLUG[city] || "accra";
  const purpose = transactionType === "sale" ? "for-sale" : "for-rent";
  const base = `https://meqasa.com/properties-${purpose}-in-${slug}`;
  return page > 1 ? `${base}?page=${page}` : base;
}

function parsePrice(text) {
  const m = String(text || "").replace(/,/g, "").match(/([\d]{2,9})/);
  return m ? Number(m[1]) : 0;
}

function parseListings(html, city, transactionType) {
  const rows = [];
  const seen = new Set();
  const hrefRe = /href="(https?:\/\/meqasa\.com\/[^"]+)"/gi;
  let match;
  while ((match = hrefRe.exec(html))) {
    const url = match[1].split("?")[0];
    if (!/meqasa\.com\/(apartment|house|room|self-contain|chamber|property|listing)/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const id = url.replace(/https?:\/\/meqasa\.com\//i, "").slice(0, 180);
    const around = html.slice(Math.max(0, match.index - 400), match.index + 900);
    const price = parsePrice(around.match(/GH[S₵¢]?\s*([\d,]+)/i)?.[0] || around.match(/([\d,]{3,9})/)?.[1]);
    const bedsMatch = around.match(/(\d+)\s*(?:bed|br)/i);
    const titleMatch = around.match(/>([A-Za-z0-9][^<]{8,80})</);
    rows.push(
      normalizeListingRow({
        source: "meqasa",
        external_id: id,
        source_url: url,
        transaction_type: transactionType,
        property_type: /self-?contain/i.test(url + around)
          ? "self-contain"
          : /chamber/i.test(url + around)
            ? "chamber-and-hall"
            : "apartment",
        beds: bedsMatch ? Number(bedsMatch[1]) : null,
        emirate: city,
        community: titleMatch?.[1]?.trim().slice(0, 80) || city,
        price_aed: price,
        price_period: transactionType === "rent" ? "monthly" : "total",
        description: titleMatch?.[1] || "",
        agent_name: "",
        agency_name: "Meqasa listing"
      })
    );
  }
  return rows.filter((r) => Number(r.price_aed) > 0);
}

export async function scrapeMeqasaHtml({ city = "Accra", transactionType = "rent", pages = 2 } = {}) {
  const listings = [];
  const errors = [];
  for (let page = 1; page <= pages; page += 1) {
    const url = searchUrl(city, transactionType, page);
    try {
      const html = await fetchText(url, { timeoutMs: 25000 });
      listings.push(...parseListings(html, city, transactionType));
      await sleep(Number(process.env.JAB_RE_SCRAPE_DELAY_MS || 2500));
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  const uniq = new Map();
  for (const row of listings) uniq.set(row.external_id, row);
  return { listings: [...uniq.values()], errors };
}
