import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { migrateBilling, grantSignupBonus, ensureClientBillingEmail, applyPendingProspectPayments } from "./billing.mjs";
import { migrateMarketing } from "./marketing.mjs";
import { migrateAgentsFeatures } from "./agents-features.mjs";
import { migrateSocial } from "./social.mjs";
import { migratePa } from "./pa.mjs";
import { migrateRealEstate } from "./real-estate.mjs";
import {
  migratePlatformTenant,
  listPlatformTenants,
  getPlatformTenantBySlug,
  getPlatformTenantSession,
  setPlatformTenantSession,
  clearPlatformTenantSession,
  resolvePlatformSlugForClient,
  ensurePlatformSlug,
  buildPlatformWaLink,
  claimPlatformInboundMessage
} from "./platform-tenant.mjs";

export {
  RATE_KEYS,
  defaultAgencyInstanceName,
  resolveAgencyInstanceName,
  isAgencyInstance,
  getAgencySettings,
  updateAgencySettings,
  listPointPackages,
  getPointPackage,
  createPointPackage,
  updatePointPackage,
  deletePointPackage,
  getPointRates,
  setPointRates,
  ensureWallet,
  getWallet,
  listWallets,
  applyWalletDelta,
  listLedger,
  markLowBalanceNotified,
  createPaystackPayment,
  getPaystackPayment,
  getPaystackPaymentByReference,
  listPaystackPayments,
  completePaystackPayment,
  getLatestOpenPaymentForProspect,
  applyPendingProspectPayments,
  findClientByProspectPhone,
  failPaystackPayment,
  packageTotalPoints,
  ensureSetupTrialPackage,
  formatPackagesForAgent,
  isValidBillingEmail,
  isPaystackBillingEmail,
  derivePaystackBillingEmail,
  resolvePaystackBillingEmail,
  ensureClientBillingEmail,
  backfillClientBillingEmails,
  rateKeyForAiUsage,
  rateKeyForCampaignPart,
  pointsForRate,
  expirePeriodIfNeeded,
  creditFromPackage,
  grantSignupBonus
} from "./billing.mjs";

export {
  normalizeGhanaPhone,
  extractWhatsappPhoneFromText,
  makeLeadFingerprint,
  addMarketingEvent,
  getMarketingLead,
  getMarketingLeadByFingerprint,
  getMarketingLeadByPhone,
  listMarketingLeads,
  countMarketingSendsToday,
  wasPhoneContactedRecently,
  upsertMarketingLead,
  updateMarketingLead,
  claimMarketingLeadAction,
  approveMarketingLead,
  markMarketingLeadSent,
  markMarketingLeadSkipped,
  markMarketingLeadBlocked,
  markMarketingLeadReplied,
  scheduleFollowUpJob,
  claimDueFollowUpJobs,
  completeFollowUpJob,
  cancelFollowUpsForLead,
  cancelFollowUpsForPhone,
  getMarketingStats
} from "./marketing.mjs";

export {
  listKnowledgeDocs,
  upsertKnowledgeDoc,
  deleteKnowledgeDoc,
  formatKnowledgeForAgent,
  addConversationMessage,
  listInboxThreads,
  listConversationMessages,
  createBooking,
  listBookings,
  getBooking,
  updateBookingStatus,
  createCustomerPayment,
  getCustomerPaymentByReference,
  markCustomerPaymentPaid,
  buildOwnerDigestText,
  ensureOwnerDigestJobs
} from "./agents-features.mjs";

export {
  listPlatformTenants,
  getPlatformTenantBySlug,
  getPlatformTenantSession,
  setPlatformTenantSession,
  clearPlatformTenantSession,
  resolvePlatformSlugForClient,
  ensurePlatformSlug,
  buildPlatformWaLink,
  claimPlatformInboundMessage
} from "./platform-tenant.mjs";

export {
  SOCIAL_PLATFORMS,
  listSocialAccounts,
  getSocialAccount,
  upsertSocialAccount,
  disconnectSocialAccount,
  connectedPlatforms,
  createSocialPost,
  getSocialPost,
  listSocialPosts,
  updateSocialPost,
  addSocialEvent,
  getSocialStats,
  encryptSocialToken,
  decryptSocialToken
} from "./social.mjs";

export {
  addPaEvent,
  addPaMessage,
  listPaMessages,
  upsertPaMemory,
  listPaMemories,
  searchPaMemories,
  deletePaMemory,
  createPaTask,
  listPaTasks,
  getPaTask,
  completePaTask,
  cancelPaTask,
  claimDuePaReminders,
  createPaDoc,
  listPaDocs,
  deactivatePaDoc,
  replacePaChunks,
  listPaChunks,
  getPaSettings,
  updatePaSettings,
  getPaStats
} from "./pa.mjs";

const DEFAULT_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || process.cwd(),
  ".openclaw",
  "jab-hub"
);

export function getHubPaths(baseDir = process.env.JAB_HUB_DATA_DIR || DEFAULT_DIR) {
  return {
    baseDir,
    dbPath: path.join(baseDir, "hub.db"),
    uploadsDir: path.join(baseDir, "uploads"),
    socialDir: path.join(baseDir, "social"),
    paDir: path.join(baseDir, "pa")
  };
}

let singleton = null;

