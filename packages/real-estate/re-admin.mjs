/**
 * Real Estate admin / ERP data layer.
 */

import {
  listLeadsByStatus,
  getReLead,
  updateLead,
  RE_LEAD_CHANNELS
} from "../hub-db/real-estate.mjs";
import { getListingsStatus, getListingStore } from "./listings-store.mjs";
import { isSupabaseEnabled, supabaseRequest, mapSupabaseListing } from "./supabase.mjs";
import { getModeSummary } from "./mode.mjs";
import {
  getPuppeteerCronSources,
  isPuppeteerScrapeEnabled,
  PUPPETEER_INGEST_SOURCES
} from "./puppeteer-mode.mjs";
import { runPuppeteerIngestAll } from "./puppeteer-scrape.mjs";
import { runIngestStaleCleanup } from "./ingest.mjs";
import { scrapeListingsFromUrl, validatePortalUrl } from "./url-scrape.mjs";
import { liveSearchStatus } from "./ghana-live-search.mjs";
import { isN8nLiveSearchEnabled } from "./n8n-live-search.mjs";
import { isGhanaMarket } from "./market.mjs";

export { scrapeListingsFromUrl, validatePortalUrl };

export async function getReAdminDashboard(db) {
  const listingStatus = await getListingsStatus(db);
  const leads = await listReLeads(db, { limit: 500 });
  const leadCounts = {};
  for (const l of leads) {
    const s = l.ops_status || "new";
    leadCounts[s] = (leadCounts[s] || 0) + 1;
  }

  let scrapeRuns = [];
  if (isSupabaseEnabled()) {
    try {
      scrapeRuns = await supabaseRequest(
        "scrape_runs?select=id,source,listings_found,listings_upserted,errors,started_at,finished_at&order=started_at.desc&limit=15"
      );
    } catch {
      scrapeRuns = [];
    }
  }

  return {
    listings: listingStatus.listings,
    sources: listingStatus.sources,
    store: listingStatus.store,
    leads: {
      total: leads.length,
      byStatus: leadCounts,
      recent: leads.slice(0, 8).map(formatLeadRow)
    },
    scrapeRuns: Array.isArray(scrapeRuns) ? scrapeRuns : [],
    mode: getModeSummary(),
    puppeteer: {
      enabled: isPuppeteerScrapeEnabled(),
      cronSources: getPuppeteerCronSources(),
      allSources: PUPPETEER_INGEST_SOURCES
    },
    liveSearch: liveSearchStatus(),
    n8nLiveSearch: isN8nLiveSearchEnabled(),
    market: isGhanaMarket() ? "GH" : "AE"
  };
}

function formatLeadRow(l) {
  return {
    id: l.id,
    renter_name: l.renter_name,
    renter_phone: l.renter_phone,
    listing_id: l.listing_id,
    ops_status: l.ops_status,
    qualification_score: l.qualification_score,
    notes: l.notes,
    criteria: l.criteria || {},
    channel: l.channel || "pwa",
    created_at: l.created_at,
    updated_at: l.updated_at
  };
}

function isConsumerReLead(lead) {
  const channel = String(lead?.channel || "pwa").trim() || "pwa";
  return RE_LEAD_CHANNELS.includes(channel);
}

