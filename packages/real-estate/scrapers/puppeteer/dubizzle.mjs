/**
 * Puppeteer Dubizzle SERP scraper — opt-in source `dubizzle_puppeteer`.
 */

import { extractNextData, sleep } from "../http.mjs";
import { normalizeDubizzleHtml } from "../normalize.mjs";
import { scrapeDubizzleHtml } from "../dubizzle-html.mjs";
import { scrapeDubizzleApify, isApifyFallbackSource } from "../../apify-scrape.mjs";
import { getPuppeteerMaxPages, getPuppeteerPageDelayMs } from "../../puppeteer-mode.mjs";
import { fetchPortalHtml, closeBrowser } from "./browser.mjs";

const EMIRATE_HOSTS = {
  Dubai: "dubai.dubizzle.com",
  "Abu Dhabi": "abudhabi.dubizzle.com",
  Sharjah: "sharjah.dubizzle.com",
  Ajman: "ajman.dubizzle.com"
};

function purposePath(transactionType) {
  return transactionType === "rent" ? "property-for-rent" : "property-for-sale";
}

function parseListingsFromNextData(data, emirate, transactionType) {
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
  return rows;
}

function serpUrl(host, tx, page) {
  const base = `https://${host}/${purposePath(tx)}/residential/apartmentflat/`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

export async function scrapeDubizzlePuppeteer(
  db,
  upsertListing,
  { emirates = ["Dubai", "Abu Dhabi", "Sharjah", "Ajman"], types = ["rent", "sale"], maxPages } = {}
) {
  const pages = maxPages ?? getPuppeteerMaxPages();
  let found = 0;
  let upserted = 0;
  const errors = [];
  const engines = new Set();

  try {
    for (const emirate of emirates) {
      const host = EMIRATE_HOSTS[emirate];
      if (!host) continue;
      for (const type of types) {
        const tx = type === "rent" ? "rent" : "sale";
        for (let page = 1; page <= pages; page++) {
          const url = serpUrl(host, tx, page);
          try {
            const { html, engine } = await fetchPortalHtml(url);
            engines.add(engine);
            const next = extractNextData(html);
            if (!next) {
              errors.push(`${emirate}/${tx}/p${page}: no __NEXT_DATA__`);
              break;
            }
            const rows = parseListingsFromNextData(next, emirate, tx);
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
    let fb = await scrapeDubizzleHtml(db, upsertListing, { emirates, types });
    let engine = fb.upserted > 0 ? "html_fallback" : "none";
    if (fb.upserted === 0 && isApifyFallbackSource("dubizzle")) {
      fb = await scrapeDubizzleApify(db, upsertListing, { emirates, maxPages: pages });
      if (fb.upserted > 0) engine = "apify_fallback";
    }
    return {
      found: fb.found,
      upserted: fb.upserted,
      errors: [...errors, ...(fb.errors || [])],
      engine
    };
  }

  return {
    found,
    upserted,
    errors,
    engine: engines.has("puppeteer") ? "puppeteer" : "fetch"
  };
}