export function openHubDb(baseDir) {
  if (singleton) return singleton;
  const { dbPath, uploadsDir, baseDir: dir, socialDir, paDir } = getHubPaths(baseDir);
  mkdirSync(dir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
  mkdirSync(socialDir, { recursive: true });
  mkdirSync(paDir, { recursive: true });
  mkdirSync(path.join(paDir, "docs"), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 8000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  singleton = { db, paths: getHubPaths(baseDir) };
  return singleton;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      instance_name TEXT PRIMARY KEY,
      display_name TEXT,
      status TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      push_name TEXT,
      notes TEXT DEFAULT '',
      opted_out INTEGER NOT NULL DEFAULT 0,
      last_inbound_at INTEGER,
      last_outbound_at INTEGER,
      last_inbound_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(instance_name, phone)
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_instance ON contacts(instance_name);
    CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      parts_json TEXT NOT NULL DEFAULT '[]',
      delay_ms INTEGER NOT NULL DEFAULT 4000,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_campaigns_instance ON campaigns(instance_name);

    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      sent_at INTEGER,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
      UNIQUE(campaign_id, contact_id)
    );

    CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);

    CREATE TABLE IF NOT EXISTS sales_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_instance ON sales_agents(instance_name);

    CREATE TABLE IF NOT EXISTS lead_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      contact_id INTEGER NOT NULL,
      agent_id INTEGER,
      status TEXT NOT NULL DEFAULT 'unassigned',
      reason TEXT,
      summary TEXT,
      last_customer_message TEXT,
      created_at INTEGER NOT NULL,
      assigned_at INTEGER,
      closed_at INTEGER,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES sales_agents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leads_instance ON lead_assignments(instance_name);
    CREATE INDEX IF NOT EXISTS idx_leads_agent ON lead_assignments(agent_id);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON lead_assignments(status);

    CREATE TABLE IF NOT EXISTS store_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      name TEXT NOT NULL,
      sku TEXT,
      description TEXT DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'GHS',
      stock INTEGER,
      image_path TEXT,
      images_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_instance ON store_products(instance_name);
  `);

  // Additive columns for existing DBs
  const clientCols = db.prepare(`PRAGMA table_info(clients)`).all().map((c) => c.name);
  if (!clientCols.includes("lead_distribution")) {
    db.exec(`ALTER TABLE clients ADD COLUMN lead_distribution TEXT NOT NULL DEFAULT 'auto'`);
  }
  if (!clientCols.includes("handoff_keywords")) {
    db.exec(
      `ALTER TABLE clients ADD COLUMN handoff_keywords TEXT NOT NULL DEFAULT 'human,agent,speak to someone,talk to someone,call me,representative'`
    );
  }
  if (!clientCols.includes("store_slug")) {
    db.exec(`ALTER TABLE clients ADD COLUMN store_slug TEXT`);
  }
  if (!clientCols.includes("store_token")) {
    db.exec(`ALTER TABLE clients ADD COLUMN store_token TEXT`);
  }
  if (!clientCols.includes("store_tagline")) {
    db.exec(`ALTER TABLE clients ADD COLUMN store_tagline TEXT`);
  }
  if (!clientCols.includes("whatsapp_order_number")) {
    db.exec(`ALTER TABLE clients ADD COLUMN whatsapp_order_number TEXT`);
  }
  if (!clientCols.includes("contact_email")) {
    db.exec(`ALTER TABLE clients ADD COLUMN contact_email TEXT`);
  }
  if (!clientCols.includes("contact_phone")) {
    db.exec(`ALTER TABLE clients ADD COLUMN contact_phone TEXT`);
  }
  if (!clientCols.includes("onboarded_at")) {
    db.exec(`ALTER TABLE clients ADD COLUMN onboarded_at INTEGER`);
  }
  if (!clientCols.includes("shop_address")) {
    db.exec(`ALTER TABLE clients ADD COLUMN shop_address TEXT`);
  }
  if (!clientCols.includes("shop_lat")) {
    db.exec(`ALTER TABLE clients ADD COLUMN shop_lat REAL`);
  }
  if (!clientCols.includes("shop_lng")) {
    db.exec(`ALTER TABLE clients ADD COLUMN shop_lng REAL`);
  }
  if (!clientCols.includes("system_prompt")) {
    db.exec(`ALTER TABLE clients ADD COLUMN system_prompt TEXT`);
  }
  if (!clientCols.includes("admin_phones")) {
    db.exec(`ALTER TABLE clients ADD COLUMN admin_phones TEXT`);
  }
  if (!clientCols.includes("deals_json")) {
    db.exec(`ALTER TABLE clients ADD COLUMN deals_json TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!clientCols.includes("agent_type")) {
    db.exec(`ALTER TABLE clients ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'store'`);
  }
  if (!clientCols.includes("booking_url")) {
    db.exec(`ALTER TABLE clients ADD COLUMN booking_url TEXT`);
  }

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_store_slug ON clients(store_slug) WHERE store_slug IS NOT NULL`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_store_token ON clients(store_token) WHERE store_token IS NOT NULL`);

  const contactCols = db.prepare(`PRAGMA table_info(contacts)`).all().map((c) => c.name);
  if (!contactCols.includes("handoff_status")) {
    db.exec(`ALTER TABLE contacts ADD COLUMN handoff_status TEXT NOT NULL DEFAULT 'ai'`);
  }
  if (!contactCols.includes("qualification_score")) {
    db.exec(`ALTER TABLE contacts ADD COLUMN qualification_score INTEGER NOT NULL DEFAULT 0`);
  }
  if (!contactCols.includes("qualification_summary")) {
    db.exec(`ALTER TABLE contacts ADD COLUMN qualification_summary TEXT`);
  }
  if (!contactCols.includes("score_notified_at")) {
    db.exec(`ALTER TABLE contacts ADD COLUMN score_notified_at INTEGER`);
  }

  const productCols = db.prepare(`PRAGMA table_info(store_products)`).all().map((c) => c.name);
  if (!productCols.includes("images_json")) {
    db.exec(`ALTER TABLE store_products ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]'`);
    // Backfill single image_path into images_json
    const rows = db.prepare(`SELECT id, image_path FROM store_products WHERE image_path IS NOT NULL AND image_path != ''`).all();
    const upd = db.prepare(`UPDATE store_products SET images_json = ? WHERE id = ?`);
    for (const row of rows) {
      upd.run(JSON.stringify([row.image_path]), row.id);
    }
  }

  migrateBilling(db);
  migrateMarketing(db);
  migrateAgentsFeatures(db);
  migrateSocial(db);
  migratePa(db);
  migrateRealEstate(db);
  migratePlatformTenant(db);
}

export {
  UAE_EMIRATES,
  TRANSACTION_TYPES,
  upsertListing,
  getListing,
  searchListings,
  countActiveListings,
  countListingsBySource,
  createSession,
  getSession,
  updateSession,
  createLead,
  getReLead,
  listLeadsByStatus,
  updateLead,
  upsertKnowledge,
  searchKnowledge,
  formatListingsForPrompt,
  startScrapeRun,
  finishScrapeRun,
  markStaleListings,
  deleteDemoListings,
  deleteInactiveListings
} from "./real-estate.mjs";