export async function listReLeads(db, { status, limit = 50, offset = 0 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);

  if (isSupabaseEnabled()) {
    try {
      const params = new URLSearchParams();
      params.set("select", "*");
      params.set("order", "created_at.desc");
      params.set("limit", String(cap));
      params.set("offset", String(off));
      params.set("or", `(channel.in.(${RE_LEAD_CHANNELS.join(",")}),channel.is.null)`);
      if (status) params.set("ops_status", `eq.${status}`);
      const rows = await supabaseRequest(`consumer_leads?${params.toString()}`);
      return Array.isArray(rows)
        ? rows
            .map((r) =>
              formatLeadRow({
                id: r.id,
                renter_name: r.renter_name,
                renter_phone: r.renter_phone,
                listing_id: r.listing_id,
                ops_status: r.ops_status,
                qualification_score: r.qualification_score,
                notes: r.notes,
                criteria: r.criteria || {},
                channel: r.channel,
                created_at: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
                updated_at: r.updated_at ? new Date(r.updated_at).getTime() : Date.now()
              })
            )
            .filter(isConsumerReLead)
        : [];
    } catch {
      /* fall through sqlite */
    }
  }

  if (status) {
    return listLeadsByStatus(db, status, cap)
      .slice(off, off + cap)
      .filter(isConsumerReLead)
      .map(formatLeadRow);
  }
  const rows = db
    .prepare(
      `SELECT * FROM re_leads
       WHERE channel IN (${RE_LEAD_CHANNELS.map(() => "?").join(",")})
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...RE_LEAD_CHANNELS, cap, off)
    .map((r) => ({
      ...r,
      criteria: (() => {
        try {
          return JSON.parse(r.criteria_json || "{}");
        } catch {
          return {};
        }
      })()
    }));
  return rows.filter(isConsumerReLead).map(formatLeadRow);
}

export async function patchReLead(db, id, patch = {}) {
  if (isSupabaseEnabled()) {
    try {
      const body = {};
      if (patch.ops_status != null) body.ops_status = patch.ops_status;
      if (patch.notes != null) body.notes = patch.notes;
      if (patch.renter_name != null) body.renter_name = patch.renter_name;
      body.updated_at = new Date().toISOString();
      await supabaseRequest(`consumer_leads?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body
      });
    } catch {
      /* sqlite fallback */
    }
  }
  const updated = updateLead(db, id, patch);
  return updated ? formatLeadRow({ ...updated, criteria: updated.criteria || {} }) : null;
}

export async function listAdminListings(
  db,
  { limit = 30, offset = 0, source, emirate, beds, transaction_type, q } = {}
) {
  const cap = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);

  if (isSupabaseEnabled()) {
    const params = new URLSearchParams();
    params.set(
      "select",
      "id,source,external_id,emirate,community,beds,baths,price_aed,price_period,transaction_type,property_type,scraped_at,is_active,source_url,images,listing_status,size_sqft"
    );
    params.set("is_active", "eq.true");
    params.set("order", "scraped_at.desc");
    params.set("limit", String(cap));
    params.set("offset", String(off));
    params.set("and", "(source.neq.seed,external_id.not.like.gen-*)");
    if (source) params.set("source", `eq.${source}`);
    if (emirate) params.set("emirate", `eq.${emirate}`);
    if (beds != null && beds !== "") params.set("beds", `eq.${Number(beds)}`);
    if (transaction_type) params.set("transaction_type", `eq.${transaction_type}`);
    if (q) {
      params.set("or", `(community.ilike.*${q}*,description.ilike.*${q}*,building.ilike.*${q}*)`);
    }
    const rows = await supabaseRequest(`listings?${params.toString()}`);
    return Array.isArray(rows) ? rows.map(mapSupabaseListing) : [];
  }

  let sql = `SELECT id, source, external_id, emirate, community, beds, baths, price_aed, price_period, transaction_type, property_type, scraped_at, is_active, source_url, images_json, listing_status, size_sqft
    FROM re_listings WHERE is_active = 1 AND source != 'seed' AND external_id NOT LIKE 'gen-%'`;
  const params = [];
  if (source) {
    sql += ` AND source = ?`;
    params.push(source);
  }
  if (emirate) {
    sql += ` AND emirate = ?`;
    params.push(emirate);
  }
  if (beds != null && beds !== "") {
    sql += ` AND beds = ?`;
    params.push(Number(beds));
  }
  if (transaction_type) {
    sql += ` AND transaction_type = ?`;
    params.push(transaction_type);
  }
  if (q) {
    sql += ` AND (community LIKE ? OR description LIKE ? OR building LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY scraped_at DESC LIMIT ? OFFSET ?`;
  params.push(cap, off);
  return db.prepare(sql).all(...params).map((r) => ({
    ...r,
    images: (() => {
      try {
        return JSON.parse(r.images_json || "[]");
      } catch {
        return [];
      }
    })()
  }));
}

