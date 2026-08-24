/**
 * Bayut listings via public Algolia browser key embedded in Bayut pages ($0 fallback when HTML captcha).
 */

import { fetchText, sleep, rateLimitMs } from "./http.mjs";
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

const INDEX_CANDIDATES = [
  "bayut-production-ads-en",
  "bayut-production-ads-ar",
  "bayut-production-listings-en"
];

function extractAlgoliaConfig(html) {
  const text = String(html || "");
  const appId =
    text.match(/"appId"\s*:\s*"([^"]+)"/)?.[1] ||
    text.match(/ALGOLIA_APP_ID["'\s:=]+["']([A-Z0-9]{8,12})["']/)?.[1] ||
    text.match(/applicationId["'\s:=]+["']([A-Z0-9]{8,12})["']/)?.[1] ||
    text.match(/X-Algolia-Application-Id["'\s:,]+["']([A-Z0-9]{8,12})["']/)?.[1];
  const apiKey =
    text.match(/"apiKey"\s*:\s*"([^"]+)"/)?.[1] ||
    text.match(/ALGOLIA_BROWSER_SEARCH_API_KEY["'\s:=]+["']([a-f0-9]{32})["']/)?.[1] ||
    text.match(/searchApiKey["'\s:=]+["']([a-f0-9]{32})["']/)?.[1] ||
    text.match(/"X-Algolia-API-Key"\s*:\s*"([^"]+)"/)?.[1];
  return { appId, apiKey };
}

function getAlgoliaConfigFromEnv() {
  const appId = String(process.env.JAB_RE_BAYUT_ALGOLIA_APP_ID || process.env.BAYUT_ALGOLIA_APP_ID || "").trim();
  const apiKey = String(process.env.JAB_RE_BAYUT_ALGOLIA_API_KEY || process.env.BAYUT_ALGOLIA_API_KEY || "").trim();
  if (appId && apiKey) return { appId, apiKey };
  return null;
}

function purposeFilter(transactionType) {
  return transactionType === "rent" ? 'purpose:"for-rent"' : 'purpose:"for-sale"';
}

function parseAlgoliaHit(hit, emirate, transactionType) {
  const id = hit.externalID || hit.objectID || hit.id;
  if (!id) return null;
  const price = Number(hit.price || hit.rent || 0);
  if (!price) return null;
  const loc = hit.location || hit._geoloc || [];
  const community =
    (Array.isArray(loc) ? loc[2]?.name || loc[1]?.name : hit.area?.name) || hit.subCommunity || "";
  return normalizeListingRow({
    source: "bayut",
    external_id: String(id),
    source_url: hit.slug
      ? `https://www.bayut.com/${hit.slug}`
      : `https://www.bayut.com/property/details-${id}.html`,
    transaction_type: transactionType,
    property_type: hit.categories?.[0]?.name?.singular || hit.type || "apartment",
    beds: hit.rooms ?? hit.bedrooms ?? null,
    baths: hit.baths ?? null,
    emirate,
    community: community || "",
    price_aed: price,
    price_period: transactionType === "rent" ? hit.rentFrequency || "yearly" : "total",
    furnished:
      hit.furnishingStatus === "furnished" ? true : hit.furnishingStatus === "unfurnished" ? false : null,
    images: hit.coverPhoto?.url ? [hit.coverPhoto.url] : hit.photo?.url ? [hit.photo.url] : [],
    description: hit.title || hit.name || "",
    agent_name: hit.contactName || "",
    agency_name: hit.agency?.name || ""
  });
}

async function resolveAlgoliaConfig() {
  let config = getAlgoliaConfigFromEnv();
  if (config?.appId && config?.apiKey) return config;

  for (const seedUrl of [
    "https://www.bayut.com/to-rent/apartments/dubai/",
    "https://www.bayut.com/",
    "https://www.bayut.com/for-sale/apartments/dubai/"
  ]) {
    try {
      const html = await fetchText(seedUrl);
      config = extractAlgoliaConfig(html);
      if (config?.appId && config?.apiKey) return config;
    } catch {
      /* try next */
    }
  }
  return config || {};
}