export function upsertClient(db, { instanceName, displayName = null, status = null, leadDistribution = undefined }) {
  const now = Date.now();
  const existing = db.prepare(`SELECT * FROM clients WHERE instance_name = ?`).get(instanceName);
  if (!existing) {
    db.prepare(`
      INSERT INTO clients (instance_name, display_name, status, lead_distribution, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      instanceName,
      displayName || instanceName,
      status,
      leadDistribution === "manual" ? "manual" : "auto",
      now
    );
  } else {
    db.prepare(`
      UPDATE clients SET
        display_name = COALESCE(?, display_name),
        status = COALESCE(?, status),
        lead_distribution = COALESCE(?, lead_distribution),
        updated_at = ?
      WHERE instance_name = ?
    `).run(
      displayName,
      status,
      leadDistribution === undefined ? null : leadDistribution === "manual" ? "manual" : "auto",
      now,
      instanceName
    );
  }
  ensureClientBillingEmail(db, instanceName);
}

export function getClient(db, instanceName) {
  return db.prepare(`SELECT * FROM clients WHERE instance_name = ?`).get(instanceName);
}

export function updateClientSettings(
  db,
  instanceName,
  {
    leadDistribution,
    handoffKeywords,
    displayName,
    storeTagline,
    whatsappOrderNumber,
    contactEmail,
    contactPhone,
    shopAddress,
    shopLat,
    shopLng,
    systemPrompt,
    adminPhones
  }
) {
  const existing = getClient(db, instanceName);
  if (!existing) return null;
  // system_prompt / admin_phones: undefined = leave as-is; "" = clear.
  const systemPromptValue =
    systemPrompt === undefined ? undefined : String(systemPrompt).trim() || null;
  const adminPhonesValue =
    adminPhones === undefined
      ? undefined
      : String(adminPhones)
          .split(/[,;\s]+/)
          .map((p) => p.replace(/\D/g, ""))
          .filter(Boolean)
          .join(",") || null;
  db.prepare(`
    UPDATE clients SET
      lead_distribution = COALESCE(?, lead_distribution),
      handoff_keywords = COALESCE(?, handoff_keywords),
      display_name = COALESCE(?, display_name),
      store_tagline = COALESCE(?, store_tagline),
      whatsapp_order_number = COALESCE(?, whatsapp_order_number),
      contact_email = COALESCE(?, contact_email),
      contact_phone = COALESCE(?, contact_phone),
      system_prompt = CASE WHEN ? THEN ? ELSE system_prompt END,
      admin_phones = CASE WHEN ? THEN ? ELSE admin_phones END,
      updated_at = ?
    WHERE instance_name = ?
  `).run(
    leadDistribution === undefined ? null : leadDistribution === "manual" ? "manual" : "auto",
    handoffKeywords === undefined ? null : String(handoffKeywords),
    displayName === undefined ? null : displayName,
    storeTagline === undefined ? null : storeTagline,
    whatsappOrderNumber === undefined ? null : String(whatsappOrderNumber).replace(/\D/g, ""),
    contactEmail === undefined ? null : contactEmail,
    contactPhone === undefined ? null : contactPhone,
    systemPrompt === undefined ? 0 : 1,
    systemPromptValue ?? null,
    adminPhones === undefined ? 0 : 1,
    adminPhonesValue ?? null,
    Date.now(),
    instanceName
  );

  if (shopAddress !== undefined || shopLat !== undefined || shopLng !== undefined) {
    updateShopLocation(db, instanceName, {
      shopAddress: shopAddress === undefined ? existing.shop_address : shopAddress,
      shopLat: shopLat === undefined ? existing.shop_lat : shopLat,
      shopLng: shopLng === undefined ? existing.shop_lng : shopLng
    });
  }

  return getClient(db, instanceName);
}

/** Always overwrites shop pickup location fields (used for Yango fee quotes). */
export function updateShopLocation(db, instanceName, { shopAddress = null, shopLat = null, shopLng = null }) {
  const existing = getClient(db, instanceName);
  if (!existing) return null;
  const lat =
    shopLat === null || shopLat === undefined || shopLat === "" || Number.isNaN(Number(shopLat))
      ? null
      : Number(shopLat);
  const lng =
    shopLng === null || shopLng === undefined || shopLng === "" || Number.isNaN(Number(shopLng))
      ? null
      : Number(shopLng);
  db.prepare(`
    UPDATE clients SET
      shop_address = ?,
      shop_lat = ?,
      shop_lng = ?,
      updated_at = ?
    WHERE instance_name = ?
  `).run(
    shopAddress ? String(shopAddress).trim() : null,
    lat,
    lng,
    Date.now(),
    instanceName
  );
  return getClient(db, instanceName);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "store";
}

function uniqueStoreSlug(db, base) {
  let slug = slugify(base);
  let n = 0;
  while (db.prepare(`SELECT 1 FROM clients WHERE store_slug = ?`).get(slug)) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

function makeStoreToken() {
  return createHash("sha256")
    .update(`${Date.now()}:${Math.random()}:${process.hrtime.bigint()}`)
    .digest("hex")
    .slice(0, 32);
}

const AGENT_TYPES = new Set(["store", "pa", "customer_service", "booking"]);

export function normalizeAgentType(value) {
  const t = String(value || "store")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (t === "personal_assistant" || t === "assistant") return "pa";
  if (t === "cs" || t === "customer_service_agent" || t === "support") return "customer_service";
  if (t === "booking_agent" || t === "appointments") return "booking";
  return AGENT_TYPES.has(t) ? t : "store";
}

/** Starter WhatsApp personas for non-blank onboarding prompts. */
export function buildOnboardSystemPrompt({
  agentType = "store",
  displayName = "",
  bookingUrl = "",
  customPrompt = ""
} = {}) {
  const custom = String(customPrompt || "").trim();
  if (custom) return custom;
  const name = String(displayName || "the business").trim() || "the business";
  const type = normalizeAgentType(agentType);
  const bookingLine = String(bookingUrl || "").trim()
    ? `\n- Booking link to share when useful: ${String(bookingUrl).trim()}`
    : "";

  if (type === "pa") {
    return [
      `You are the personal WhatsApp assistant for ${name}.`,
      "Chat like a sharp, friendly PA on WhatsApp — short, clear, proactive.",
      "Help with schedules, reminders, messages, follow-ups, and light research.",
      "Do not invent meetings, promises, or private facts. If unsure, ask one short question.",
      "If they ask for a human or something outside your scope, say so briefly and use [HANDOFF] when a person must take over."
    ].join("\n");
  }
  if (type === "customer_service") {
    return [
      `You are WhatsApp customer service for ${name}.`,
      "Be calm, helpful, and concise. Solve issues step by step.",
      "Ask at most one clarifying question per reply.",
      "Do not invent policies, refunds, or order status you do not know — ask for the needed detail or hand off.",
      "If they ask for a human, escalate with [HANDOFF]."
    ].join("\n");
  }
  if (type === "booking") {
    return [
      `You are the booking assistant for ${name} on WhatsApp.`,
      "Help customers check availability, choose a service/time, and complete a booking.",
      "Confirm date, time, service, and customer name/phone before finalizing.",
      "Do not invent open slots — if availability is unclear, ask one question or hand off.",
      bookingLine.trim() || "- If a booking link exists later, share it when they are ready to book.",
      "Use [HANDOFF] when they need a human to confirm or change a booking."
    ]
      .filter(Boolean)
      .join("\n");
  }
  // store: leave blank so bridge uses default COD catalog mode unless Team sets a persona
  return "";
}

/** Onboard or refresh a client: store types get storefront links; others get persona only. */
export function onboardClientStore(
  db,
  {
    instanceName,
    displayName,
    agentType = "store",
    storeTagline = "",
    whatsappOrderNumber = "",
    contactEmail = "",
    contactPhone = "",
    shopAddress = "",
    shopLat = null,
    shopLng = null,
    bookingUrl = "",
    systemPrompt = undefined,
    leadDistribution = "auto",
    regenerateToken = false
  }
) {
  const now = Date.now();
  const type = normalizeAgentType(agentType);
  upsertClient(db, {
    instanceName,
    displayName: displayName || instanceName,
    leadDistribution
  });

  let client = getClient(db, instanceName);
  const isFirstOnboard = !client?.onboarded_at;
  const isStore = type === "store";

  let slug = client.store_slug || null;
  let token = client.store_token || null;
  if (isStore) {
    if (!slug) slug = uniqueStoreSlug(db, displayName || instanceName);
    if (!token || regenerateToken) token = makeStoreToken();
  }

  const seededPrompt =
    systemPrompt === undefined
      ? buildOnboardSystemPrompt({
          agentType: type,
          displayName: displayName || client.display_name,
          bookingUrl,
          customPrompt: ""
        })
      : String(systemPrompt || "").trim();

  const shouldSetPrompt =
    systemPrompt !== undefined ||
    (seededPrompt && (!client.system_prompt || isFirstOnboard));

  db.prepare(`
    UPDATE clients SET
      display_name = COALESCE(?, display_name),
      agent_type = ?,
      store_slug = ?,
      store_token = ?,
      store_tagline = COALESCE(?, store_tagline),
      whatsapp_order_number = COALESCE(?, whatsapp_order_number),
      contact_email = COALESCE(?, contact_email),
      contact_phone = COALESCE(?, contact_phone),
      shop_address = COALESCE(?, shop_address),
      shop_lat = COALESCE(?, shop_lat),
      shop_lng = COALESCE(?, shop_lng),
      booking_url = COALESCE(?, booking_url),
      system_prompt = CASE WHEN ? THEN ? ELSE system_prompt END,
      lead_distribution = COALESCE(?, lead_distribution),
      onboarded_at = COALESCE(onboarded_at, ?),
      updated_at = ?
    WHERE instance_name = ?
  `).run(
    displayName || null,
    type,
    isStore ? slug : null,
    isStore ? token : null,
    isStore ? storeTagline || null : null,
    whatsappOrderNumber ? String(whatsappOrderNumber).replace(/\D/g, "") : null,
    contactEmail || null,
    contactPhone || null,
    isStore
      ? shopAddress
        ? String(shopAddress).trim()
        : null
      : null,
    isStore
      ? shopLat === null || shopLat === undefined || shopLat === ""
        ? null
        : Number(shopLat)
      : null,
    isStore
      ? shopLng === null || shopLng === undefined || shopLng === ""
        ? null
        : Number(shopLng)
      : null,
    String(bookingUrl || "").trim() || null,
    shouldSetPrompt ? 1 : 0,
    shouldSetPrompt ? seededPrompt || null : null,
    leadDistribution === "manual" ? "manual" : "auto",
    now,
    now,
    instanceName
  );

  if (isFirstOnboard) {
    try {
      grantSignupBonus(db, instanceName);
    } catch (error) {
      console.error(
        JSON.stringify({ at: new Date().toISOString(), signupBonusError: error.message, instanceName })
      );
    }
  }

  ensureClientBillingEmail(db, instanceName);

  if (contactPhone) {
    try {
      applyPendingProspectPayments(db, contactPhone);
    } catch (error) {
      console.error(
        JSON.stringify({ at: new Date().toISOString(), pendingPaymentError: error.message, instanceName })
      );
    }
  }

  return getClient(db, instanceName);
}

export function getClientByStoreSlug(db, slug) {
  return db.prepare(`SELECT * FROM clients WHERE store_slug = ?`).get(slug);
}

export function getClientByStoreToken(db, token) {
  return db.prepare(`SELECT * FROM clients WHERE store_token = ?`).get(token);
}

export function ensureClientStoreLinks(db, instanceName) {
  const client = getClient(db, instanceName);
  if (!client) return null;
  if (client.store_slug && client.store_token) return client;
  return onboardClientStore(db, {
    instanceName,
    displayName: client.display_name || instanceName,
    agentType: "store",
    systemPrompt: client.system_prompt || ""
  });
}

export function listClients(db) {
  return db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM contacts ct WHERE ct.instance_name = c.instance_name) AS contact_count,
        (SELECT COUNT(*) FROM sales_agents sa WHERE sa.instance_name = c.instance_name AND sa.active = 1) AS agent_count,
        (SELECT COUNT(*) FROM lead_assignments la WHERE la.instance_name = c.instance_name AND la.status = 'unassigned') AS unassigned_count
       FROM clients c
       ORDER BY c.instance_name`
    )
    .all();
}

export function upsertContact(
  db,
  {
    instanceName,
    phone,
    pushName = null,
    lastInboundAt = null,
    lastOutboundAt = null,
    lastInboundText = null,
    notes = undefined,
    optedOut = undefined
  }
) {
  const now = Date.now();
  const existing = db
    .prepare(`SELECT * FROM contacts WHERE instance_name = ? AND phone = ?`)
    .get(instanceName, phone);

  if (!existing) {
    db.prepare(`
      INSERT INTO contacts (
        instance_name, phone, push_name, notes, opted_out,
        last_inbound_at, last_outbound_at, last_inbound_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      instanceName,
      phone,
      pushName || null,
      notes || "",
      optedOut ? 1 : 0,
      lastInboundAt,
      lastOutboundAt,
      lastInboundText ? String(lastInboundText).slice(0, 200) : null,
      now,
      now
    );
  } else {
    db.prepare(`
      UPDATE contacts SET
        push_name = COALESCE(?, push_name),
        notes = COALESCE(?, notes),
        opted_out = COALESCE(?, opted_out),
        last_inbound_at = COALESCE(?, last_inbound_at),
        last_outbound_at = COALESCE(?, last_outbound_at),
        last_inbound_text = COALESCE(?, last_inbound_text),
        updated_at = ?
      WHERE id = ?
    `).run(
      pushName,
      notes === undefined ? null : notes,
      optedOut === undefined ? null : optedOut ? 1 : 0,
      lastInboundAt,
      lastOutboundAt,
      lastInboundText ? String(lastInboundText).slice(0, 200) : null,
      now,
      existing.id
    );
  }

  return db
    .prepare(`SELECT * FROM contacts WHERE instance_name = ? AND phone = ?`)
    .get(instanceName, phone);
}

export function listContacts(db, instanceName, { q = "", includeOptedOut = true } = {}) {
  const term = `%${String(q || "").trim()}%`;
  if (includeOptedOut) {
    return db
      .prepare(
        `SELECT * FROM contacts
         WHERE instance_name = ?
           AND (phone LIKE ? OR IFNULL(push_name,'') LIKE ? OR IFNULL(notes,'') LIKE ?)
         ORDER BY COALESCE(last_inbound_at, updated_at) DESC`
      )
      .all(instanceName, term, term, term);
  }
  return db
    .prepare(
      `SELECT * FROM contacts
       WHERE instance_name = ? AND opted_out = 0
         AND (phone LIKE ? OR IFNULL(push_name,'') LIKE ? OR IFNULL(notes,'') LIKE ?)
       ORDER BY COALESCE(last_inbound_at, updated_at) DESC`
    )
    .all(instanceName, term, term, term);
}

export function getContact(db, id) {
  return db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
}

export function updateContact(
  db,
  id,
  { notes, optedOut, pushName, handoffStatus, qualificationScore, qualificationSummary, scoreNotifiedAt }
) {
  const existing = getContact(db, id);
  if (!existing) return null;
  db.prepare(`
    UPDATE contacts SET
      notes = COALESCE(?, notes),
      opted_out = COALESCE(?, opted_out),
      push_name = COALESCE(?, push_name),
      handoff_status = COALESCE(?, handoff_status),
      qualification_score = COALESCE(?, qualification_score),
      qualification_summary = COALESCE(?, qualification_summary),
      score_notified_at = COALESCE(?, score_notified_at),
      updated_at = ?
    WHERE id = ?
  `).run(
    notes === undefined ? null : notes,
    optedOut === undefined ? null : optedOut ? 1 : 0,
    pushName === undefined ? null : pushName,
    handoffStatus === undefined ? null : handoffStatus,
    qualificationScore === undefined ? null : Math.max(0, Math.min(100, Math.floor(Number(qualificationScore) || 0))),
    qualificationSummary === undefined ? null : qualificationSummary,
    scoreNotifiedAt === undefined ? null : scoreNotifiedAt,
    Date.now(),
    id
  );
  return getContact(db, id);
}

export function updateContactQualification(
  db,
  contactId,
  { score, summary, markScoreNotified = false } = {}
) {
  return updateContact(db, contactId, {
    qualificationScore: score,
    qualificationSummary: summary,
    scoreNotifiedAt: markScoreNotified ? Date.now() : undefined
  });
}

export function createContact(db, { instanceName, phone, pushName = null, notes = "" }) {
  return upsertContact(db, {
    instanceName,
    phone: String(phone).replace(/\D/g, ""),
    pushName,
    notes,
    lastInboundAt: null
  });
}

export function createCampaign(db, { instanceName, name, parts = [], delayMs = 4000, contactIds = [] }) {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO campaigns (instance_name, name, status, parts_json, delay_ms, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?)`
    )
    .run(instanceName, name, JSON.stringify(parts), delayMs, now, now);

  const campaignId = Number(result.lastInsertRowid);
  const insertRecipient = db.prepare(`
    INSERT OR IGNORE INTO campaign_recipients (campaign_id, contact_id, phone, status)
    VALUES (?, ?, ?, 'pending')
  `);

  for (const contactId of contactIds) {
    const contact = getContact(db, contactId);
    if (!contact || contact.instance_name !== instanceName) continue;
    if (contact.opted_out) continue;
    insertRecipient.run(campaignId, contact.id, contact.phone);
  }

  return getCampaign(db, campaignId);
}

export function getCampaign(db, id) {
  const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(id);
  if (!campaign) return null;
  const recipients = db
    .prepare(`SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY id`)
    .all(id);
  return {
    ...campaign,
    parts: JSON.parse(campaign.parts_json || "[]"),
    recipients,
    stats: {
      total: recipients.length,
      pending: recipients.filter((r) => r.status === "pending").length,
      sent: recipients.filter((r) => r.status === "sent").length,
      failed: recipients.filter((r) => r.status === "failed").length,
      skipped: recipients.filter((r) => r.status === "skipped").length
    }
  };
}

export function listCampaigns(db, instanceName) {
  return db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id) AS recipient_count,
        (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') AS sent_count
       FROM campaigns c
       WHERE c.instance_name = ?
       ORDER BY c.created_at DESC`
    )
    .all(instanceName)
    .map((row) => ({
      ...row,
      parts: JSON.parse(row.parts_json || "[]")
    }));
}

export function updateCampaignStatus(db, id, status) {
  const now = Date.now();
  const fields = { status, updated_at: now };
  if (status === "running") fields.started_at = now;
  if (status === "done" || status === "failed") fields.finished_at = now;

  db.prepare(
    `UPDATE campaigns SET
      status = ?,
      updated_at = ?,
      started_at = COALESCE(?, started_at),
      finished_at = COALESCE(?, finished_at)
     WHERE id = ?`
  ).run(status, now, fields.started_at || null, fields.finished_at || null, id);

  return getCampaign(db, id);
}

export function updateCampaignParts(db, id, parts) {
  db.prepare(`UPDATE campaigns SET parts_json = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(parts),
    Date.now(),
    id
  );
  return getCampaign(db, id);
}

export function claimNextRecipient(db, campaignId) {
  const row = db
    .prepare(
      `SELECT * FROM campaign_recipients
       WHERE campaign_id = ? AND status = 'pending'
       ORDER BY id LIMIT 1`
    )
    .get(campaignId);
  return row || null;
}

export function markRecipient(db, recipientId, { status, error = null }) {
  db.prepare(
    `UPDATE campaign_recipients SET status = ?, error = ?, sent_at = ? WHERE id = ?`
  ).run(status, error, status === "sent" ? Date.now() : null, recipientId);
}

export function nextRunningCampaign(db) {
  return db
    .prepare(`SELECT * FROM campaigns WHERE status = 'running' ORDER BY started_at LIMIT 1`)
    .get();
}

export function hashAgentPassword(password) {
  return createHash("sha256").update(`jab-hub-agent:${password}`).digest("hex");
}

export function listAgents(db, instanceName) {
  return db
    .prepare(
      `SELECT id, instance_name, name, phone, login, active, created_at, updated_at
       FROM sales_agents WHERE instance_name = ? ORDER BY name`
    )
    .all(instanceName);
}

export function getAgent(db, id) {
  return db.prepare(`SELECT * FROM sales_agents WHERE id = ?`).get(id);
}

export function getAgentByLogin(db, login) {
  return db.prepare(`SELECT * FROM sales_agents WHERE login = ?`).get(login);
}

export function createAgent(db, { instanceName, name, phone, login, password }) {
  const now = Date.now();
  const phoneClean = String(phone).replace(/\D/g, "");
  const result = db
    .prepare(
      `INSERT INTO sales_agents (instance_name, name, phone, login, password_hash, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(instanceName, name, phoneClean, login, hashAgentPassword(password), now, now);
  return getAgent(db, Number(result.lastInsertRowid));
}

export function updateAgent(db, id, { name, phone, active, password }) {
  const existing = getAgent(db, id);
  if (!existing) return null;
  const phoneClean = phone === undefined ? null : String(phone).replace(/\D/g, "");
  const hash = password ? hashAgentPassword(password) : null;
  db.prepare(`
    UPDATE sales_agents SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      active = COALESCE(?, active),
      password_hash = COALESCE(?, password_hash),
      updated_at = ?
    WHERE id = ?
  `).run(
    name === undefined ? null : name,
    phoneClean,
    active === undefined ? null : active ? 1 : 0,
    hash,
    Date.now(),
    id
  );
  return getAgent(db, id);
}

export function listActiveAgents(db, instanceName) {
  return db
    .prepare(
      `SELECT id, instance_name, name, phone, login, active
       FROM sales_agents WHERE instance_name = ? AND active = 1 ORDER BY id`
    )
    .all(instanceName);
}

export function pickRandomAgent(db, instanceName) {
  const agents = listActiveAgents(db, instanceName);
  if (!agents.length) return null;
  return agents[Math.floor(Math.random() * agents.length)];
}

export function getOpenLeadForContact(db, contactId) {
  return db
    .prepare(
      `SELECT * FROM lead_assignments
       WHERE contact_id = ? AND status IN ('unassigned','assigned','active')
       ORDER BY id DESC LIMIT 1`
    )
    .get(contactId);
}

export function getLead(db, id) {
  const lead = db.prepare(`SELECT * FROM lead_assignments WHERE id = ?`).get(id);
  if (!lead) return null;
  const contact = getContact(db, lead.contact_id);
  const agent = lead.agent_id ? getAgent(db, lead.agent_id) : null;
  return {
    ...lead,
    contact,
    agent: agent
      ? { id: agent.id, name: agent.name, phone: agent.phone, login: agent.login, active: agent.active }
      : null
  };
}

export function createHandoffLead(
  db,
  { instanceName, contactId, reason, summary, lastCustomerMessage, agentId = null }
) {
  const existing = getOpenLeadForContact(db, contactId);
  if (existing) return getLead(db, existing.id);

  const now = Date.now();
  const status = agentId ? "assigned" : "unassigned";
  const result = db
    .prepare(
      `INSERT INTO lead_assignments (
        instance_name, contact_id, agent_id, status, reason, summary, last_customer_message, created_at, assigned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      instanceName,
      contactId,
      agentId,
      status,
      reason || null,
      summary || null,
      lastCustomerMessage ? String(lastCustomerMessage).slice(0, 500) : null,
      now,
      agentId ? now : null
    );

  updateContact(db, contactId, {
    handoffStatus: agentId ? "assigned" : "unassigned"
  });

  return getLead(db, Number(result.lastInsertRowid));
}

/**
 * Auto = random agent; Manual = unassigned queue.
 * Returns { lead, agent, mode, needsAlert }.
 */
export function processHandoff(db, { instanceName, contactId, reason, summary, lastCustomerMessage }) {
  const client = getClient(db, instanceName) || { lead_distribution: "auto" };
  const mode = client.lead_distribution === "manual" ? "manual" : "auto";

  const existing = getOpenLeadForContact(db, contactId);
  if (existing) {
    if (lastCustomerMessage) appendLeadMessage(db, existing.id, lastCustomerMessage);
    updateContact(db, contactId, {
      handoffStatus: existing.agent_id ? "assigned" : "unassigned"
    });
    return {
      lead: getLead(db, existing.id),
      agent: existing.agent_id ? getAgent(db, existing.agent_id) : null,
      mode,
      needsAlert: false,
      alreadyOpen: true
    };
  }

  if (mode === "manual") {
    const lead = createHandoffLead(db, {
      instanceName,
      contactId,
      reason,
      summary,
      lastCustomerMessage,
      agentId: null
    });
    return { lead, agent: null, mode, needsAlert: false };
  }

  const agent = pickRandomAgent(db, instanceName);
  if (!agent) {
    const lead = createHandoffLead(db, {
      instanceName,
      contactId,
      reason,
      summary,
      lastCustomerMessage,
      agentId: null
    });
    return { lead, agent: null, mode: "auto", needsAlert: false, noAgents: true };
  }

  const lead = createHandoffLead(db, {
    instanceName,
    contactId,
    reason,
    summary,
    lastCustomerMessage,
    agentId: agent.id
  });
  return { lead, agent, mode: "auto", needsAlert: true };
}

export function assignLeadToAgent(db, leadId, agentId) {
  const lead = db.prepare(`SELECT * FROM lead_assignments WHERE id = ?`).get(leadId);
  if (!lead) return null;
  const agent = getAgent(db, agentId);
  if (!agent || agent.instance_name !== lead.instance_name) {
    throw new Error("Agent not on this client's team");
  }
  if (!agent.active) throw new Error("Agent is inactive");

  const now = Date.now();
  db.prepare(
    `UPDATE lead_assignments SET agent_id = ?, status = 'assigned', assigned_at = ? WHERE id = ?`
  ).run(agentId, now, leadId);
  updateContact(db, lead.contact_id, { handoffStatus: "assigned" });
  return getLead(db, leadId);
}

export function updateLeadStatus(db, leadId, status) {
  const now = Date.now();
  const closedAt = status === "closed" ? now : null;
  db.prepare(
    `UPDATE lead_assignments SET status = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?`
  ).run(status, closedAt, leadId);

  const lead = db.prepare(`SELECT * FROM lead_assignments WHERE id = ?`).get(leadId);
  if (lead) {
    const handoffStatus =
      status === "closed" ? "ai" : status === "active" ? "human_active" : status === "assigned" ? "assigned" : "unassigned";
    updateContact(db, lead.contact_id, { handoffStatus });
  }
  return getLead(db, leadId);
}

export function listLeads(db, { instanceName = null, agentId = null, status = null } = {}) {
  let sql = `
    SELECT la.*,
      c.phone AS contact_phone, c.push_name AS contact_name,
      c.qualification_score, c.qualification_summary,
      sa.name AS agent_name, sa.phone AS agent_phone
    FROM lead_assignments la
    JOIN contacts c ON c.id = la.contact_id
    LEFT JOIN sales_agents sa ON sa.id = la.agent_id
    WHERE 1=1
  `;
  const params = [];
  if (instanceName) {
    sql += ` AND la.instance_name = ?`;
    params.push(instanceName);
  }
  if (agentId) {
    sql += ` AND la.agent_id = ?`;
    params.push(agentId);
  }
  if (status) {
    sql += ` AND la.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY la.created_at DESC`;
  return db.prepare(sql).all(...params);
}

export function isContactHumanOwned(db, instanceName, phone) {
  const contact = db
    .prepare(`SELECT * FROM contacts WHERE instance_name = ? AND phone = ?`)
    .get(instanceName, phone);
  if (!contact) return false;
  // Only pause AI after a human agent has actually replied from the Hub.
  // After [HANDOFF] (unassigned/assigned) the AI can still continue the chat
  // until a person takes over — so memory/continuity is not cut off early.
  return contact.handoff_status === "human_active";
}

export function getContactByPhone(db, instanceName, phone) {
  return db
    .prepare(`SELECT * FROM contacts WHERE instance_name = ? AND phone = ?`)
    .get(instanceName, phone);
}

export function appendLeadMessage(db, leadId, lastCustomerMessage) {
  db.prepare(
    `UPDATE lead_assignments SET last_customer_message = ? WHERE id = ?`
  ).run(String(lastCustomerMessage || "").slice(0, 500), leadId);
}

export function updateLeadSummary(db, leadId, summary) {
  db.prepare(`UPDATE lead_assignments SET summary = ? WHERE id = ?`).run(
    summary ? String(summary).slice(0, 4000) : null,
    leadId
  );
  return getLead(db, leadId);
}

export function listProducts(db, instanceName, { activeOnly = false, q = "" } = {}) {
  const term = `%${String(q || "").trim()}%`;
  let rows;
  if (activeOnly) {
    rows = db
      .prepare(
        `SELECT * FROM store_products
         WHERE instance_name = ? AND active = 1
           AND (name LIKE ? OR IFNULL(sku,'') LIKE ? OR IFNULL(description,'') LIKE ?)
         ORDER BY name`
      )
      .all(instanceName, term, term, term);
  } else {
    rows = db
      .prepare(
        `SELECT * FROM store_products
         WHERE instance_name = ?
           AND (name LIKE ? OR IFNULL(sku,'') LIKE ? OR IFNULL(description,'') LIKE ?)
         ORDER BY active DESC, name`
      )
      .all(instanceName, term, term, term);
  }
  return rows.map(normalizeProduct);
}

export function getProduct(db, id) {
  const row = db.prepare(`SELECT * FROM store_products WHERE id = ?`).get(id);
  return row ? normalizeProduct(row) : null;
}

function parseImagesJson(raw, fallbackPath = null) {
  let images = [];
  try {
    const parsed = JSON.parse(raw || "[]");
    if (Array.isArray(parsed)) images = parsed.filter((x) => typeof x === "string" && x);
  } catch {
    images = [];
  }
  if (!images.length && fallbackPath) images = [fallbackPath];
  return [...new Set(images)];
}

export function normalizeProduct(row) {
  if (!row) return null;
  const images = parseImagesJson(row.images_json, row.image_path);
  return {
    ...row,
    images,
    image_path: images[0] || row.image_path || null
  };
}

export function createProduct(
  db,
  {
    instanceName,
    name,
    sku = null,
    description = "",
    price = 0,
    currency = "GHS",
    stock = null,
    imagePath = null,
    imagesPaths = null,
    active = true
  }
) {
  const now = Date.now();
  const images = Array.isArray(imagesPaths)
    ? imagesPaths.filter(Boolean)
    : imagePath
      ? [imagePath]
      : [];
  const cover = images[0] || null;
  const result = db
    .prepare(
      `INSERT INTO store_products (
        instance_name, name, sku, description, price, currency, stock, image_path, images_json, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      instanceName,
      String(name).trim(),
      sku ? String(sku).trim() : null,
      description || "",
      Number(price) || 0,
      currency || "GHS",
      stock === null || stock === undefined || stock === "" ? null : Number(stock),
      cover,
      JSON.stringify(images),
      active ? 1 : 0,
      now,
      now
    );
  return getProduct(db, Number(result.lastInsertRowid));
}

export function updateProduct(
  db,
  id,
  { name, sku, description, price, currency, stock, imagePath, imagesPaths, appendImages = false, active }
) {
  const existing = getProduct(db, id);
  if (!existing) return null;

  let nextImages = existing.images || [];
  if (Array.isArray(imagesPaths)) {
    nextImages = appendImages
      ? [...nextImages, ...imagesPaths.filter(Boolean)]
      : imagesPaths.filter(Boolean);
  } else if (imagePath) {
    nextImages = appendImages ? [...nextImages, imagePath] : [imagePath];
  }
  nextImages = [...new Set(nextImages)];
  const cover = nextImages[0] || null;

  db.prepare(`
    UPDATE store_products SET
      name = COALESCE(?, name),
      sku = COALESCE(?, sku),
      description = COALESCE(?, description),
      price = COALESCE(?, price),
      currency = COALESCE(?, currency),
      stock = COALESCE(?, stock),
      image_path = ?,
      images_json = ?,
      active = COALESCE(?, active),
      updated_at = ?
    WHERE id = ?
  `).run(
    name === undefined ? null : String(name).trim(),
    sku === undefined ? null : sku ? String(sku).trim() : null,
    description === undefined ? null : description,
    price === undefined ? null : Number(price),
    currency === undefined ? null : currency,
    stock === undefined ? null : stock === null || stock === "" ? null : Number(stock),
    cover,
    JSON.stringify(nextImages),
    active === undefined ? null : active ? 1 : 0,
    Date.now(),
    id
  );
  return getProduct(db, id);
}

export function deleteProduct(db, id) {
  const existing = getProduct(db, id);
  if (!existing) return false;
  db.prepare(`DELETE FROM store_products WHERE id = ?`).run(id);
  return true;
}

function parseDealsJson(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function getClientAdminPhones(db, instanceName) {
  const client = getClient(db, instanceName);
  if (!client) return [];
  const fromField = String(client.admin_phones || "")
    .split(/[,;\s]+/)
    .map(normalizePhoneDigits)
    .filter(Boolean);
  const extras = [
    normalizePhoneDigits(client.contact_phone),
    normalizePhoneDigits(client.whatsapp_order_number)
  ].filter(Boolean);
  return [...new Set([...fromField, ...extras])];
}

/** Phones that receive owner digests / hot-lead summaries (not customer chat). */
export function getClientOwnerNotifyPhones(db, instanceName) {
  const client = getClient(db, instanceName);
  if (!client) return [];
  const owner = normalizePhoneDigits(client.owner_notify_phone);
  const admins = String(client.admin_phones || "")
    .split(/[,;\s]+/)
    .map(normalizePhoneDigits)
    .filter(Boolean);
  const contact = normalizePhoneDigits(client.contact_phone);
  const order = normalizePhoneDigits(client.whatsapp_order_number);
  return [...new Set([owner, ...admins, contact, order].filter(Boolean))];
}

export function isClientAdminPhone(db, instanceName, phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return false;
  return getClientAdminPhones(db, instanceName).some(
    (admin) => admin === digits || admin.endsWith(digits) || digits.endsWith(admin)
  );
}

export function listClientDeals(db, instanceName) {
  const client = getClient(db, instanceName);
  if (!client) return [];
  return parseDealsJson(client.deals_json).map((d, i) => ({
    id: Number(d.id) || i + 1,
    title: String(d.title || "").trim(),
    destination: String(d.destination || "").trim(),
    salary: String(d.salary || "").trim(),
    fee: String(d.fee || "").trim(),
    requirements: String(d.requirements || "").trim(),
    benefits: String(d.benefits || "").trim(),
    notes: String(d.notes || "").trim(),
    active: d.active === false ? false : true,
    updatedAt: d.updatedAt || null
  }));
}

function saveClientDeals(db, instanceName, deals) {
  const existing = getClient(db, instanceName);
  if (!existing) return null;
  const normalized = (deals || []).map((d, i) => ({
    id: Number(d.id) || i + 1,
    title: String(d.title || "").trim(),
    destination: String(d.destination || "").trim(),
    salary: String(d.salary || "").trim(),
    fee: String(d.fee || "").trim(),
    requirements: String(d.requirements || "").trim(),
    benefits: String(d.benefits || "").trim(),
    notes: String(d.notes || "").trim(),
    active: d.active === false ? false : true,
    updatedAt: d.updatedAt || Date.now()
  }));
  db.prepare(
    `UPDATE clients SET deals_json = ?, updated_at = ? WHERE instance_name = ?`
  ).run(JSON.stringify(normalized), Date.now(), instanceName);
  return listClientDeals(db, instanceName);
}

export function setClientDeals(db, instanceName, deals) {
  return saveClientDeals(db, instanceName, deals);
}

export function addClientDeal(db, instanceName, deal) {
  const current = listClientDeals(db, instanceName);
  const nextId = current.reduce((max, d) => Math.max(max, Number(d.id) || 0), 0) + 1;
  current.push({ ...deal, id: nextId, active: true, updatedAt: Date.now() });
  saveClientDeals(db, instanceName, current);
  return listClientDeals(db, instanceName).find((d) => d.id === nextId);
}

export function removeClientDeal(db, instanceName, dealId) {
  const id = Number(dealId);
  const current = listClientDeals(db, instanceName);
  const next = current.filter((d) => Number(d.id) !== id);
  if (next.length === current.length) return null;
  return saveClientDeals(db, instanceName, next);
}

export function updateClientDeal(db, instanceName, dealId, patch = {}) {
  const id = Number(dealId);
  const current = listClientDeals(db, instanceName);
  const idx = current.findIndex((d) => Number(d.id) === id);
  if (idx < 0) return null;
  current[idx] = {
    ...current[idx],
    ...patch,
    id,
    updatedAt: Date.now()
  };
  saveClientDeals(db, instanceName, current);
  return listClientDeals(db, instanceName).find((d) => d.id === id);
}

/** Compact live deals board for the WhatsApp AI prompt (per instance). */
export function formatDealsForAgent(db, instanceName, limit = 40) {
  const deals = listClientDeals(db, instanceName)
    .filter((d) => d.active !== false)
    .slice(0, limit);
  if (!deals.length) return "";
  const lines = deals.map((d) => {
    const bits = [
      d.destination ? `Destination: ${d.destination}` : null,
      d.salary ? `Salary/pay: ${d.salary}` : null,
      d.fee ? `Fees: ${d.fee}` : null,
      d.requirements ? `Requirements: ${d.requirements}` : null,
      d.benefits ? `Benefits: ${d.benefits}` : null,
      d.notes ? `Notes: ${d.notes}` : null
    ].filter(Boolean);
    return `- [#${d.id}] ${d.title}${bits.length ? ` — ${bits.join("; ")}` : ""}`;
  });
  return [
    "CURRENT LIVE DEALS (source of truth — use ONLY these; do not invent other countries/jobs/salaries):",
    ...lines
  ].join("\n");
}

/** Compact catalog text for the WhatsApp AI prompt (per instance). */
export function formatCatalogForAgent(db, instanceName, limit = 25) {
  const client = getClient(db, instanceName);
  const products = listProducts(db, instanceName, { activeOnly: true }).slice(0, limit);
  if (!products.length) return "";
  const lines = products.map((p) => {
    const price = `${p.currency || "GHS"} ${Number(p.price || 0).toFixed(2)}`;
    const stock =
      p.stock === null || p.stock === undefined ? "" : ` · stock ${p.stock}`;
    const sku = p.sku ? ` sku=${p.sku}` : "";
    const photos = (p.images || []).length;
    const photoNote = photos ? ` · photos=${photos}` : " · photos=0";
    const desc = p.description ? ` — ${String(p.description).slice(0, 80)}` : "";
    return `- id=${p.id} ${p.name}${sku}: ${price}${stock}${photoNote}${desc}`;
  });
  const shopBits = [];
  if (client?.shop_address) shopBits.push(`address: ${client.shop_address}`);
  if (client?.shop_lat != null && client?.shop_lng != null) {
    shopBits.push(`coords: ${client.shop_lat},${client.shop_lng}`);
  }
  const shopLine = shopBits.length
    ? `Shop pickup location (${shopBits.join("; ")}). Use [YANGO_FEE:buyer location] to quote delivery.`
    : "Shop pickup location not set — ask agency to set shop address before quoting Yango delivery.";
  return [
    "Store catalog (use when customers ask about products/prices/photos):",
    ...lines,
    shopLine
  ].join("\n");
}

/** Resolve a catalog product by id, sku, or fuzzy name for WhatsApp photo sends. */
export function findProductForPhoto(db, instanceName, ref) {
  const needle = String(ref || "").trim();
  if (!needle) return null;
  const products = listProducts(db, instanceName, { activeOnly: true });
  if (!products.length) return null;

  if (/^\d+$/.test(needle)) {
    const byId = products.find((p) => String(p.id) === needle);
    if (byId) return byId;
  }

  const lower = needle.toLowerCase();
  const bySku = products.find((p) => p.sku && String(p.sku).toLowerCase() === lower);
  if (bySku) return bySku;

  const exactName = products.find((p) => String(p.name || "").toLowerCase() === lower);
  if (exactName) return exactName;

  const partial = products.find((p) => String(p.name || "").toLowerCase().includes(lower));
  if (partial) return partial;

  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  if (words.length) {
    const scored = products
      .map((p) => {
        const name = String(p.name || "").toLowerCase();
        const hits = words.filter((w) => name.includes(w)).length;
        return { p, hits };
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    if (scored[0]) return scored[0].p;
  }
  return null;
}
