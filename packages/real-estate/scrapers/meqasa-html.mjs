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
  const bases = [
    `https://meqasa.com/properties-${purpose}-in-${slug}`,
    `https://meqasa.com/apartments-${purpose}-in-${city.replace(/\s+/g, "-")}`,
    `https://meqasa.com/houses-${purpose}-in-${city.replace(/\s+/g, "-")}`
  ];
  return bases.map((base) => (page > 1 ? `${base}?page=${page}` : base));
}

function parsePrice(text) {
  const m = String(text || "").replace(/,/g, "").match(/([\d]{2,9})/);
  return m ? Number(m[1]) : 0;
}

function parseListings(html, city, transactionType) {
  const rows = [];
  const seen = new Set();
  const src = String(html || "");

  // Prefer JSON-LD ItemList when Meqasa exposes it
  const ldBlocks = [...src.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of ldBlocks) {
    try {
      const data = JSON.parse(block[1]);
      const list = Array.isArray(data) ? data : [data];
      for (const node of list) {
        const items = node?.itemListElement || node?.mainEntity?.itemListElement || [];
        for (const el of items) {
          const item = el?.item || el;
          const url = String(item?.url || item?.["@id"] || "").split("?")[0];
          if (!/meqasa\.com\//i.test(url) || seen.has(url)) continue;
          seen.add(url);
          const id = url.replace(/https?:\/\/meqasa\.com\//i, "").slice(0, 180);
          const price = parsePrice(item?.offers?.price || item?.price);
          const name = String(item?.name || "");
          rows.push(
            normalizeListingRow({
              source: "meqasa",
              external_id: id,
              source_url: url,
              transaction_type: transactionType,
              property_type: /self-?contain/i.test(`${url} ${name}`)
                ? "self-contain"
                : /chamber/i.test(`${url} ${name}`)
                  ? "chamber-and-hall"
                  : /house/i.test(`${url} ${name}`)
                    ? "house"
                    : "apartment",
              beds: Number(String(name).match(/(\d+)\s*-?\s*bed/i)?.[1]) || null,
              emirate: city,
              community: name.slice(0, 80) || city,
              price_aed: price,
              price_period: transactionType === "rent" ? "monthly" : "total",
              images: item?.image
                ? [Array.isArray(item.image) ? item.image[0] : item.image].filter(Boolean)
                : [],
              description: name,
              agency_name: "Meqasa listing"
            })
          );
        }
      }
    } catch {
      /* ignore bad JSON-LD */
    }
  }

  const hrefRe = /href="((?:https?:\/\/meqasa\.com)?\/[^"]+)"/gi;
  let match;
  while ((match = hrefRe.exec(src))) {
    let url = match[1].split("?")[0];
    if (url.startsWith("/")) url = `https://meqasa.com${url}`;
    if (!/meqasa\.com\/.+/i.test(url)) continue;
    if (!/(apartment|house|room|self-contain|chamber|bedroom|listing)/i.test(url)) continue;
    if (/properties-for-|apartments-for-|houses-for-|offices-for-|for-rent-in-|for-sale-in-|\/login|\/signup/i.test(url)) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const id = url.replace(/https?:\/\/meqasa\.com\//i, "").slice(0, 180);
    const around = src.slice(Math.max(0, match.index - 500), match.index + 1200);
    const price = parsePrice(
      around.match(/GH[S₵¢]\s*([\d,]+)/i)?.[1] || around.match(/([\d,]{3,9})/)?.[1]
    );
    const bedsMatch = around.match(/(\d+)\s*(?:bed|br)/i);
    const titleMatch = around.match(/>([A-Za-z0-9][^<]{8,90})</);
    const image = around.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1];
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
            : /house/i.test(url + around)
              ? "house"
              : "apartment",
        beds: bedsMatch ? Number(bedsMatch[1]) : null,
        emirate: city,
        community: titleMatch?.[1]?.trim().slice(0, 80) || city,
        price_aed: price,
        price_period: transactionType === "rent" ? "monthly" : "total",
        images: image && !/logo|icon|avatar/i.test(image) ? [image] : [],
        description: titleMatch?.[1] || "",
        agent_name: "",
        agency_name: "Meqasa listing"
      })
    );
  }
  // Keep priced rows; also keep image-backed rows when price is only on detail pages
  return rows.filter((r) => Number(r.price_aed) > 0 || (r.images || []).length > 0);
}

export async function scrapeMeqasaHtml({ city = "Accra", transactionType = "rent", pages = 2 } = {}) {
  const listings = [];
  const errors = [];
  for (let page = 1; page <= pages; page += 1) {
    for (const url of searchUrl(city, transactionType, page)) {
      try {
        const html = await fetchText(url, { timeoutMs: 25000 });
        listings.push(...parseListings(html, city, transactionType));
        await sleep(Number(process.env.JAB_RE_SCRAPE_DELAY_MS || 2500));
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }
  }
  const uniq = new Map();
  for (const row of listings) uniq.set(row.external_id, row);
  return { listings: [...uniq.values()], errors };
}