function buildAlgoliaCriteriaFilters(criteria = {}) {
  const tx = criteria.transaction_type === "sale" ? "sale" : "rent";
  const emirate = criteria.emirate || criteria.emirates?.[0] || "Dubai";
  const slug = EMIRATE_SLUGS[emirate];
  if (!slug) return null;

  const parts = [purposeFilter(tx), `location.slug:"${slug}"`];
  if (criteria.max_price != null) parts.push(`price<=${Math.floor(Number(criteria.max_price))}`);
  if (criteria.min_price != null) parts.push(`price>=${Math.floor(Number(criteria.min_price))}`);
  if (criteria.beds != null) parts.push(`rooms=${Number(criteria.beds)}`);
  return { filters: parts.join(" AND "), emirate, tx };
}

/** Live Algolia search — returns rows without DB writes. */
export async function searchBayutAlgoliaRows(criteria = {}, { maxPages = 2, maxHits = 50 } = {}) {
  const config = await resolveAlgoliaConfig();
  if (!config.appId || !config.apiKey) {
    return { rows: [], errors: ["algolia keys not found in Bayut page"] };
  }

  const built = buildAlgoliaCriteriaFilters(criteria);
  if (!built) return { rows: [], errors: ["invalid emirate for algolia search"] };

  const rows = [];
  const seen = new Set();
  const errors = [];
  const hitsPerPage = Math.min(25, Math.max(1, maxHits));

  for (let page = 0; page < maxPages && rows.length < maxHits; page++) {
    const params = new URLSearchParams({
      hitsPerPage: String(hitsPerPage),
      page: String(page),
      filters: built.filters
    }).toString();

    let json = null;
    let lastErr = null;
    for (const indexName of INDEX_CANDIDATES) {
      try {
        json = await algoliaSearch({ ...config, indexName, params });
        if (json?.hits?.length) break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!json?.hits?.length) {
      if (page === 0 && lastErr) errors.push(lastErr.message);
      break;
    }

    for (const hit of json.hits) {
      const row = parseAlgoliaHit(hit, built.emirate, built.tx);
      if (!row) continue;
      const key = `${row.source}:${row.external_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= maxHits) break;
    }

    if (json.hits.length < hitsPerPage) break;
    await sleep(rateLimitMs());
  }

  return { rows, errors };
}

async function algoliaSearch({ appId, apiKey, indexName, params }) {
  const response = await fetch(`https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Algolia-Application-Id": appId,
      "X-Algolia-API-Key": apiKey
    },
    body: JSON.stringify({ params }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Algolia ${response.status}: ${text.slice(0, 120)}`);
  }
  return response.json();
}

export async function scrapeBayutAlgolia(
  db,
  upsertListing,
  { emirates = ["Dubai"], types = ["rent", "sale"], maxPages = 2 } = {}
) {
  let found = 0;
  let upserted = 0;
  const errors = [];

  const config = await resolveAlgoliaConfig();
  if (!config.appId || !config.apiKey) {
    return { found: 0, upserted: 0, errors: ["algolia keys not found in Bayut page"] };
  }

  for (const emirate of emirates) {
    const slug = EMIRATE_SLUGS[emirate];
    if (!slug) continue;
    for (const type of types) {
      const tx = type === "rent" ? "rent" : "sale";
      let pageHits = 0;
      try {
        for (let page = 0; page < maxPages; page++) {
          const params = new URLSearchParams({
            hitsPerPage: "25",
            page: String(page),
            filters: `${purposeFilter(tx)} AND location.slug:"${slug}"`
          }).toString();

          let json = null;
          let lastErr = null;
          for (const indexName of INDEX_CANDIDATES) {
            try {
              json = await algoliaSearch({ ...config, indexName, params });
              if (json?.hits?.length) break;
            } catch (e) {
              lastErr = e;
            }
          }
          if (!json?.hits?.length) {
            if (page === 0 && lastErr) errors.push(`${emirate}/${tx}: ${lastErr.message}`);
            break;
          }

          for (const hit of json.hits) {
            const row = parseAlgoliaHit(hit, emirate, tx);
            if (!row) continue;
            found++;
            pageHits++;
            upsertListing(db, row);
            upserted++;
          }
          if (json.hits.length < 25) break;
          await sleep(rateLimitMs());
        }
        if (!pageHits) errors.push(`${emirate}/${tx}: algolia returned 0 hits`);
      } catch (e) {
        errors.push(`${emirate}/${tx}: ${e.message}`);
      }
      await sleep(rateLimitMs());
    }
  }

  return { found, upserted, errors: upserted ? errors.filter((e) => !e.includes("0 hits")) : errors };
}
