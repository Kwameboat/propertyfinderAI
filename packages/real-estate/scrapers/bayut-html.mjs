/**
 * Bayut HTML fallback scraper (may hit captcha from some IPs — VPS often works better).
 */

import { fetchText, extractNextData, sleep, rateLimitMs } from "./http.mjs";
import { normalizeListingRow } from "./normalize.mjs";

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
  if (transactionType === "off_plan") return "new-projects";
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

/** Live HTML pull from Bayut (no DB write) — used when RapidAPI quota exceeded. */
export async function fetchLiveBayutHtmlListings({ emirate = "Dubai", transactionType = "rent" } = {}) {
  const slug = EMIRATE_SLUGS[emirate];
  if (!slug) return { ok: false, error: `Unknown emirate: ${emirate}`, listings: [], source: "bayut_html" };
  const tx = transactionType === "sale" ? "sale" : "rent";
  const url = `https://www.bayut.com/${purposePath(tx)}/apartments/${slug}/`;
  try {
    const html = await fetchText(url);
    if (/captcha|are you a robot/i.test(html)) {
      return { ok: false, error: "captcha", listings: [], source: "bayut_html" };
    }
    const next = extractNextData(html);
    if (!next) return { ok: false, error: "no __NEXT_DATA__", listings: [], source: "bayut_html" };
    const listings = parseListingsFromNextData(next, emirate, tx).filter((l) => Number(l.price_aed) > 0);
    return {
      ok: listings.length > 0,
      source: "bayut_html_live",
      emirate,
      fetchedAt: new Date().toISOString(),
      listings
    };
  } catch (error) {
    return { ok: false, error: error.message, listings: [], source: "bayut_html" };
  }
}

export async function scrapeBayutHtml(db, upsertListing, { emirates = ["Dubai", "Abu Dhabi"], types = ["rent", "sale"] } = {}) {
  let found = 0;
  let upserted = 0;
  const errors = [];

  for (const emirate of emirates) {
    const slug = EMIRATE_SLUGS[emirate];
    if (!slug) continue;
    for (const type of types) {
      const tx = type === "rent" ? "rent" : "sale";
      const url = `https://www.bayut.com/${purposePath(tx)}/apartments/${slug}/`;
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
