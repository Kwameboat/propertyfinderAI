/**
 * Property Finder HTML scraper — __NEXT_DATA__ on public SERP pages.
 */

import { fetchText, extractNextData, sleep, rateLimitMs } from "./http.mjs";
import { normalizePropertyFinderHtml } from "./normalize.mjs";

const EMIRATE_SLUGS = {
  Dubai: "dubai",
  "Abu Dhabi": "abu-dhabi",
  Sharjah: "sharjah",
  Ajman: "ajman",
  "Ras Al Khaimah": "ras-al-khaimah",
  Fujairah: "fujairah",
  "Umm Al Quwain": "umm-al-quwain"
};

function serpPath(transactionType) {
  return transactionType === "rent" ? "apartments-for-rent" : "apartments-for-sale";
}

function parseListingsFromNextData(data, emirate, transactionType) {
  const rows = [];
  const listings = data?.props?.pageProps?.searchResult?.listings || [];
  for (const item of listings) {
    const prop = item?.property;
    if (!prop?.id) continue;
    rows.push(normalizePropertyFinderHtml(prop, emirate, transactionType));
  }
  return rows;
}

export async function scrapePropertyFinderHtml(
  db,
  upsertListing,
  { emirates = ["Dubai", "Abu Dhabi"], types = ["rent", "sale"] } = {}
) {
  let found = 0;
  let upserted = 0;
  const errors = [];

  for (const emirate of emirates) {
    const slug = EMIRATE_SLUGS[emirate];
    if (!slug) continue;
    for (const type of types) {
      const tx = type === "rent" ? "rent" : "sale";
      const segment = tx === "rent" ? "rent" : "buy";
      const url = `https://www.propertyfinder.ae/en/${segment}/${slug}/${serpPath(tx)}.html`;
      try {
        const html = await fetchText(url);
        const next = extractNextData(html);
        const captchaBlocked = /captcha|are you a robot/i.test(html) && !next;
        if (captchaBlocked) {
          errors.push(`${emirate}/${tx}: captcha`);
          continue;
        }
        if (!next) {
          errors.push(`${emirate}/${tx}: no __NEXT_DATA__`);
          continue;
        }
        const rows = parseListingsFromNextData(next, emirate, tx);
        found += rows.length;
        for (const row of rows) {
          upsertListing(db, row);
          upserted++;
        }
      } catch (e) {
        errors.push(`${emirate}/${tx}: ${e.message}`);
      }
      await sleep(rateLimitMs());
    }
  }

  return { found, upserted, errors };
}