export async function countAdminListings(db, filters = {}) {
  if (isSupabaseEnabled()) {
    const params = new URLSearchParams();
    params.set("select", "id");
    params.set("is_active", "eq.true");
    params.set("and", "(source.neq.seed,external_id.not.like.gen-*)");
    if (filters.source) params.set("source", `eq.${filters.source}`);
    if (filters.emirate) params.set("emirate", `eq.${filters.emirate}`);
    if (filters.beds != null && filters.beds !== "") params.set("beds", `eq.${Number(filters.beds)}`);
    if (filters.transaction_type) params.set("transaction_type", `eq.${filters.transaction_type}`);
    if (filters.q) {
      params.set("or", `(community.ilike.*${filters.q}*,description.ilike.*${filters.q}*,building.ilike.*${filters.q}*)`);
    }
    const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
    const apiKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "";
    const res = await fetch(`${baseUrl}/rest/v1/listings?${params.toString()}`, {
      method: "HEAD",
      headers: { apikey: apiKey, Prefer: "count=exact" },
      signal: AbortSignal.timeout(15000)
    });
    const range = res.headers.get("content-range") || "";
    const m = range.match(/\/(\d+)$/);
    return m ? Number(m[1]) : 0;
  }

  let sql = `SELECT COUNT(*) AS n FROM re_listings WHERE is_active = 1 AND source != 'seed' AND external_id NOT LIKE 'gen-%'`;
  const params = [];
  if (filters.source) {
    sql += ` AND source = ?`;
    params.push(filters.source);
  }
  if (filters.emirate) {
    sql += ` AND emirate = ?`;
    params.push(filters.emirate);
  }
  if (filters.beds != null && filters.beds !== "") {
    sql += ` AND beds = ?`;
    params.push(Number(filters.beds));
  }
  if (filters.transaction_type) {
    sql += ` AND transaction_type = ?`;
    params.push(filters.transaction_type);
  }
  if (filters.q) {
    sql += ` AND (community LIKE ? OR description LIKE ? OR building LIKE ?)`;
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  return db.prepare(sql).get(...params)?.n || 0;
}

export async function getAdminListingById(db, id) {
  return getListingStore(db, id);
}

export async function patchAdminListing(db, id, patch = {}) {
  const existing = await getListingStore(db, id);
  if (!existing) return null;

  if (isSupabaseEnabled()) {
    const body = { updated_at: new Date().toISOString() };
    if (patch.is_active != null) body.is_active = patch.is_active !== false;
    if (patch.listing_status) body.listing_status = patch.listing_status;
    await supabaseRequest(`listings?id=eq.${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      body
    });
  }

  if (patch.is_active === false) {
    db.prepare(`UPDATE re_listings SET is_active = 0, updated_at = ? WHERE id = ?`).run(
      Date.now(),
      existing.id
    );
  }

  return getAdminListingById(db, existing.id);
}

export async function listScrapeRuns({ limit = 20 } = {}) {
  if (!isSupabaseEnabled()) return [];
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 50);
  try {
    const rows = await supabaseRequest(`scrape_runs?select=*&order=started_at.desc&limit=${cap}`);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function triggerPuppeteerIngest(options = {}) {
  return runPuppeteerIngestAll(getPuppeteerCronSources(), {
    maxPages: options.maxPages || 3
  });
}

export async function triggerStaleCleanup() {
  return runIngestStaleCleanup();
}

export function getReLeadById(db, id) {
  const l = getReLead(db, id);
  if (!l || !isConsumerReLead(l)) return null;
  return formatLeadRow({ ...l, criteria: l.criteria || {} });
}
