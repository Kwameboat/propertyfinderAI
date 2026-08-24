/**
 * Platform WhatsApp tenants — clients without WABA routed via agency Meta line.
 */

import { slugifyPlatform, validatePlatformSlug } from "../platform-slug.mjs";

const SESSION_TTL_MS = Number(process.env.JAB_PLATFORM_SESSION_TTL_MS || 72 * 60 * 60 * 1000);
const INBOUND_CLAIM_TTL_MS = Number(process.env.JAB_HUB_DEDUPE_TTL_MS || 180000);

function slugify(value) {
  return slugifyPlatform(value);
}

export function migratePlatformTenant(db) {
  const clientCols = db.prepare(`PRAGMA table_info(clients)`).all().map((c) => c.name);
  if (!clientCols.includes("platform_whatsapp_enabled")) {
    db.exec(`ALTER TABLE clients ADD COLUMN platform_whatsapp_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!clientCols.includes("platform_slug")) {
    db.exec(`ALTER TABLE clients ADD COLUMN platform_slug TEXT`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_tenant_sessions (
      agency_instance TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      tenant_instance_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (agency_instance, customer_phone)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_sessions_tenant ON platform_tenant_sessions(tenant_instance_name);
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_platform_slug
    ON clients(platform_slug) WHERE platform_slug IS NOT NULL AND platform_slug != ''
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_inbound_claims (
      claim_key TEXT PRIMARY KEY,
      claimed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_platform_inbound_claims_at ON platform_inbound_claims(claimed_at);
  `);
}

export function listPlatformTenants(db, { agencyInstanceName = null } = {}) {
  const agency = String(agencyInstanceName || "").trim();
  const rows = db
    .prepare(
      `SELECT * FROM clients
       WHERE platform_whatsapp_enabled = 1
         AND (platform_slug IS NOT NULL AND TRIM(platform_slug) != '')
       ORDER BY display_name COLLATE NOCASE, instance_name COLLATE NOCASE`
    )
    .all();
  return rows.filter((r) => !agency || r.instance_name !== agency);
}

export function getPlatformTenantBySlug(db, slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return null;
  return db
    .prepare(
      `SELECT * FROM clients
       WHERE platform_whatsapp_enabled = 1 AND LOWER(platform_slug) = ?
       LIMIT 1`
    )
    .get(s);
}

export function resolvePlatformSlugForClient(client) {
  const explicit = String(client?.platform_slug || "").trim().toLowerCase();
  if (explicit) return explicit;
  const store = String(client?.store_slug || "").trim().toLowerCase();
  if (store) return store;
  return slugify(client?.display_name || client?.instance_name || "");
}

export function getPlatformTenantSession(db, agencyInstance, customerPhone) {
  const phone = String(customerPhone || "").replace(/\D/g, "");
  if (!agencyInstance || !phone) return null;
  const row = db
    .prepare(
      `SELECT * FROM platform_tenant_sessions
       WHERE agency_instance = ? AND customer_phone = ?`
    )
    .get(agencyInstance, phone);
  if (!row) return null;
  if (Date.now() - Number(row.updated_at || 0) > SESSION_TTL_MS) {
    clearPlatformTenantSession(db, agencyInstance, phone);
    return null;
  }
  const client = db.prepare(`SELECT * FROM clients WHERE instance_name = ?`).get(row.tenant_instance_name);
  if (!client || !Number(client.platform_whatsapp_enabled)) {
    clearPlatformTenantSession(db, agencyInstance, phone);
    return null;
  }
  return client;
}

export function setPlatformTenantSession(db, agencyInstance, customerPhone, tenantInstanceName) {
  const phone = String(customerPhone || "").replace(/\D/g, "");
  const tenant = String(tenantInstanceName || "").trim();
  if (!agencyInstance || !phone || !tenant) return null;
  const now = Date.now();
  db.prepare(
    `INSERT INTO platform_tenant_sessions (agency_instance, customer_phone, tenant_instance_name, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(agency_instance, customer_phone) DO UPDATE SET
       tenant_instance_name = excluded.tenant_instance_name,
       updated_at = excluded.updated_at`
  ).run(agencyInstance, phone, tenant, now);
  return getPlatformTenantSession(db, agencyInstance, phone);
}

export function clearPlatformTenantSession(db, agencyInstance, customerPhone) {
  const phone = String(customerPhone || "").replace(/\D/g, "");
  if (!agencyInstance || !phone) return;
  db.prepare(
    `DELETE FROM platform_tenant_sessions WHERE agency_instance = ? AND customer_phone = ?`
  ).run(agencyInstance, phone);
}

export function ensurePlatformSlug(db, instanceName) {
  const client = db.prepare(`SELECT * FROM clients WHERE instance_name = ?`).get(instanceName);
  if (!client) return null;
  let slug = resolvePlatformSlugForClient(client);
  const validated = validatePlatformSlug(slug);
  if (!validated.ok) slug = slugify(client?.display_name || instanceName);
  if (!slug) slug = slugify(instanceName);
  let candidate = slug;
  let n = 2;
  while (true) {
    const clash = db
      .prepare(
        `SELECT instance_name FROM clients
         WHERE platform_slug = ? AND instance_name != ? LIMIT 1`
      )
      .get(candidate, instanceName);
    if (!clash) break;
    candidate = `${slug}-${n}`;
    n += 1;
  }
  if (candidate !== client.platform_slug) {
    db.prepare(`UPDATE clients SET platform_slug = ?, updated_at = ? WHERE instance_name = ?`).run(
      candidate,
      Date.now(),
      instanceName
    );
  }
  return candidate;
}

/** Deduplicate inbound WhatsApp message ids across bridge restarts. */
export function claimPlatformInboundMessage(db, instance, messageId) {
  if (!messageId) return true;
  const key = `${String(instance || "").trim()}:${String(messageId || "").trim()}`;
  if (!key || key === ":") return true;
  const now = Date.now();
  const cutoff = now - INBOUND_CLAIM_TTL_MS;
  db.prepare(`DELETE FROM platform_inbound_claims WHERE claimed_at < ?`).run(cutoff);
  try {
    db.prepare(`INSERT INTO platform_inbound_claims (claim_key, claimed_at) VALUES (?, ?)`).run(key, now);
    return true;
  } catch {
    return false;
  }
}

export function buildPlatformWaLink({ agencyPhoneDigits, slug, displayName = "" }) {
  const digits = String(agencyPhoneDigits || "").replace(/\D/g, "");
  if (!digits) return "";
  const name = String(displayName || slug || "shop").trim();
  const text = slug ? `Hi ${name} ref:${slug}` : `Hi ${name}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
