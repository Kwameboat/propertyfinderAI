/**
 * Optional Supabase sync for UAE real estate listings & leads.
 * When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, upserts mirror local SQLite.
 */

import { isGhanaMarket, GHANA_PORTALS, UAE_PORTALS, ghanaListingSources } from "./market.mjs";

function cfg() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ""
  ).trim();
  return { url, key };
}

export function isSupabaseEnabled() {
  const { url, key } = cfg();
  return Boolean(url && key);
}

export function isDemoListingRow(row = {}) {
  const source = String(row.source || "").trim();
  const externalId = String(row.external_id || "").trim();
  if (source === "seed") return true;
  if (externalId.startsWith("gen-")) return true;
  return false;
}

export function demoListingFilterParam() {
  return "and=(source.neq.seed,external_id.not.like.gen-*)";
}

export async function supabaseRequest(path, { method = "GET", body, returnRow = false } = {}) {
  const { url, key } = cfg();
  if (!url || !key) throw new Error("Supabase not configured");

  const prefer =
    method === "POST" && returnRow
      ? "resolution=merge-duplicates,return=representation"
      : method === "POST"
        ? "resolution=merge-duplicates,return=minimal"
        : "return=minimal";

  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: prefer
  };
  // New sb_publishable_/sb_secret_ keys are not JWTs — use apikey header only
  if (!key.startsWith("sb_")) {
    headers.Authorization = `Bearer ${key}`;
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${method} ${path}: ${response.status} ${text.slice(0, 200)}`);
  }
  if (response.status === 204) return null;
  const ct = response.headers.get("content-type") || "";
  if (ct.includes("application/json")) return response.json();
  return null;
}

export function listingToSupabaseRow(listing) {
  const row = {
    source: listing.source,
    external_id: listing.external_id,
    source_url: listing.source_url,
    transaction_type: listing.transaction_type,
    property_type: listing.property_type,
    beds: listing.beds,
    baths: listing.baths,
    emirate: listing.emirate,
    community: listing.community,
    sub_community: listing.sub_community,
    building: listing.building,
    price_aed: listing.price_aed,
    price_period: listing.price_period,
    handover_date: listing.handover_date,
    payment_plan: listing.payment_plan,
    developer: listing.developer,
    furnished: listing.furnished,
    amenities: listing.amenities || [],
    images: listing.images || [],
    description: listing.description,
    agent_name: listing.agent_name,
    agent_phone: listing.agent_phone,
    agency_name: listing.agency_name,
    rera_permit: listing.rera_permit,
    lat: listing.lat,
    lng: listing.lng,
    fingerprint: listing.fingerprint,
    scraped_at: new Date(listing.scraped_at || Date.now()).toISOString(),
    is_active: listing.is_active !== false
  };
  if (listing.listing_status) row.listing_status = listing.listing_status;
  if (listing.last_verified_at) {
    row.last_verified_at = new Date(listing.last_verified_at).toISOString();
  }
  if (listing.size_sqft != null) row.size_sqft = listing.size_sqft;
  if (listing.id) row.id = listing.id;
  return row;
}

export async function syncListingToSupabase(listing) {
  if (!isSupabaseEnabled()) return null;
  return supabaseRequest("listings?on_conflict=source,external_id", {
    method: "POST",
    body: listingToSupabaseRow(listing)
  });
}

export async function syncSessionToSupabase(session) {
  if (!isSupabaseEnabled() || !session?.id) return null;
  const now = new Date().toISOString();
  return supabaseRequest("consumer_sessions?on_conflict=id", {
    method: "POST",
    body: {
      id: session.id,
      user_phone: session.user_phone || "",
      criteria: session.criteria || {},
      status: session.status || "active",
      updated_at: now
    }
  });
}

export async function syncLeadToSupabase(lead, listing = null) {
  if (!isSupabaseEnabled()) return null;
  return supabaseRequest("consumer_leads?on_conflict=id", {
    method: "POST",
    body: {
      id: lead.id,
      session_id: lead.session_id || null,
      listing_id: lead.listing_id || null,
      renter_name: lead.renter_name,
      renter_phone: lead.renter_phone,
      renter_email: lead.renter_email || "",
      criteria: lead.criteria || {},
      qualification_score: lead.qualification_score,
      consent_at: lead.consent_at ? new Date(lead.consent_at).toISOString() : null,
      ops_status: lead.ops_status,
      draft_message: lead.draft_message,
      notes: lead.notes || "",
      channel: lead.channel || "pwa",
      listing_snapshot: listing || null
    }
  });
}

export async function searchListingsSupabase(criteria = {}, limit = 10) {
  if (!isSupabaseEnabled()) return null;
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("is_active", "eq.true");
  params.set("limit", String(Math.min(limit, 50)));
  params.set("order", "scraped_at.desc");
  params.set("and", "(source.neq.seed,external_id.not.like.gen-*)");

  if (criteria.sources?.length) {
    params.set("source", `in.(${criteria.sources.join(",")})`);
  } else if (isGhanaMarket()) {
    params.set("source", `in.(${ghanaListingSources().join(",")})`);
  }
  if (criteria.transaction_type) params.set("transaction_type", `eq.${criteria.transaction_type}`);
  if (criteria.emirates?.length > 1) {
    params.set("emirate", `in.(${criteria.emirates.map((e) => `"${e}"`).join(",")})`);
  } else if (criteria.emirate) {
    params.set("emirate", `eq.${criteria.emirate}`);
  } else if (criteria.emirates?.length === 1) {
    params.set("emirate", `eq.${criteria.emirates[0]}`);
  }
  if (criteria.beds != null) params.set("beds", `gte.${criteria.beds}`);
  if (criteria.max_price != null) params.set("price_aed", `lte.${criteria.max_price}`);
  if (String(process.env.JAB_RE_HIDE_UNAVAILABLE || "0").trim() === "1") {
    params.set("listing_status", "not.in.(rented,sold,withdrawn,unavailable)");
  }

  const rows = await supabaseRequest(`listings?${params.toString()}`);
  if (!Array.isArray(rows)) return [];
  let filtered = rows.filter((r) => !isDemoListingRow(r));
  if (criteria.emirates?.length > 1) {
    filtered = filtered.filter((r) => criteria.emirates.includes(r.emirate));
  } else if (criteria.emirate) {
    filtered = filtered.filter((r) => r.emirate === criteria.emirate);
  }
  if (criteria.community) {
    const q = criteria.community.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        String(r.community || "").toLowerCase().includes(q) ||
        String(r.sub_community || "").toLowerCase().includes(q)
    );
  }
  if (criteria.property_type && criteria.property_type !== "studio") {
    const want = String(criteria.property_type).toLowerCase();
    filtered = filtered.filter((r) => String(r.property_type || "").toLowerCase().includes(want));
  }
  return filtered.slice(0, limit);
}

export function mapSupabaseListing(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    external_id: row.external_id,
    source_url: row.source_url,
    transaction_type: row.transaction_type,
    property_type: row.property_type,
    beds: row.beds,
    baths: row.baths,
    emirate: row.emirate,
    community: row.community,
    sub_community: row.sub_community,
    building: row.building,
    price_aed: row.price_aed,
    price_period: row.price_period,
    handover_date: row.handover_date,
    payment_plan: row.payment_plan,
    developer: row.developer,
    furnished: row.furnished,
    amenities: row.amenities || [],
    images: row.images || [],
    description: row.description,
    agent_name: row.agent_name,
    agent_phone: row.agent_phone,
    agency_name: row.agency_name,
    rera_permit: row.rera_permit,
    lat: row.lat,
    lng: row.lng,
    fingerprint: row.fingerprint,
    scraped_at: row.scraped_at,
    is_active: row.is_active !== false,
    listing_status: row.listing_status || "available",
    last_verified_at: row.last_verified_at || null,
    size_sqft: row.size_sqft != null ? Number(row.size_sqft) : null
  };
}

const BATCH_SIZE = 100;

function dedupeListingRows(listings = []) {
  const map = new Map();
  for (const row of listings) {
    if (!row?.source || !row?.external_id) continue;
    map.set(`${row.source}:${row.external_id}`, row);
  }
  return [...map.values()];
}

export async function batchSyncListingsToSupabase(listings = []) {
  const result = await batchSyncListingsToSupabaseWithReturn(listings);
  return { upserted: result.length };
}

export async function batchSyncListingsToSupabaseWithReturn(listings = []) {
  if (!isSupabaseEnabled() || !listings.length) return [];
  const deduped = dedupeListingRows(listings);
  const out = [];
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const chunk = deduped.slice(i, i + BATCH_SIZE).map(listingToSupabaseRow);
    const rows = await supabaseRequest("listings?on_conflict=source,external_id", {
      method: "POST",
      body: chunk,
      returnRow: true
    });
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const mapped = mapSupabaseListing(row);
        if (mapped) out.push(mapped);
      }
    }
  }
  return out;
}

export async function getListingSupabase(id) {
  if (!isSupabaseEnabled() || !id) return null;
  const key = String(id).trim();

  let rows = await supabaseRequest(`listings?id=eq.${encodeURIComponent(key)}&limit=1`);
  if (Array.isArray(rows) && rows.length) return mapSupabaseListing(rows[0]);

  if (key.includes(":")) {
    const [source, external_id] = key.split(":", 2);
    rows = await supabaseRequest(
      `listings?source=eq.${encodeURIComponent(source)}&external_id=eq.${encodeURIComponent(external_id)}&limit=1`
    );
    if (Array.isArray(rows) && rows.length) return mapSupabaseListing(rows[0]);
  }

  rows = await supabaseRequest(`listings?external_id=eq.${encodeURIComponent(key)}&limit=1`);
  if (Array.isArray(rows) && rows.length) return mapSupabaseListing(rows[0]);

  return null;
}

export async function countActiveListingsSupabase() {
  if (!isSupabaseEnabled()) return null;
  const { url, key } = cfg();
  const response = await fetch(
    `${url}/rest/v1/listings?select=id&is_active=eq.true&${demoListingFilterParam()}`,
    {
      method: "HEAD",
      headers: {
        apikey: key,
        Prefer: "count=exact",
        ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` })
      },
      signal: AbortSignal.timeout(15000)
    }
  );
  if (!response.ok) return null;
  const range = response.headers.get("content-range") || "";
  const m = range.match(/\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

export async function countListingsBySourceSupabase(sources) {
  if (!isSupabaseEnabled()) return null;
  const filter = sources?.length ? `&source=in.(${sources.join(",")})` : "";
  const rows = await supabaseRequest(
    `listings?select=source,external_id&is_active=eq.true${filter}&limit=10000`
  );
  if (!Array.isArray(rows)) return {};
  return rows.reduce((acc, row) => {
    if (isDemoListingRow(row)) return acc;
    const s = row.source || "unknown";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
}

/** Remove seed + generated demo inventory from Supabase. */
export async function deleteDemoListingsSupabase() {
  if (!isSupabaseEnabled()) return { deleted: 0 };
  const headers = buildSupabaseHeaders({ prefer: "return=minimal" });
  const { url } = cfg();
  let deleted = 0;

  for (const filter of ["source=eq.seed", "external_id=like.gen-*"]) {
    const response = await fetch(`${url}/rest/v1/listings?${filter}`, {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" },
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase DELETE listings (${filter}): ${response.status} ${text.slice(0, 200)}`);
    }
    const rows = response.status !== 204 ? await response.json() : [];
    deleted += Array.isArray(rows) ? rows.length : 0;
  }

  return { deleted };
}

/** Hard-delete inactive rows so only refreshed scrape inventory remains. */
export async function deleteInactiveListingsSupabase() {
  if (!isSupabaseEnabled()) return { deleted: 0 };
  const { url } = cfg();
  const response = await fetch(`${url}/rest/v1/listings?is_active=eq.false`, {
    method: "DELETE",
    headers: { ...buildSupabaseHeaders(), Prefer: "return=representation" },
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase DELETE inactive listings: ${response.status} ${text.slice(0, 200)}`);
  }
  const rows = response.status !== 204 ? await response.json() : [];
  return { deleted: Array.isArray(rows) ? rows.length : 0 };
}

/** Delete every listing row — use before a full re-scrape. */
export async function deleteAllListingsSupabase() {
  if (!isSupabaseEnabled()) return { deleted: 0 };
  const { url } = cfg();
  const response = await fetch(`${url}/rest/v1/listings?id=not.is.null`, {
    method: "DELETE",
    headers: { ...buildSupabaseHeaders(), Prefer: "return=representation" },
    signal: AbortSignal.timeout(180000)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase DELETE all listings: ${response.status} ${text.slice(0, 200)}`);
  }
  const rows = response.status !== 204 ? await response.json() : [];
  return { deleted: Array.isArray(rows) ? rows.length : 0 };
}

function buildSupabaseHeaders({ prefer = "return=minimal" } = {}) {
  const { key } = cfg();
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: prefer
  };
  if (!key.startsWith("sb_")) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

export async function startScrapeRunSupabase({ source, emirate = "", transaction_type = "" } = {}) {
  if (!isSupabaseEnabled()) return null;
  const rows = await supabaseRequest("scrape_runs", {
    method: "POST",
    returnRow: true,
    body: { source, emirate, transaction_type, listings_found: 0, listings_upserted: 0, errors: [] }
  });
  return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
}

export async function finishScrapeRunSupabase(
  runId,
  { listings_found = 0, listings_upserted = 0, errors = [] } = {}
) {
  if (!isSupabaseEnabled() || !runId) return null;
  return supabaseRequest(`scrape_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: {
      listings_found,
      listings_upserted,
      errors,
      finished_at: new Date().toISOString()
    }
  });
}

/** Mark listings inactive when not refreshed within maxAgeHours. */
export async function markStaleListingsSupabase({ maxAgeHours = 72, sources } = {}) {
  if (!isSupabaseEnabled()) return 0;
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const portalSources = sources?.length ? sources : isGhanaMarket() ? GHANA_PORTALS : UAE_PORTALS;
  const sourceFilter = `source=in.(${portalSources.join(",")})`;
  await supabaseRequest(
    `listings?scraped_at=lt.${encodeURIComponent(cutoff)}&is_active=eq.true&${sourceFilter}`,
    {
      method: "PATCH",
      body: { is_active: false }
    }
  );
  return null;
}

/** Upsert live-search row into `inventory` table. */
export async function upsertInventoryRow(row = {}) {
  if (!isSupabaseEnabled() || !row.url) return null;
  const body = {
    url: row.url,
    title: row.title || "",
    description: row.description || "",
    price: row.price || (row.price_aed ? `AED ${row.price_aed}` : ""),
    location: row.location || row.community || row.emirate || "",
    developer: row.developer || "",
    unit_types: row.unit_types || [],
    amenities: row.amenities || [],
    images: row.images || [],
    payment_plan: row.payment_plan || "",
    source: row.source || "live_search",
    last_updated: new Date().toISOString(),
    metadata: row.metadata || {}
  };
  const rows = await supabaseRequest("inventory?on_conflict=url", {
    method: "POST",
    body,
    returnRow: true
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

/** Search inventory by location/title (for photo refresh). */
export async function searchInventorySupabase({ q = "", limit = 5 } = {}) {
  if (!isSupabaseEnabled()) return [];
  const term = encodeURIComponent(String(q || "").trim());
  if (!term) {
    return supabaseRequest(`inventory?select=*&order=last_updated.desc&limit=${limit}`);
  }
  return supabaseRequest(
    `inventory?select=*&or=(location.ilike.*${term}*,title.ilike.*${term}*,description.ilike.*${term}*)&order=last_updated.desc&limit=${limit}`
  );
}

/** Upsert developer/government intel row. */
export async function upsertDeveloperIntelRow(row = {}) {
  if (!isSupabaseEnabled() || !row.url) return null;
  const body = {
    url: row.url,
    source_name: row.source_name || "",
    source_type: row.source_type || "developer",
    title: row.title || row.project_name || "",
    summary: row.summary || "",
    developer: row.developer || "",
    project_name: row.project_name || "",
    emirate: row.emirate || "",
    payment_plan: row.payment_plan || "",
    handover: row.handover || "",
    price_from: row.price_from || "",
    unit_types: row.unit_types || [],
    amenities: row.amenities || [],
    images: row.images || [],
    last_updated: new Date().toISOString(),
    metadata: row.metadata || {}
  };
  const rows = await supabaseRequest("developer_intel?on_conflict=url", {
    method: "POST",
    body,
    returnRow: true
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

/** Search developer_intel cache. */
export async function searchDeveloperIntelSupabase({ q = "", limit = 8 } = {}) {
  if (!isSupabaseEnabled()) return [];
  const term = encodeURIComponent(String(q || "").trim());
  if (!term) {
    return supabaseRequest(`developer_intel?select=*&order=last_updated.desc&limit=${limit}`);
  }
  return supabaseRequest(
    `developer_intel?select=*&or=(title.ilike.*${term}*,summary.ilike.*${term}*,developer.ilike.*${term}*,project_name.ilike.*${term}*,source_name.ilike.*${term}*)&order=last_updated.desc&limit=${limit}`
  );
}
