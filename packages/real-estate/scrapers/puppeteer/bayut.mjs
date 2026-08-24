/**
 * Puppeteer Bayut SERP scraper — opt-in source `bayut_puppeteer`.
 * Listing rows use source=bayut (same as HTML) for Supabase/chat compatibility.
 */

import { extractNextData, sleep } from "../http.mjs";
import { normalizeListingRow } from "../normalize.mjs";
import { scrapeBayutAlgolia } from "../bayut-algolia.mjs";
import { scrapeBayutApi, isBayutApiConfigured } from "../rapidapi-bayut.mjs";
import { scrapeBayutHtml } from "../bayut-html.mjs";
import { scrapeBayutApify, isApifyFallbackSource } from "../../apify-scrape.mjs";
import { getPuppeteerMaxPages, getPuppeteerPageDelayMs } from "../../puppeteer-mode.mjs";
import { fetchPortalHtml, closeBrowser } from "./browser.mjs";

const EMIRATE_SLUGS = {
  Dubai: "dubai",
  "Abu Dhabi": "abu-dhabi",
  Sharjah: "sharjah",
  Ajman: "ajman",
  "Ras Al Khaimah": "ras-al-khaimah",
  Fujairah: "fujairah",
  "Umm Al Quwain": "umm-al-quwain"
};

function purposePath(transactionType) {
  if (transactionType === "rent") return "to-rent";
  return "for-sale";
}

function parseListingsFromNextData(data, emirate, transactionType) {
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
  return rows;
}

function serpUrl(emirate, tx, page) {
  const slug = EMIRATE_SLUGS[emirate];
  const base = `https://www.bayut.com/${purposePath(tx)}/apartments/${slug}/`;
  return page <= 1 ? base : `${base}page-${page}/`;
}

export async function scrapeBayutPuppeteer(
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
    let fb = await scrapeBayutAlgolia(db, upsertListing, { emirates, types, maxPages: pages });
    let engine = fb.upserted > 0 ? "algolia_fallback" : "none";

    if (fb.upserted === 0 && isBayutApiConfigured()) {
      fb = await scrapeBayutApi(db, upsertListing, { emirates, maxPages: pages });
      if (fb.upserted > 0) engine = "rapidapi_fallback";
    }
    if (fb.upserted === 0 && isApifyFallbackSource("bayut")) {
      fb = await scrapeBayutApify(db, upsertListing, { emirates, maxPages: pages });
      if (fb.upserted > 0) engine = "apify_fallback";
    }
    if (fb.upserted === 0) {
      fb = await scrapeBayutHtml(db, upsertListing, { emirates, types });
      if (fb.upserted > 0) engine = "html_fallback";
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
