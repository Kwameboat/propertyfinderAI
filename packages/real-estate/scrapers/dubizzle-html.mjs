/**
 * Dubizzle HTML scraper — best-effort (often captcha-blocked; seed + RealtyAPI optional later).
 */

import { fetchText, extractNextData, sleep, rateLimitMs } from "./http.mjs";
import { normalizeDubizzleHtml } from "./normalize.mjs";

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

export async function scrapeDubizzleHtml(
  db,
  upsertListing,
  { emirates = ["Dubai", "Abu Dhabi"], types = ["rent", "sale"] } = {}
) {
  let found = 0;
  let upserted = 0;
  const errors = [];

  for (const emirate of emirates) {
    const host = EMIRATE_HOSTS[emirate];
    if (!host) continue;
    for (const type of types) {
      const tx = type === "rent" ? "rent" : "sale";
      const url = `https://${host}/${purposePath(tx)}/residential/apartmentflat/`;
      try {
        const html = await fetchText(url);
        if (/Incapsula|_Incapsula_Resource/i.test(html)) {
          errors.push(`${emirate}/${tx}: bot-shield`);
          continue;
        }
        const next = extractNextData(html);
        const captchaBlocked = /captcha|are you a robot|cf-browser-verification/i.test(html) && !next;
        if (captchaBlocked) {
          errors.push(`${emirate}/${tx}: captcha`);
          continue;
        }
        if (!next) {
          errors.push(`${emirate}/${tx}: no __NEXT_DATA__`);
          continue;
        }
        const rows = parseListingsFromNextData(next, emirate, tx);
        if (!rows.length) {
          errors.push(`${emirate}/${tx}: no listings parsed`);
          continue;
        }
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
