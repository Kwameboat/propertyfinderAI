/**
 * UAE Real Estate concierge — listings, chat sessions, leads, knowledge (SQLite).
 * Optional Supabase sync via packages/real-estate/supabase.mjs when env is set.
 */

import { createHash, randomUUID } from "node:crypto";
import { clusterKey } from "../real-estate/cluster.mjs";
import { isGhanaMarket } from "../real-estate/market.mjs";

export const UAE_EMIRATES = [
  "Dubai",
  "Abu Dhabi",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah"
];

export const TRANSACTION_TYPES = ["rent", "sale", "off_plan"];

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw || "");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function listingFingerprint(row) {
  const key = [
    row.source,
    row.external_id,
    row.transaction_type,
    row.emirate,
    row.community,
    row.beds,
    row.price_aed
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export function migrateRealEstate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS re_listings (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '',
      transaction_type TEXT NOT NULL,
      property_type TEXT DEFAULT 'apartment',
      beds REAL,
      baths REAL,
      emirate TEXT NOT NULL,
      community TEXT DEFAULT '',
      sub_community TEXT DEFAULT '',
      building TEXT DEFAULT '',
      price_aed REAL NOT NULL,
      price_period TEXT DEFAULT 'yearly',
      handover_date TEXT,
      payment_plan TEXT DEFAULT '',
      developer TEXT DEFAULT '',
      furnished INTEGER,
      amenities_json TEXT NOT NULL DEFAULT '[]',
      images_json TEXT NOT NULL DEFAULT '[]',
      description TEXT DEFAULT '',
      agent_name TEXT DEFAULT '',
      agent_phone TEXT DEFAULT '',
      agency_name TEXT DEFAULT '',
      rera_permit TEXT DEFAULT '',
      lat REAL,
      lng REAL,
      fingerprint TEXT NOT NULL,
      scraped_at INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(source, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_re_listings_search
      ON re_listings(is_active, transaction_type, emirate, beds, price_aed);

    CREATE TABLE IF NOT EXISTS re_sessions (
      id TEXT PRIMARY KEY,
      user_phone TEXT DEFAULT '',
      criteria_json TEXT NOT NULL DEFAULT '{}',
      messages_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS re_leads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      listing_id TEXT,
      renter_name TEXT DEFAULT '',
      renter_phone TEXT NOT NULL,
      renter_email TEXT DEFAULT '',
      criteria_json TEXT NOT NULL DEFAULT '{}',
      qualification_score INTEGER NOT NULL DEFAULT 0,
      consent_at INTEGER,
      ops_status TEXT NOT NULL DEFAULT 'new',
      telegram_chat_id TEXT DEFAULT '',
      telegram_message_id TEXT DEFAULT '',
      sent_to_agent_phone TEXT DEFAULT '',
      sent_at INTEGER,
      notes TEXT DEFAULT '',
      draft_message TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES re_sessions(id),
      FOREIGN KEY (listing_id) REFERENCES re_listings(id)
    );

    CREATE INDEX IF NOT EXISTS idx_re_leads_status ON re_leads(ops_status);

    CREATE TABLE IF NOT EXISTS re_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      body TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_re_knowledge_cat ON re_knowledge(category);

    CREATE TABLE IF NOT EXISTS re_scrape_runs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      emirate TEXT DEFAULT '',
      transaction_type TEXT DEFAULT '',
      listings_found INTEGER NOT NULL DEFAULT 0,
      listings_upserted INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS re_saved_searches (
      id TEXT PRIMARY KEY,
      user_phone TEXT NOT NULL,
      label TEXT DEFAULT '',
      criteria_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      last_notified_at INTEGER,
      last_match_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_re_saved_searches_phone ON re_saved_searches(user_phone, active);
    CREATE INDEX IF NOT EXISTS idx_re_sessions_phone ON re_sessions(user_phone, updated_at);
  `);

  for (const sql of [
    `ALTER TABLE re_listings ADD COLUMN listing_status TEXT NOT NULL DEFAULT 'available'`,
    `ALTER TABLE re_listings ADD COLUMN last_verified_at INTEGER`,
    `ALTER TABLE re_listings ADD COLUMN size_sqft REAL`,
    `ALTER TABLE re_leads ADD COLUMN channel TEXT NOT NULL DEFAULT 'pwa'`,
    `ALTER TABLE re_listings ADD COLUMN cluster_id TEXT DEFAULT ''`
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* column exists */
    }
  }
}

export const RE_LEAD_CHANNELS = ["pwa", "whatsapp"];

export const RE_LEAD_STATUSES = [
  "new",
  "contacted",
  "viewing_scheduled",
  "viewed",
  "offer",
  "closed",
  "lost",
  "pending_telegram",
  "sent"
];

export function normalizeListingInput(input = {}) {
  const now = Date.now();
  const row = {
    id: input.id || randomUUID(),
    source: String(input.source || "manual").trim(),
    external_id: String(input.external_id || input.id || randomUUID()).trim(),
    source_url: String(input.source_url || "").trim(),
    transaction_type: String(input.transaction_type || "rent").trim(),
    property_type: String(input.property_type || "apartment").trim(),
    beds: input.beds != null ? Number(input.beds) : null,
    baths: input.baths != null ? Number(input.baths) : null,
    emirate: String(input.emirate || "Dubai").trim(),
    community: String(input.community || "").trim(),
    sub_community: String(input.sub_community || "").trim(),
    building: String(input.building || "").trim(),
    price_aed: Number(input.price_aed || 0),
    price_period: String(input.price_period || "yearly").trim(),
    handover_date: input.handover_date ? String(input.handover_date) : null,
    payment_plan: String(input.payment_plan || "").trim(),
    developer: String(input.developer || "").trim(),
    furnished:
      input.furnished === true || input.furnished === 1
        ? 1
        : input.furnished === false || input.furnished === 0
          ? 0
          : null,
    amenities: Array.isArray(input.amenities) ? input.amenities : parseJson(input.amenities_json, []),
    images: Array.isArray(input.images) ? input.images : parseJson(input.images_json, []),
    description: String(input.description || "").trim(),
    agent_name: String(input.agent_name || "").trim(),
    agent_phone: String(input.agent_phone || "").trim(),
    agency_name: String(input.agency_name || "").trim(),
    rera_permit: String(input.rera_permit || "").trim(),
    lat: input.lat != null ? Number(input.lat) : null,
    lng: input.lng != null ? Number(input.lng) : null,
    scraped_at: Number(input.scraped_at || now),
    is_active: input.is_active === false || input.is_active === 0 ? 0 : 1,
    cluster_id: String(input.cluster_id || "").trim()
  };
  row.fingerprint = listingFingerprint(row);
  if (!row.cluster_id) row.cluster_id = clusterKey(row);
  return row;
}

function mapListingRow(r) {
  if (!r) return null;
  const { images_json, amenities_json, ...rest } = r;
  return {
    ...rest,
    furnished: r.furnished == null ? null : Boolean(r.furnished),
    is_active: Boolean(r.is_active),
    amenities: parseJson(amenities_json, []),
    images: parseJson(images_json, [])
  };
}

export function upsertListing(db, input) {
  const row = normalizeListingInput(input);
  const now = Date.now();
  const existing = db
    .prepare(`SELECT id, images_json FROM re_listings WHERE source = ? AND external_id = ?`)
    .get(row.source, row.external_id);

  if (existing) {
    const storedImages = parseJson(existing.images_json, []);
    if (Array.isArray(storedImages) && storedImages.length > (row.images || []).length) {
      row.images = storedImages;
    }
    db.prepare(`
      UPDATE re_listings SET
        source_url = ?, transaction_type = ?, property_type = ?, beds = ?, baths = ?,
        emirate = ?, community = ?, sub_community = ?, building = ?,
        price_aed = ?, price_period = ?, handover_date = ?, payment_plan = ?, developer = ?,
        furnished = ?, amenities_json = ?, images_json = ?, description = ?,
        agent_name = ?, agent_phone = ?, agency_name = ?, rera_permit = ?,
        lat = ?, lng = ?, fingerprint = ?, cluster_id = ?, scraped_at = ?, is_active = 1, updated_at = ?
      WHERE source = ? AND external_id = ?
    `).run(
      row.source_url,
      row.transaction_type,
      row.property_type,
      row.beds,
      row.baths,
      row.emirate,
      row.community,
      row.sub_community,
      row.building,
      row.price_aed,
      row.price_period,
      row.handover_date,
      row.payment_plan,
      row.developer,
      row.furnished,
      JSON.stringify(row.amenities),
      JSON.stringify(row.images),
      row.description,
      row.agent_name,
      row.agent_phone,
      row.agency_name,
      row.rera_permit,
      row.lat,
      row.lng,
      row.fingerprint,
      row.cluster_id,
      row.scraped_at,
      now,
      row.source,
      row.external_id
    );
    return getListing(db, existing.id);
  }

  db.prepare(`
    INSERT INTO re_listings (
      id, source, external_id, source_url, transaction_type, property_type,
      beds, baths, emirate, community, sub_community, building,
      price_aed, price_period, handover_date, payment_plan, developer,
      furnished, amenities_json, images_json, description,
      agent_name, agent_phone, agency_name, rera_permit, lat, lng,
      fingerprint, cluster_id, scraped_at, is_active, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
    )
  `).run(
    row.id,
    row.source,
    row.external_id,
    row.source_url,
    row.transaction_type,
    row.property_type,
    row.beds,
    row.baths,
    row.emirate,
    row.community,
    row.sub_community,
    row.building,
    row.price_aed,
    row.price_period,
    row.handover_date,
    row.payment_plan,
    row.developer,
    row.furnished,
    JSON.stringify(row.amenities),
    JSON.stringify(row.images),
    row.description,
    row.agent_name,
    row.agent_phone,
    row.agency_name,
    row.rera_permit,
    row.lat,
    row.lng,
    row.fingerprint,
    row.cluster_id,
    row.scraped_at,
    now,
    now
  );
  return getListing(db, row.id);
}

export function getListing(db, id) {
  const key = String(id || "").trim();
  let r = db.prepare(`SELECT * FROM re_listings WHERE id = ?`).get(key);
  if (!r && key.includes(":")) {
    const [source, external_id] = key.split(":", 2);
    r = db.prepare(`SELECT * FROM re_listings WHERE source = ? AND external_id = ?`).get(source, external_id);
  }
  if (!r) {
    r = db.prepare(`SELECT * FROM re_listings WHERE external_id = ?`).get(key);
  }
  return mapListingRow(r);
}

export function searchListings(db, criteria = {}, limit = 10) {
  const clauses = ["is_active = 1"];
  const params = [];
  const includeSeed = isGhanaMarket() || Boolean(criteria.include_seed);
  if (!includeSeed) {
    clauses.push("source != 'seed'");
    clauses.push("external_id NOT LIKE 'gen-%'");
  }

  if (criteria.sources?.length) {
    clauses.push(`source IN (${criteria.sources.map(() => "?").join(",")})`);
    params.push(...criteria.sources);
  }
  if (criteria.transaction_type) {
    clauses.push("transaction_type = ?");
    params.push(criteria.transaction_type);
  }
  if (criteria.emirates?.length) {
    clauses.push(`emirate IN (${criteria.emirates.map(() => "?").join(",")})`);
    params.push(...criteria.emirates);
  } else if (criteria.emirate) {
    clauses.push("emirate = ?");
    params.push(criteria.emirate);
  }
  if (criteria.beds != null) {
    if (Number(criteria.beds) === 0) {
      clauses.push("(beds = 0 OR beds IS NULL OR property_type LIKE ?)");
      params.push("%studio%");
    } else {
      clauses.push("beds >= ?");
      params.push(Number(criteria.beds));
    }
  }
  if (criteria.max_price != null) {
    clauses.push("price_aed <= ?");
    params.push(Number(criteria.max_price));
  }
  if (criteria.min_price != null) {
    clauses.push("price_aed >= ?");
    params.push(Number(criteria.min_price));
  }
  if (criteria.community) {
    clauses.push("(community LIKE ? OR sub_community LIKE ? OR building LIKE ?)");
    const q = `%${criteria.community}%`;
    params.push(q, q, q);
  }
  if (criteria.furnished === true) {
    clauses.push("furnished = 1");
  } else if (criteria.furnished === false) {
    clauses.push("furnished = 0");
  }
  if (criteria.developer) {
    clauses.push("developer LIKE ?");
    params.push(`%${criteria.developer}%`);
  }
  if (criteria.property_type && criteria.property_type !== "studio") {
    clauses.push("property_type LIKE ?");
    params.push(`%${criteria.property_type}%`);
  }
  if (String(process.env.JAB_RE_HIDE_UNAVAILABLE || "0").trim() === "1") {
    clauses.push("(listing_status IS NULL OR listing_status IN ('available', 'under_offer', 'unknown'))");
  }

  const sql = `
    SELECT * FROM re_listings
    WHERE ${clauses.join(" AND ")}
    ORDER BY scraped_at DESC, price_aed ASC
    LIMIT ?
  `;
  params.push(Math.min(Math.max(1, limit), 50));
  return db.prepare(sql).all(...params).map(mapListingRow);
}

export function countActiveListings(db) {
  const sql = isGhanaMarket()
    ? `SELECT COUNT(*) AS n FROM re_listings WHERE is_active = 1`
    : `SELECT COUNT(*) AS n FROM re_listings WHERE is_active = 1 AND source != 'seed' AND external_id NOT LIKE 'gen-%'`;
  return db.prepare(sql).get()?.n || 0;
}

export function countListingsBySource(db) {
  const where = isGhanaMarket()
    ? `WHERE is_active = 1`
    : `WHERE is_active = 1 AND source != 'seed' AND external_id NOT LIKE 'gen-%'`;
  return db
    .prepare(`SELECT source, COUNT(*) AS count FROM re_listings ${where} GROUP BY source ORDER BY count DESC`)
    .all();
}

export function normalizeRePhone(phone = "") {
  return String(phone || "").replace(/\D/g, "");
}

export function createSession(db, { userPhone = "" } = {}) {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO re_sessions (id, user_phone, criteria_json, messages_json, status, created_at, updated_at)
    VALUES (?, ?, '{}', '[]', 'active', ?, ?)
  `).run(id, normalizeRePhone(userPhone), now, now);
  return getSession(db, id);
}

/** Reuse latest session for a WhatsApp phone or create a new one. */
export function getOrCreateSessionByPhone(db, userPhone = "") {
  const phone = normalizeRePhone(userPhone);
  if (!phone) return createSession(db, { userPhone: "" });
  const existing = db
    .prepare(
      `SELECT id FROM re_sessions WHERE user_phone = ? AND status != 'closed' ORDER BY updated_at DESC LIMIT 1`
    )
    .get(phone);
  if (existing?.id) return getSession(db, existing.id);
  return createSession(db, { userPhone: phone });
}

export function getSession(db, id) {
  const r = db.prepare(`SELECT * FROM re_sessions WHERE id = ?`).get(id);
  if (!r) return null;
  return {
    ...r,
    criteria: parseJson(r.criteria_json, {}),
    messages: parseJson(r.messages_json, [])
  };
}

export function updateSession(db, id, patch = {}) {
  const existing = getSession(db, id);
  if (!existing) return null;
  const now = Date.now();
  const criteria = { ...existing.criteria, ...(patch.criteria || {}) };
  let messages = existing.messages;
  if (patch.appendMessage) {
    messages = [...messages, patch.appendMessage].slice(-40);
  }
  if (patch.messages) messages = patch.messages;
  db.prepare(`
    UPDATE re_sessions SET
      user_phone = COALESCE(?, user_phone),
      criteria_json = ?,
      messages_json = ?,
      status = COALESCE(?, status),
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.userPhone ?? null,
    JSON.stringify(criteria),
    JSON.stringify(messages),
    patch.status ?? null,
    now,
    id
  );
  return getSession(db, id);
}

export function createLead(db, input = {}) {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO re_leads (
      id, session_id, listing_id, renter_name, renter_phone, renter_email,
      criteria_json, qualification_score, consent_at, ops_status, channel,
      notes, draft_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)
  `).run(
    id,
    input.session_id,
    input.listing_id || null,
    String(input.renter_name || "").trim(),
    String(input.renter_phone || "").trim(),
    String(input.renter_email || "").trim(),
    JSON.stringify(input.criteria || {}),
    Number(input.qualification_score || 0),
    input.consent_at || now,
    String(input.channel || "pwa").trim() || "pwa",
    String(input.notes || "").trim(),
    String(input.draft_message || "").trim(),
    now,
    now
  );
  return getReLead(db, id);
}

export function getReLead(db, id) {
  const r = db.prepare(`SELECT * FROM re_leads WHERE id = ?`).get(id);
  if (!r) return null;
  return { ...r, criteria: parseJson(r.criteria_json, {}) };
}

export function listLeadsByStatus(db, status, limit = 50) {
  return db
    .prepare(`SELECT * FROM re_leads WHERE ops_status = ? ORDER BY created_at DESC LIMIT ?`)
    .all(status, limit)
    .map((r) => ({ ...r, criteria: parseJson(r.criteria_json, {}) }));
}

export function updateLead(db, id, patch = {}) {
  const now = Date.now();
  const fields = [];
  const params = [];
  const allowed = [
    "ops_status",
    "telegram_chat_id",
    "telegram_message_id",
    "sent_to_agent_phone",
    "sent_at",
    "notes",
    "draft_message",
    "renter_name"
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (!fields.length) return getReLead(db, id);
  fields.push("updated_at = ?");
  params.push(now, id);
  db.prepare(`UPDATE re_leads SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getReLead(db, id);
}

function formatSavedSearchRow(r) {
  if (!r) return null;
  return { ...r, criteria: parseJson(r.criteria_json, {}), active: Boolean(r.active) };
}

export function createSavedSearch(db, { userPhone, criteria = {}, label = "" } = {}) {
  const phone = normalizeRePhone(userPhone);
  if (!phone) throw new Error("Phone required for saved search");
  const now = Date.now();
  const id = randomUUID();
  const autoLabel =
    label ||
    [
      criteria.transaction_type,
      criteria.community || criteria.emirates?.[0],
      criteria.beds != null ? `${criteria.beds}BR` : "",
      criteria.max_price ? `≤AED ${criteria.max_price}` : ""
    ]
      .filter(Boolean)
      .join(" · ") ||
    "Property alert";
  db.prepare(`
    INSERT INTO re_saved_searches (id, user_phone, label, criteria_json, active, last_notified_at, last_match_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, NULL, 0, ?, ?)
  `).run(id, phone, autoLabel, JSON.stringify(criteria || {}), now, now);
  return formatSavedSearchRow(db.prepare(`SELECT * FROM re_saved_searches WHERE id = ?`).get(id));
}

export function listSavedSearches(db, userPhone, { activeOnly = true } = {}) {
  const phone = normalizeRePhone(userPhone);
  const sql = activeOnly
    ? `SELECT * FROM re_saved_searches WHERE user_phone = ? AND active = 1 ORDER BY updated_at DESC`
    : `SELECT * FROM re_saved_searches WHERE user_phone = ? ORDER BY updated_at DESC`;
  return db.prepare(sql).all(phone).map(formatSavedSearchRow);
}

export function listActiveSavedSearches(db, limit = 200) {
  return db
    .prepare(`SELECT * FROM re_saved_searches WHERE active = 1 ORDER BY updated_at DESC LIMIT ?`)
    .all(Math.min(Math.max(Number(limit) || 200, 1), 500))
    .map(formatSavedSearchRow);
}

export function deactivateSavedSearch(db, id, userPhone = "") {
  const phone = normalizeRePhone(userPhone);
  const now = Date.now();
  if (phone) {
    db.prepare(`UPDATE re_saved_searches SET active = 0, updated_at = ? WHERE id = ? AND user_phone = ?`).run(now, id, phone);
  } else {
    db.prepare(`UPDATE re_saved_searches SET active = 0, updated_at = ? WHERE id = ?`).run(now, id);
  }
  return formatSavedSearchRow(db.prepare(`SELECT * FROM re_saved_searches WHERE id = ?`).get(id));
}

export function deactivateAllSavedSearches(db, userPhone) {
  const phone = normalizeRePhone(userPhone);
  const now = Date.now();
  db.prepare(`UPDATE re_saved_searches SET active = 0, updated_at = ? WHERE user_phone = ? AND active = 1`).run(now, phone);
  return db.prepare(`SELECT changes()`).get()?.["changes()"] || 0;
}

export function touchSavedSearchNotification(db, id, matchCount = 0) {
  const now = Date.now();
  db.prepare(`
    UPDATE re_saved_searches SET last_notified_at = ?, last_match_count = ?, updated_at = ? WHERE id = ?
  `).run(now, Number(matchCount) || 0, now, id);
}

export function upsertKnowledge(db, { slug, title, category, body, tags = [] }) {
  const now = Date.now();
  const existing = db.prepare(`SELECT id FROM re_knowledge WHERE slug = ?`).get(slug);
  if (existing) {
    db.prepare(`
      UPDATE re_knowledge SET title = ?, category = ?, body = ?, tags_json = ?, updated_at = ?, active = 1
      WHERE slug = ?
    `).run(title, category, body, JSON.stringify(tags), now, slug);
    return db.prepare(`SELECT * FROM re_knowledge WHERE slug = ?`).get(slug);
  }
  db.prepare(`
    INSERT INTO re_knowledge (slug, title, category, body, tags_json, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(slug, title, category, body, JSON.stringify(tags), now, now);
  return db.prepare(`SELECT * FROM re_knowledge WHERE slug = ?`).get(slug);
}

export function searchKnowledge(db, query, limit = 5) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    return db
      .prepare(`SELECT * FROM re_knowledge WHERE active = 1 ORDER BY updated_at DESC LIMIT ?`)
      .all(limit);
  }
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const rows = db.prepare(`SELECT * FROM re_knowledge WHERE active = 1`).all();
  const scored = rows
    .map((row) => {
      const hay = `${row.title} ${row.category} ${row.body} ${row.tags_json}`.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (hay.includes(w)) score += 1;
      }
      return { row, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.row);
  return scored.length ? scored : rows.slice(0, limit);
}

export function formatListingsForPrompt(listings = []) {
  if (!listings.length) return "";
  const lines = listings.slice(0, 8).map((l, i) => {
    const currency = isGhanaMarket() ? "GH₵" : "AED";
    const period = l.price_period || (l.transaction_type === "rent" ? (isGhanaMarket() ? "month" : "year") : "total");
    const price =
      l.transaction_type === "rent" ? `${currency} ${l.price_aed}/${period}` : `${currency} ${l.price_aed}`;
    const amenities = (l.amenities || []).slice(0, 8).join(", ");
    const specs = [
      l.beds != null ? `${l.beds} bed` : null,
      l.baths != null ? `${l.baths} bath` : null,
      l.furnished === true ? "furnished" : l.furnished === false ? "unfurnished" : null
    ]
      .filter(Boolean)
      .join(", ");
    const cluster = Number(l.other_agent_count || 0)
      ? ` · also listed by ${l.other_agent_count} other agents (same unit, this offer)`
      : "";
    return `${i + 1}. ${l.beds || "?"}BR ${l.property_type || "home"} in ${l.community || l.emirate} (${l.emirate}) — ${price}${specs ? ` · ${specs}` : ""}${amenities ? ` · Amenities: ${amenities}` : ""}${cluster} · id=${l.id}`;
  });
  return ["Properties for this search (cards show in app):", ...lines].join("\n");
}

export function startScrapeRun(db, { source, emirate = "", transaction_type = "" }) {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO re_scrape_runs (id, source, emirate, transaction_type, started_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, source, emirate, transaction_type, now);
  return id;
}

export function finishScrapeRun(db, id, { listings_found = 0, listings_upserted = 0, errors = [] } = {}) {
  db.prepare(`
    UPDATE re_scrape_runs SET
      listings_found = ?, listings_upserted = ?, errors_json = ?, finished_at = ?
    WHERE id = ?
  `).run(listings_found, listings_upserted, JSON.stringify(errors), Date.now(), id);
}

export function markStaleListings(db, olderThanMs = 72 * 60 * 60 * 1000) {
  const cutoff = Date.now() - olderThanMs;
  const r = db
    .prepare(`UPDATE re_listings SET is_active = 0, updated_at = ? WHERE scraped_at < ? AND is_active = 1`)
    .run(Date.now(), cutoff);
  return r.changes || 0;
}

export function deleteDemoListings(db) {
  const seed = db.prepare(`DELETE FROM re_listings WHERE source = 'seed'`).run();
  const generated = db.prepare(`DELETE FROM re_listings WHERE external_id LIKE 'gen-%'`).run();
  return {
    seed: seed.changes || 0,
    generated: generated.changes || 0,
    total: (seed.changes || 0) + (generated.changes || 0)
  };
}

export function deleteInactiveListings(db) {
  const r = db.prepare(`DELETE FROM re_listings WHERE is_active = 0`).run();
  return r.changes || 0;
}
