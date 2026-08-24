/**
 * Property Finder listings via RapidAPI.
 * https://rapidapi.com/happyendpoint/api/uae-real-estate-api-propertyfinder-ae-data
 *
 * Endpoints (v2 API):
 *   GET /locations          — emirate location IDs
 *   GET /properties         — paginated listings (?location_id=&offset=&limit=)
 */

import { fetchJson, sleep, rateLimitMs } from "./http.mjs";
import { normalizePropertyFinderV2Property } from "./normalize.mjs";

const HOST =
  process.env.RAPIDAPI_PF_HOST || "uae-real-estate-api-propertyfinder-ae-data.p.rapidapi.com";
const BASE = `https://${HOST}`;
const PAGE_SIZE = Number(process.env.RAPIDAPI_PF_PAGE_SIZE || 50);

function headers() {
  const key = String(process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_PF_KEY || "").trim();
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

async function fetchEmirateLocations() {
  const json = await apiGet("/locations");
  const rows = json?.data || [];
  return rows
    .filter((row) => String(row.type || "").toUpperCase() === "CITY")
    .map((row) => ({
      emirate: row.name || row.full_name,
      locationId: String(row.location_id)
    }))
    .filter((row) => row.emirate && row.locationId);
}

async function searchProperties({ locationId, emirate, maxPages = 2 }) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * PAGE_SIZE;
    const json = await apiGet("/properties", {
      location_id: locationId,
      offset,
      limit: PAGE_SIZE
    });
    const props = json?.data || [];
    for (const prop of props) {
      rows.push(normalizePropertyFinderV2Property({ ...prop, emirate }));
    }
    if (!props.length || !json?.pagination?.has_next) break;
    await sleep(Math.max(rateLimitMs(), 2200));
  }
  return rows;
}

export async function scrapePropertyFinderApi(
  db,
  upsertListing,
  { emirates = null, maxPages = 2 } = {}
) {
  if (!String(process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_PF_KEY || "").trim()) {
    return { found: 0, upserted: 0, errors: ["RAPIDAPI_KEY not set — skip propertyfinder_api"] };
  }

  let found = 0;
  let upserted = 0;
  const errors = [];

  let locations = [];
  try {
    locations = await fetchEmirateLocations();
  } catch (e) {
    return { found: 0, upserted: 0, errors: [`locations: ${e.message}`] };
  }

  const wanted = emirates ? new Set(emirates) : null;
  for (const loc of locations) {
    if (wanted && !wanted.has(loc.emirate)) continue;
    try {
      const rows = await searchProperties({
        locationId: loc.locationId,
        emirate: loc.emirate,
        maxPages
      });
      found += rows.length;
      for (const row of rows) {
        try {
          upsertListing(db, { ...row, emirate: row.emirate || loc.emirate });
          upserted++;
        } catch (e) {
          errors.push(`${loc.emirate}: ${e.message}`);
        }
      }
    } catch (e) {
      errors.push(`${loc.emirate}: ${e.message}`);
    }
    await sleep(Math.max(rateLimitMs(), 2200));
  }

  return { found, upserted, errors };
}

export function isPropertyFinderApiConfigured() {
  return Boolean(String(process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_PF_KEY || "").trim());
}
