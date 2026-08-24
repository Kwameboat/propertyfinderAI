/**
 * Puppeteer Property Finder SERP scraper — opt-in source `propertyfinder_puppeteer`.
 */

import { extractNextData, sleep } from "../http.mjs";
import { normalizePropertyFinderHtml } from "../normalize.mjs";
import { scrapePropertyFinderHtml } from "../propertyfinder-html.mjs";
import { getPuppeteerMaxPages, getPuppeteerPageDelayMs } from "../../puppeteer-mode.mjs";
import { fetchPortalHtml, closeBrowser } from "./browser.mjs";
import { parsePropertyFinderJinaMarkdown } from "./jina-pf.mjs";

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

function serpUrl(emirate, tx, page) {
  const slug = EMIRATE_SLUGS[emirate];
  const segment = tx === "rent" ? "rent" : "buy";
  const base = `https://www.propertyfinder.ae/en/${segment}/${slug}/${serpPath(tx)}.html`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

export async function scrapePropertyFinderPuppeteer(
  db,
  upsertListing,
  { emirates = ["Dubai", "Abu Dhabi"], types = ["rent", "sale"], maxPages } = {}
) {
  const pages = maxPages ?? getPuppeteerMaxPages();
  let found = 0;
  let upserted = 0;
  const errors = [];
  const engines = new Set();

  try {
    for (const emirate of emirates) {
      if (!EMIRATE_SLUGS[emirate]) continue;
      for (const type of types) {
        const tx = type === "rent" ? "rent" : "sale";
        for (let page = 1; page <= pages; page++) {
          const url = serpUrl(emirate, tx, page);
          try {
            const { html, engine, format } = await fetchPortalHtml(url);
            engines.add(engine);
            let rows = [];
            if (format === "markdown") {
              rows = parsePropertyFinderJinaMarkdown(html, { emirate, transactionType: tx });
            } else {
              const next = extractNextData(html);
              if (!next) {
                errors.push(`${emirate}/${tx}/p${page}: no __NEXT_DATA__`);
                break;
              }
              rows = parseListingsFromNextData(next, emirate, tx);
            }
            if (!rows.length) break;
            found += rows.length;
            for (const row of rows) {
              upsertListing(db, row);
              upserted++;
            }
          } catch (e) {
            errors.push(`${emirate}/${tx}/p${page}: ${e.message}`);
            break;
          }
          await sleep(getPuppeteerPageDelayMs());
        }
      }
    }
  } finally {
    await closeBrowser();
  }

  if (upserted === 0) {
    const html = await scrapePropertyFinderHtml(db, upsertListing, { emirates, types });
    return {
      found: html.found,
      upserted: html.upserted,
      errors: [...errors, ...(html.errors || [])],
      engine: html.upserted > 0 ? "html_fallback" : "none"
    };
  }

  return {
    found,
    upserted,
    errors,
    engine: engines.has("puppeteer") ? "puppeteer" : "fetch"
  };
}
