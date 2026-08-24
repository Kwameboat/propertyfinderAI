/**
 * Bayut listings via RapidAPI (uae-real-estate3) — production-grade when RAPIDAPI_KEY is set.
 * https://rapidapi.com/happyendpoint/api/uae-real-estate3/
 */

import { fetchJson, sleep, rateLimitMs } from "./http.mjs";
import { normalizeRapidApiProperty, normalizeNewProject } from "./normalize.mjs";

const HOST = "uae-real-estate3.p.rapidapi.com";
const BASE = `https://${HOST}`;

/** Emirate-level location IDs (Bayut externalID). */
export const EMIRATE_LOCATIONS = {
  Dubai: "5002",
  "Abu Dhabi": "6020",
  Sharjah: "5351",
  Ajman: "5385",
  "Ras Al Khaimah": "5544",
  Fujairah: "6542",
  "Umm Al Quwain": "5549"
};

function headers() {
  const key = String(process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_BAYUT_KEY || "").trim();
  if (!key) throw new Error("RAPIDAPI_KEY missing");
  return {
    "x-rapidapi-key": key,
    "x-rapidapi-host": HOST
  };
}

async function apiGet(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  return fetchJson(url.toString(), { headers: headers() });
}

async function searchPurpose({ locationId, purpose, page = 1, maxPages = 3 }) {
  const rows = [];
  let totalPages = 1;
  for (let p = page; p <= maxPages; p++) {
    const json = await apiGet("/search-property", {
      purpose,
      location_ids: locationId,
      page: p,
      sort_order: "latest"
    });
    const data = json?.data || json;
    const props = data?.properties || data?.hits || [];
    totalPages = data?.totalPages || 1;
    for (const prop of props) {
      rows.push(normalizeRapidApiProperty(prop, purpose));
    }
    if (p >= totalPages || !props.length) break;
    await sleep(rateLimitMs());
  }
  return rows;
}

async function searchOffPlan({ locationId, page = 1, maxPages = 2 }) {
  const rows = [];
  for (let p = page; p <= maxPages; p++) {
    const json = await apiGet("/search-new-projects", {
      location_ids: locationId,
      page: p
    });
    const data = json?.data || json;
    const props = data?.properties || data?.projects || data?.hits || [];
    for (const prop of props) {
      rows.push(normalizeNewProject(prop));
    }
    if (!props.length) break;
    await sleep(rateLimitMs());
  }
  return rows;
}

export async function scrapeBayutApi(db, upsertListing, { emirates = Object.keys(EMIRATE_LOCATIONS), maxPages = 2 } = {}) {
  if (!String(process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_BAYUT_KEY || "").trim()) {
    return { found: 0, upserted: 0, errors: ["RAPIDAPI_KEY not set — skip bayut_api"] };
  }

  let found = 0;
  let upserted = 0;
  const errors = [];

  for (const emirate of emirates) {
    const locationId = EMIRATE_LOCATIONS[emirate];
    if (!locationId) continue;
    try {
      for (const purpose of ["for-rent", "for-sale"]) {
        const rows = await searchPurpose({ locationId, purpose, maxPages });
        found += rows.length;
        for (const row of rows) {
          try {
            upsertListing(db, { ...row, emirate });
            upserted++;
          } catch (e) {
            errors.push(`${emirate}/${purpose}: ${e.message}`);
          }
        }
        await sleep(rateLimitMs());
      }
      const offRows = await searchOffPlan({ locationId, maxPages: Math.min(2, maxPages) });
      found += offRows.length;
      for (const row of offRows) {
        try {
          upsertListing(db, { ...row, emirate });
          upserted++;
        } catch (e) {
          errors.push(`${emirate}/off_plan: ${e.message}`);
        }
      }
    } catch (e) {
      errors.push(`${emirate}: ${e.message}`);
    }
    await sleep(rateLimitMs());
  }

  return { found, upserted, errors };
}

/** Live pull for market intelligence / chat (no DB write). */
export async function fetchLiveBayutListings({ emirate = "Dubai", purpose = "for-rent", maxPages = 2 } = {}) {
  if (!isBayutApiConfigured()) {
    return { ok: false, source: "bayut_api", error: "RAPIDAPI_KEY not set", listings: [], fetchedAt: null };
  }
  const locationId = EMIRATE_LOCATIONS[emirate];
  if (!locationId) {
    return { ok: false, source: "bayut_api", error: `Unknown emirate: ${emirate}`, listings: [], fetchedAt: null };
  }
  try {
    const listings = await searchPurpose({ locationId, purpose, maxPages });
    return {
      ok: true,
      source: "bayut_api",
      emirate,
      purpose,
      fetchedAt: new Date().toISOString(),
      listings: listings.filter((l) => Number(l.price_aed) > 0)
    };
  } catch (error) {
    return { ok: false, source: "bayut_api", error: error.message, listings: [], fetchedAt: null };
  }
}

export function isBayutApiConfigured() {
  return Boolean(String(process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_BAYUT_KEY || "").trim());
}
