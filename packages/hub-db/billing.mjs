/**
 * Agency billing: point packages, rates, wallets, ledger, Paystack payments.
 * Imported by hub-db migrate + Hub/bridge.
 */

export const RATE_KEYS = [
  "ai_text",
  "ai_image",
  "ai_audio",
  "ai_video",
  "ai_document",
  "campaign_text",
  "campaign_image",
  "campaign_document"
];

const DEFAULT_RATES = {
  ai_text: 1,
  ai_image: 2,
  ai_audio: 3,
  ai_video: 5,
  ai_document: 2,
  campaign_text: 1,
  campaign_image: 2,
  campaign_document: 2
};

/** Default Evolution instance for the agency ads / ops WhatsApp (unlimited AI). */
export function defaultAgencyInstanceName() {
  return (
    String(process.env.JAB_AGENCY_INSTANCE || "").trim() ||
    String(process.env.JAB_MARKETING_INSTANCE || "").trim() ||
    "jab-whatsapp"
  );
}

/**
 * Resolve the agency WhatsApp instance name.
 * Finance setting wins; otherwise env / jab-whatsapp default.
 * That instance is exempt from AI point gates and debits (unlimited AI credits).
 */
export function resolveAgencyInstanceName(db) {
  const settings = db ? getAgencySettings(db) : null;
  return String(settings?.agency_instance_name || "").trim() || defaultAgencyInstanceName();
}

export function isAgencyInstance(db, instanceName) {
  const name = String(instanceName || "").trim();
  if (!name) return false;
  return name === resolveAgencyInstanceName(db);
}

export function migrateBilling(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agency_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      agency_instance_name TEXT,
      low_balance_threshold INTEGER NOT NULL DEFAULT 50,
      notify_low_balance INTEGER NOT NULL DEFAULT 1,
      notify_payment INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS point_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price_ghs REAL NOT NULL,
      points INTEGER NOT NULL,
      bonus_points INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS point_rates (
      rate_key TEXT PRIMARY KEY,
      points INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_wallets (
      instance_name TEXT PRIMARY KEY,
      balance_points INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      last_low_balance_notified_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS point_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      note TEXT,
      balance_after INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_instance ON point_ledger(instance_name);
    CREATE INDEX IF NOT EXISTS idx_ledger_created ON point_ledger(created_at);

    CREATE TABLE IF NOT EXISTS paystack_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      instance_name TEXT NOT NULL,
      package_id INTEGER,
      amount_ghs REAL NOT NULL,
      points INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      authorization_url TEXT,
      paystack_id TEXT,
      customer_email TEXT,
      created_at INTEGER NOT NULL,
      paid_at INTEGER,
      FOREIGN KEY (package_id) REFERENCES point_packages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_paystack_instance ON paystack_payments(instance_name);
    CREATE INDEX IF NOT EXISTS idx_paystack_status ON paystack_payments(status);
  `);

  const now = Date.now();
  const defaultAgency = defaultAgencyInstanceName();
  const settings = db.prepare(`SELECT id, agency_instance_name FROM agency_settings WHERE id = 1`).get();
  if (!settings) {
    db.prepare(
      `INSERT INTO agency_settings (id, agency_instance_name, low_balance_threshold, notify_low_balance, notify_payment, updated_at)
       VALUES (1, ?, 50, 1, 1, ?)`
    ).run(defaultAgency, now);
  } else if (!String(settings.agency_instance_name || "").trim()) {
    // Backfill: agency line is unlimited AI by default system settings
    db.prepare(
      `UPDATE agency_settings SET agency_instance_name = ?, updated_at = ? WHERE id = 1`
    ).run(defaultAgency, now);
  }

  const rateCount = db.prepare(`SELECT COUNT(*) AS c FROM point_rates`).get().c;
  if (!rateCount) {
    const ins = db.prepare(
      `INSERT INTO point_rates (rate_key, points, updated_at) VALUES (?, ?, ?)`
    );
    for (const key of RATE_KEYS) {
      ins.run(key, DEFAULT_RATES[key] ?? 1, now);
    }
  }

  const pkgCount = db.prepare(`SELECT COUNT(*) AS c FROM point_packages`).get().c;
  if (!pkgCount) {
    db.prepare(
      `INSERT INTO point_packages (name, price_ghs, points, bonus_points, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, ?, ?)`
    ).run("Starter", 50, 500, 0, now, now);
    db.prepare(
      `INSERT INTO point_packages (name, price_ghs, points, bonus_points, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?)`
    ).run("Growth", 150, 1800, 200, now, now);
    db.prepare(
      `INSERT INTO point_packages (name, price_ghs, points, bonus_points, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 2, ?, ?)`
    ).run("Pro", 400, 5000, 1000, now, now);
  }

  // Additive billing columns
  const settingsCols = db.prepare(`PRAGMA table_info(agency_settings)`).all().map((c) => c.name);
  if (!settingsCols.includes("signup_bonus_points")) {
    db.exec(`ALTER TABLE agency_settings ADD COLUMN signup_bonus_points INTEGER NOT NULL DEFAULT 100`);
  }
  if (!settingsCols.includes("agency_notify_mode")) {
    db.exec(`ALTER TABLE agency_settings ADD COLUMN agency_notify_mode TEXT NOT NULL DEFAULT 'digest'`);
  }
  if (!settingsCols.includes("agency_score_notify_threshold")) {
    db.exec(`ALTER TABLE agency_settings ADD COLUMN agency_score_notify_threshold INTEGER NOT NULL DEFAULT 60`);
  }
  if (!settingsCols.includes("agency_ops_channel")) {
    db.exec(`ALTER TABLE agency_settings ADD COLUMN agency_ops_channel TEXT NOT NULL DEFAULT 'both'`);
  }
  if (!settingsCols.includes("agency_digest_include_hub_url")) {
    db.exec(`ALTER TABLE agency_settings ADD COLUMN agency_digest_include_hub_url INTEGER NOT NULL DEFAULT 0`);
  }

  const pkgCols = db.prepare(`PRAGMA table_info(point_packages)`).all().map((c) => c.name);
  if (!pkgCols.includes("duration_days")) {
    db.exec(`ALTER TABLE point_packages ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 30`);
  }
  if (!pkgCols.includes("is_topup")) {
    db.exec(`ALTER TABLE point_packages ADD COLUMN is_topup INTEGER NOT NULL DEFAULT 0`);
  }

  const walletCols = db.prepare(`PRAGMA table_info(client_wallets)`).all().map((c) => c.name);
  if (!walletCols.includes("period_starts_at")) {
    db.exec(`ALTER TABLE client_wallets ADD COLUMN period_starts_at INTEGER`);
  }
  if (!walletCols.includes("period_ends_at")) {
    db.exec(`ALTER TABLE client_wallets ADD COLUMN period_ends_at INTEGER`);
  }
  if (!walletCols.includes("signup_bonus_granted")) {
    db.exec(`ALTER TABLE client_wallets ADD COLUMN signup_bonus_granted INTEGER NOT NULL DEFAULT 0`);
  }

  const payCols = db.prepare(`PRAGMA table_info(paystack_payments)`).all().map((c) => c.name);
  if (!payCols.includes("prospect_phone")) {
    db.exec(`ALTER TABLE paystack_payments ADD COLUMN prospect_phone TEXT`);
  }
  if (!payCols.includes("prospect_name")) {
    db.exec(`ALTER TABLE paystack_payments ADD COLUMN prospect_name TEXT`);
  }
  if (!payCols.includes("sale_channel")) {
    db.exec(`ALTER TABLE paystack_payments ADD COLUMN sale_channel TEXT`);
  }
  if (!payCols.includes("credit_instance_name")) {
    db.exec(`ALTER TABLE paystack_payments ADD COLUMN credit_instance_name TEXT`);
  }
  if (!payCols.includes("reconciled_at")) {
    db.exec(`ALTER TABLE paystack_payments ADD COLUMN reconciled_at INTEGER`);
  }

  // Ensure at least one top-up package exists
  const topupCount = db.prepare(`SELECT COUNT(*) AS c FROM point_packages WHERE is_topup = 1`).get().c;
  if (!topupCount) {
    db.prepare(
      `INSERT INTO point_packages (name, price_ghs, points, bonus_points, active, sort_order, duration_days, is_topup, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 10, 30, 1, ?, ?)`
    ).run("Top-up 250", 30, 250, 0, now, now);
  }

  ensureSetupTrialPackage(db);
  backfillClientBillingEmails(db);

  // Backfill duration/is_topup for older packages if columns were just added with defaults — already DEFAULT 30 / 0
}

/** Default onboarding offer quoted on the agency WhatsApp channel. */
export function ensureSetupTrialPackage(db) {
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT id FROM point_packages
       WHERE LOWER(name) LIKE '%setup%' OR (price_ghs = 199 AND points = 100 AND is_topup = 0)
       ORDER BY sort_order, id LIMIT 1`
    )
    .get();
  if (row) {
    db.prepare(
      `UPDATE point_packages SET
        name = ?,
        price_ghs = 199,
        points = 100,
        bonus_points = 0,
        active = 1,
        sort_order = 0,
        duration_days = 30,
        is_topup = 0,
        updated_at = ?
       WHERE id = ?`
    ).run("Setup (Free trial)", now, row.id);
    return getPointPackage(db, row.id);
  }
  const result = db
    .prepare(
      `INSERT INTO point_packages (name, price_ghs, points, bonus_points, active, sort_order, duration_days, is_topup, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, 30, 0, ?, ?)`
    )
    .run("Setup (Free trial)", 199, 100, 0, now, now);
  return getPointPackage(db, Number(result.lastInsertRowid));
}

/** Live packages/pricing block for agency + client AI prompts. */
export function formatPackagesForAgent(db) {
  const pkgs = listPointPackages(db, { activeOnly: true });
  if (!pkgs.length) return "";
  const lines = pkgs.map((p) => {
    const total = packageTotalPoints(p);
    const kind = Number(p.is_topup) ? "top-up" : "plan";
    const bonus = Number(p.bonus_points) > 0 ? ` (+${p.bonus_points} bonus)` : "";
    return `- [${p.id}] ${p.name}: GHS ${Number(p.price_ghs).toFixed(0)} → ${total} credits${bonus} (${kind}, ${Number(p.duration_days) || 30} days)`;
  });
  const setup = pkgs.find((p) => /setup/i.test(String(p.name))) || pkgs.find((p) => !Number(p.is_topup));
  if (setup) {
    lines.push(
      "",
      `Default onboarding offer: ${setup.name} — GHS ${Number(setup.price_ghs).toFixed(0)} for ${packageTotalPoints(setup)} credits (includes free trial).`,
      `Use [PAYMENT_LINK:${setup.id}] or [PAYMENT_LINK:] (defaults to Setup when no active plan).`
    );
  }
  return ["CURRENT HUB PACKAGES (use ONLY these prices — never invent):", ...lines].join("\n");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYSTACK_REJECT_TLDS = new Set(["local", "invalid", "test"]);

export function isValidBillingEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return Boolean(email && EMAIL_RE.test(email));
}

/** Paystack rejects some TLDs (e.g. .local) even when syntactically valid. */
export function isPaystackBillingEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!isValidBillingEmail(email)) return false;
  const tld = email.split(".").pop() || "";
  return !PAYSTACK_REJECT_TLDS.has(tld);
}

function paystackEmailDomain() {
  return String(process.env.JAB_HUB_PAYSTACK_EMAIL_DOMAIN || "customers.jabdigitalhub.com")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
}

function phoneLooksLikeWhatsappLid(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (!d) return true;
  if (d.length > 13) return true;
  // Evolution LID peer ids (not real MSISDN)
  if (/^57\d{10,}$/.test(d)) return true;
  return false;
}

/** Derive a Paystack-safe billing email when none is stored. */
export function derivePaystackBillingEmail({
  instanceName,
  phone,
  displayName,
  reference = null
} = {}) {
  const envDefault = String(
    process.env.JAB_HUB_BILLING_EMAIL || process.env.PAYSTACK_DEFAULT_EMAIL || ""
  ).trim();
  if (isPaystackBillingEmail(envDefault)) {
    const refSlug = String(reference || "")
      .replace(/[^a-z0-9]/gi, "")
      .slice(-20);
    if (refSlug && envDefault.includes("@")) {
      const at = envDefault.indexOf("@");
      const local = envDefault.slice(0, at);
      const domain = envDefault.slice(at + 1);
      return `${local}+${refSlug}@${domain}`.toLowerCase();
    }
    return envDefault.toLowerCase();
  }

  const domain = paystackEmailDomain();
  const digits = String(phone || "").replace(/\D/g, "");
  const refPart =
    String(reference || "")
      .replace(/[^a-z0-9]/gi, "")
      .slice(-16) || Date.now().toString(36);

  if (!phoneLooksLikeWhatsappLid(digits) && digits.length >= 9 && digits.length <= 13) {
    return `wa${digits.slice(-10)}@${domain}`.toLowerCase();
  }

  const slug =
    String(instanceName || displayName || "client")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "client";
  return `${slug}.${refPart}@${domain}`.toLowerCase();
}

export function resolvePaystackBillingEmail(
  db,
  { instanceName, client = null, phone = null, explicitEmail = null, reference = null } = {}
) {
  const row =
    client ||
    (instanceName
      ? db.prepare(`SELECT * FROM clients WHERE instance_name = ?`).get(instanceName)
      : null);
  const explicit = String(explicitEmail || "").trim();
  if (isPaystackBillingEmail(explicit)) return explicit.toLowerCase();
  const stored = String(row?.contact_email || "").trim();
  if (isPaystackBillingEmail(stored)) return stored.toLowerCase();
  return derivePaystackBillingEmail({
    instanceName: instanceName || row?.instance_name,
    phone: phone || row?.contact_phone || row?.whatsapp_order_number,
    displayName: row?.display_name,
    reference
  });
}

/** Persist an auto billing email when the client record has none. */
export function ensureClientBillingEmail(db, instanceName, { client = null, phone = null } = {}) {
  const row =
    client || db.prepare(`SELECT * FROM clients WHERE instance_name = ?`).get(instanceName);
  if (!row) return null;
  const existing = String(row.contact_email || "").trim();
  if (isPaystackBillingEmail(existing)) return existing.toLowerCase();
  const email = resolvePaystackBillingEmail(db, {
    instanceName: row.instance_name,
    client: row,
    phone,
    reference: `fix${row.instance_name}${Date.now()}`
  });
  db.prepare(`UPDATE clients SET contact_email = ?, updated_at = ? WHERE instance_name = ?`).run(
    email,
    Date.now(),
    row.instance_name
  );
  return email;
}

export function backfillClientBillingEmails(db) {
  const rows = db.prepare(`SELECT * FROM clients`).all();
  let updated = 0;
  for (const row of rows) {
    const before = String(row.contact_email || "").trim();
    const after = ensureClientBillingEmail(db, row.instance_name, { client: row });
    if (before !== after) updated += 1;
  }
  return updated;
}

export function getAgencySettings(db) {
  return db.prepare(`SELECT * FROM agency_settings WHERE id = 1`).get();
}

export function updateAgencySettings(
  db,
  {
    agencyInstanceName,
    lowBalanceThreshold,
    notifyLowBalance,
    notifyPayment,
    signupBonusPoints,
    agencyNotifyMode,
    agencyScoreNotifyThreshold,
    agencyOpsChannel,
    agencyDigestIncludeHubUrl
  }
) {
  const existing = getAgencySettings(db);
  const notifyMode =
    agencyNotifyMode === undefined
      ? null
      : ["digest", "handoff_full", "off"].includes(String(agencyNotifyMode).toLowerCase())
        ? String(agencyNotifyMode).toLowerCase()
        : "digest";
  const opsChannel =
    agencyOpsChannel === undefined
      ? null
      : ["telegram", "whatsapp", "both", "off", "hub"].includes(String(agencyOpsChannel).toLowerCase())
        ? String(agencyOpsChannel).toLowerCase()
        : "both";
  db.prepare(
    `UPDATE agency_settings SET
      agency_instance_name = COALESCE(?, agency_instance_name),
      low_balance_threshold = COALESCE(?, low_balance_threshold),
      notify_low_balance = COALESCE(?, notify_low_balance),
      notify_payment = COALESCE(?, notify_payment),
      signup_bonus_points = COALESCE(?, signup_bonus_points),
      agency_notify_mode = COALESCE(?, agency_notify_mode),
      agency_score_notify_threshold = COALESCE(?, agency_score_notify_threshold),
      agency_ops_channel = COALESCE(?, agency_ops_channel),
      agency_digest_include_hub_url = COALESCE(?, agency_digest_include_hub_url),
      updated_at = ?
     WHERE id = 1`
  ).run(
    agencyInstanceName === undefined ? null : agencyInstanceName || null,
    lowBalanceThreshold === undefined ? null : Number(lowBalanceThreshold),
    notifyLowBalance === undefined ? null : notifyLowBalance ? 1 : 0,
    notifyPayment === undefined ? null : notifyPayment ? 1 : 0,
    signupBonusPoints === undefined ? null : Math.max(0, Math.floor(Number(signupBonusPoints) || 0)),
    notifyMode,
    agencyScoreNotifyThreshold === undefined
      ? null
      : Math.max(0, Math.min(100, Math.floor(Number(agencyScoreNotifyThreshold) || 60))),
    opsChannel,
    agencyDigestIncludeHubUrl === undefined
      ? null
      : agencyDigestIncludeHubUrl ? 1 : 0,
    Date.now()
  );
  return getAgencySettings(db) || existing;
}

export function listPointPackages(db, { activeOnly = false } = {}) {
  if (activeOnly) {
    return db
      .prepare(`SELECT * FROM point_packages WHERE active = 1 ORDER BY sort_order, id`)
      .all();
  }
  return db.prepare(`SELECT * FROM point_packages ORDER BY sort_order, id`).all();
}

export function getPointPackage(db, id) {
  return db.prepare(`SELECT * FROM point_packages WHERE id = ?`).get(id);
}

export function createPointPackage(
  db,
  { name, priceGhs, points, bonusPoints = 0, active = true, sortOrder = 0, durationDays = 30, isTopup = false }
) {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO point_packages (name, price_ghs, points, bonus_points, active, sort_order, duration_days, is_topup, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      Number(priceGhs) || 0,
      Math.max(0, Math.floor(Number(points) || 0)),
      Math.max(0, Math.floor(Number(bonusPoints) || 0)),
      active ? 1 : 0,
      Number(sortOrder) || 0,
      Math.max(1, Math.floor(Number(durationDays) || 30)),
      isTopup ? 1 : 0,
      now,
      now
    );
  return getPointPackage(db, Number(result.lastInsertRowid));
}

export function updatePointPackage(
  db,
  id,
  { name, priceGhs, points, bonusPoints, active, sortOrder, durationDays, isTopup }
) {
  db.prepare(
    `UPDATE point_packages SET
      name = COALESCE(?, name),
      price_ghs = COALESCE(?, price_ghs),
      points = COALESCE(?, points),
      bonus_points = COALESCE(?, bonus_points),
      active = COALESCE(?, active),
      sort_order = COALESCE(?, sort_order),
      duration_days = COALESCE(?, duration_days),
      is_topup = COALESCE(?, is_topup),
      updated_at = ?
     WHERE id = ?`
  ).run(
    name === undefined ? null : String(name).trim(),
    priceGhs === undefined ? null : Number(priceGhs),
    points === undefined ? null : Math.max(0, Math.floor(Number(points))),
    bonusPoints === undefined ? null : Math.max(0, Math.floor(Number(bonusPoints))),
    active === undefined ? null : active ? 1 : 0,
    sortOrder === undefined ? null : Number(sortOrder),
    durationDays === undefined ? null : Math.max(1, Math.floor(Number(durationDays) || 30)),
    isTopup === undefined ? null : isTopup ? 1 : 0,
    Date.now(),
    id
  );
  return getPointPackage(db, id);
}

export function deletePointPackage(db, id) {
  const existing = getPointPackage(db, id);
  if (!existing) return false;
  db.prepare(`DELETE FROM point_packages WHERE id = ?`).run(id);
  return true;
}

export function getPointRates(db) {
  const rows = db.prepare(`SELECT rate_key, points FROM point_rates`).all();
  const rates = { ...DEFAULT_RATES };
  for (const row of rows) rates[row.rate_key] = Number(row.points) || 0;
  return rates;
}

export function setPointRates(db, rates = {}) {
  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO point_rates (rate_key, points, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(rate_key) DO UPDATE SET points = excluded.points, updated_at = excluded.updated_at`
  );
  for (const key of RATE_KEYS) {
    if (rates[key] === undefined) continue;
    upsert.run(key, Math.max(0, Math.floor(Number(rates[key]) || 0)), now);
  }
  return getPointRates(db);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function durationMs(days) {
  return Math.max(1, Math.floor(Number(days) || 30)) * DAY_MS;
}

export function ensureWallet(db, instanceName) {
  const existing = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
  if (existing) return existing;
  const now = Date.now();
  db.prepare(
    `INSERT INTO client_wallets (instance_name, balance_points, updated_at) VALUES (?, 0, ?)`
  ).run(instanceName, now);
  return db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
}

/**
 * If the billing period ended, wipe leftover points (they do not roll over).
 * Safe to call inside an open transaction (no nested BEGIN).
 */
export function expirePeriodIfNeeded(db, instanceName) {
  ensureWallet(db, instanceName);
  const wallet = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
  const now = Date.now();
  if (!wallet?.period_ends_at || Number(wallet.period_ends_at) > now) return wallet;

  const bal = Number(wallet.balance_points) || 0;
  if (bal > 0) {
    db.prepare(
      `UPDATE client_wallets SET balance_points = 0, period_starts_at = NULL, period_ends_at = NULL, updated_at = ?
       WHERE instance_name = ?`
    ).run(now, instanceName);
    db.prepare(
      `INSERT INTO point_ledger (instance_name, direction, amount, reason, ref, note, balance_after, created_at)
       VALUES (?, 'debit', ?, 'period_expired', NULL, ?, 0, ?)`
    ).run(instanceName, bal, `Unused points expired after billing period`, now);
  } else {
    db.prepare(
      `UPDATE client_wallets SET period_starts_at = NULL, period_ends_at = NULL, updated_at = ?
       WHERE instance_name = ?`
    ).run(now, instanceName);
  }
  return db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
}

export function getWallet(db, instanceName) {
  expirePeriodIfNeeded(db, instanceName);
  return ensureWallet(db, instanceName);
}

/**
 * Credit points from a package. Plans reset/start a duration window (default 30 days).
 * Top-ups add points inside the current window (or start one if none is active).
 * Set useTransaction=false when already inside BEGIN IMMEDIATE.
 */
export function creditFromPackage(
  db,
  { instanceName, pkg, reason = "package_credit", ref = null, note = null, useTransaction = true }
) {
  const pts = packageTotalPoints(pkg);
  const isTopup = Boolean(Number(pkg?.is_topup));
  const days = Math.max(1, Math.floor(Number(pkg?.duration_days) || 30));
  const ledgerReason = reason || (isTopup ? "package_topup" : "package_plan");

  const run = () => {
    expirePeriodIfNeeded(db, instanceName);
    const wallet = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
    const now = Date.now();
    let periodStarts = wallet.period_starts_at ? Number(wallet.period_starts_at) : null;
    let periodEnds = wallet.period_ends_at ? Number(wallet.period_ends_at) : null;
    const periodActive = periodEnds && periodEnds > now;

    if (!isTopup || !periodActive) {
      periodStarts = now;
      periodEnds = now + durationMs(days);
    }

    const next = (Number(wallet.balance_points) || 0) + pts;
    db.prepare(
      `UPDATE client_wallets SET balance_points = ?, period_starts_at = ?, period_ends_at = ?, updated_at = ?
       WHERE instance_name = ?`
    ).run(next, periodStarts, periodEnds, now, instanceName);

    const result = db
      .prepare(
        `INSERT INTO point_ledger (instance_name, direction, amount, reason, ref, note, balance_after, created_at)
         VALUES (?, 'credit', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        instanceName,
        pts,
        ledgerReason,
        ref,
        note ||
          `${isTopup ? "Top-up" : "Plan"}: ${pkg?.name || "package"} (${days}d window)`,
        next,
        now
      );
    const entry = db.prepare(`SELECT * FROM point_ledger WHERE id = ?`).get(Number(result.lastInsertRowid));
    const updated = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
    return { wallet: updated, entry, points: pts, isTopup };
  };

  if (!useTransaction) return run();

  db.exec("BEGIN IMMEDIATE");
  try {
    const out = run();
    db.exec("COMMIT");
    return out;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/** One-time free points for every new client (agency setting). Starts a 30-day window. */
export function grantSignupBonus(db, instanceName) {
  ensureWallet(db, instanceName);
  const wallet = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
  if (wallet?.signup_bonus_granted) {
    return { granted: false, already: true, wallet };
  }
  const settings = getAgencySettings(db);
  const pts = Math.max(0, Math.floor(Number(settings?.signup_bonus_points) || 0));
  if (!pts) {
    return { granted: false, wallet, points: 0 };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const again = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
    if (again?.signup_bonus_granted) {
      db.exec("COMMIT");
      return { granted: false, already: true, wallet: again };
    }
    expirePeriodIfNeeded(db, instanceName);
    const current = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
    const now = Date.now();
    const periodStarts = now;
    const periodEnds = now + durationMs(30);
    const next = (Number(current.balance_points) || 0) + pts;
    db.prepare(
      `UPDATE client_wallets SET balance_points = ?, period_starts_at = ?, period_ends_at = ?,
        signup_bonus_granted = 1, updated_at = ?
       WHERE instance_name = ?`
    ).run(next, periodStarts, periodEnds, now, instanceName);
    db.prepare(
      `INSERT INTO point_ledger (instance_name, direction, amount, reason, ref, note, balance_after, created_at)
       VALUES (?, 'credit', ?, 'signup_bonus', NULL, ?, ?, ?)`
    ).run(instanceName, pts, `Free signup points (${pts})`, next, now);
    const updated = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
    db.exec("COMMIT");
    return { granted: true, wallet: updated, points: pts };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function listWallets(db) {
  const names = db.prepare(`SELECT instance_name FROM client_wallets`).all();
  for (const row of names) expirePeriodIfNeeded(db, row.instance_name);
  return db
    .prepare(
      `SELECT w.*, c.display_name, c.contact_phone, c.contact_email
       FROM client_wallets w
       LEFT JOIN clients c ON c.instance_name = w.instance_name
       ORDER BY w.balance_points ASC, w.instance_name`
    )
    .all();
}

/**
 * Credit or debit points. direction: 'credit' | 'debit'
 * Returns { wallet, entry } or throws if insufficient for debit.
 */
export function applyWalletDelta(
  db,
  { instanceName, direction, amount, reason, ref = null, note = null, allowNegative = false }
) {
  const pts = Math.max(0, Math.floor(Number(amount) || 0));
  if (!pts && direction === "debit") {
    const wallet = ensureWallet(db, instanceName);
    return { wallet, entry: null, skipped: true };
  }

  ensureWallet(db, instanceName);
  db.exec("BEGIN IMMEDIATE");
  try {
    expirePeriodIfNeeded(db, instanceName);
    const wallet = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
    let next = Number(wallet.balance_points) || 0;
    if (direction === "credit") next += pts;
    else if (direction === "debit") {
      if (!allowNegative && next < pts) {
        const err = new Error("insufficient_points");
        err.code = "insufficient_points";
        err.balance = next;
        err.needed = pts;
        throw err;
      }
      next -= pts;
    } else {
      throw new Error("invalid_direction");
    }

    db.prepare(
      `UPDATE client_wallets SET balance_points = ?, updated_at = ? WHERE instance_name = ?`
    ).run(next, Date.now(), instanceName);

    const result = db
      .prepare(
        `INSERT INTO point_ledger (instance_name, direction, amount, reason, ref, note, balance_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(instanceName, direction, pts, reason, ref, note, next, Date.now());

    const entry = db.prepare(`SELECT * FROM point_ledger WHERE id = ?`).get(Number(result.lastInsertRowid));
    const updated = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(instanceName);
    db.exec("COMMIT");
    return { wallet: updated, entry };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function listLedger(db, instanceName, { limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT * FROM point_ledger WHERE instance_name = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(instanceName, limit);
}

export function markLowBalanceNotified(db, instanceName) {
  db.prepare(
    `UPDATE client_wallets SET last_low_balance_notified_at = ? WHERE instance_name = ?`
  ).run(Date.now(), instanceName);
}

export function createPaystackPayment(
  db,
  {
    reference,
    instanceName,
    packageId,
    amountGhs,
    points,
    authorizationUrl = null,
    customerEmail = null,
    prospectPhone = null,
    prospectName = null,
    saleChannel = null,
    creditInstanceName = null
  }
) {
  const result = db
    .prepare(
      `INSERT INTO paystack_payments
        (reference, instance_name, package_id, amount_ghs, points, status, authorization_url, customer_email,
         prospect_phone, prospect_name, sale_channel, credit_instance_name, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      reference,
      instanceName,
      packageId || null,
      Number(amountGhs) || 0,
      Math.floor(Number(points) || 0),
      authorizationUrl,
      customerEmail,
      prospectPhone ? String(prospectPhone).replace(/\D/g, "") || null : null,
      prospectName ? String(prospectName).slice(0, 120) : null,
      saleChannel || null,
      creditInstanceName || null,
      Date.now()
    );
  return getPaystackPayment(db, Number(result.lastInsertRowid));
}

export function getLatestOpenPaymentForProspect(db, prospectPhone) {
  const digits = String(prospectPhone || "").replace(/\D/g, "");
  if (!digits) return null;
  return (
    db
      .prepare(
        `SELECT * FROM paystack_payments
         WHERE prospect_phone = ? AND status IN ('pending', 'success_pending_credit')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(digits) || null
  );
}

function normalizePayPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function creditPaymentToInstance(db, payment, creditInstance, { paystackId = null, useTransaction = true } = {}) {
  if (useTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    const pkg = payment.package_id ? getPointPackage(db, payment.package_id) : null;
    let credited;
    if (pkg) {
      credited = creditFromPackage(db, {
        instanceName: creditInstance,
        pkg,
        reason: pkg.is_topup ? "paystack_topup" : "paystack_plan",
        ref: payment.reference,
        note: `Paystack #${payment.id}${payment.prospect_phone ? ` · prospect ${payment.prospect_phone}` : ""} · ${pkg.name}`,
        useTransaction: false
      });
    } else {
      const pts = Math.floor(Number(payment.points) || 0);
      expirePeriodIfNeeded(db, creditInstance);
      const wallet = db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(creditInstance);
      ensureWallet(db, creditInstance);
      const walletRow = wallet || db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(creditInstance);
      const now = Date.now();
      const next = (Number(walletRow.balance_points) || 0) + pts;
      let periodStarts = walletRow.period_starts_at ? Number(walletRow.period_starts_at) : null;
      let periodEnds = walletRow.period_ends_at ? Number(walletRow.period_ends_at) : null;
      if (!periodEnds || periodEnds <= now) {
        periodStarts = now;
        periodEnds = now + durationMs(30);
      }
      db.prepare(
        `UPDATE client_wallets SET balance_points = ?, period_starts_at = ?, period_ends_at = ?, updated_at = ?
         WHERE instance_name = ?`
      ).run(next, periodStarts, periodEnds, now, creditInstance);
      const result = db
        .prepare(
          `INSERT INTO point_ledger (instance_name, direction, amount, reason, ref, note, balance_after, created_at)
           VALUES (?, 'credit', ?, 'paystack_topup', ?, ?, ?, ?)`
        )
        .run(
          creditInstance,
          pts,
          payment.reference,
          `Paystack payment #${payment.id}`,
          next,
          now
        );
      credited = {
        wallet: db.prepare(`SELECT * FROM client_wallets WHERE instance_name = ?`).get(creditInstance),
        entry: db.prepare(`SELECT * FROM point_ledger WHERE id = ?`).get(Number(result.lastInsertRowid))
      };
    }
    const now = Date.now();
    db.prepare(
      `UPDATE paystack_payments SET
        status = 'success',
        paystack_id = COALESCE(?, paystack_id),
        paid_at = COALESCE(paid_at, ?),
        credit_instance_name = COALESCE(credit_instance_name, ?),
        reconciled_at = ?
       WHERE id = ?`
    ).run(paystackId, now, creditInstance, now, payment.id);
    if (useTransaction) db.exec("COMMIT");
    return {
      ok: true,
      payment: getPaystackPayment(db, payment.id),
      wallet: credited.wallet,
      entry: credited.entry,
      credited: true
    };
  } catch (error) {
    if (useTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    throw error;
  }
}

/** Apply credits for agency sales once the prospect's client instance exists. */
export function findClientByProspectPhone(db, phone) {
  const digits = normalizePayPhone(phone);
  if (!digits || digits.length < 9) return null;
  const tail = `%${digits.slice(-9)}%`;
  const byContact = db
    .prepare(
      `SELECT * FROM clients
       WHERE REPLACE(REPLACE(IFNULL(contact_phone,''), '+', ''), ' ', '') LIKE ?
          OR REPLACE(REPLACE(IFNULL(whatsapp_order_number,''), '+', ''), ' ', '') LIKE ?
       LIMIT 1`
    )
    .get(tail, tail);
  if (byContact) return byContact;

  const payment = db
    .prepare(
      `SELECT credit_instance_name FROM paystack_payments
       WHERE REPLACE(REPLACE(IFNULL(prospect_phone,''), '+', ''), ' ', '') LIKE ?
         AND credit_instance_name IS NOT NULL AND TRIM(credit_instance_name) != ''
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(tail);
  if (payment?.credit_instance_name) {
    return db.prepare(`SELECT * FROM clients WHERE instance_name = ?`).get(payment.credit_instance_name);
  }
  return null;
}

export function applyPendingProspectPayments(db, phone) {
  const digits = normalizePayPhone(phone);
  if (!digits) return [];
  const client = db
    .prepare(
      `SELECT * FROM clients
       WHERE REPLACE(REPLACE(IFNULL(contact_phone,''), '+', ''), ' ', '') LIKE ?
          OR REPLACE(REPLACE(IFNULL(whatsapp_order_number,''), '+', ''), ' ', '') LIKE ?
       LIMIT 1`
    )
    .get(`%${digits.slice(-9)}%`, `%${digits.slice(-9)}%`);
  if (!client) return [];
  const pending = db
    .prepare(
      `SELECT * FROM paystack_payments
       WHERE prospect_phone = ? AND status = 'success_pending_credit'
       ORDER BY created_at ASC`
    )
    .all(digits);
  const results = [];
  for (const payment of pending) {
    results.push(creditPaymentToInstance(db, payment, client.instance_name, { useTransaction: true }));
  }
  return results;
}

export function getPaystackPayment(db, id) {
  return db.prepare(`SELECT * FROM paystack_payments WHERE id = ?`).get(id);
}

export function getPaystackPaymentByReference(db, reference) {
  return db.prepare(`SELECT * FROM paystack_payments WHERE reference = ?`).get(reference);
}

export function listPaystackPayments(db, { limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT p.*, pkg.name AS package_name, c.display_name
       FROM paystack_payments p
       LEFT JOIN point_packages pkg ON pkg.id = p.package_id
       LEFT JOIN clients c ON c.instance_name = p.instance_name
       ORDER BY p.created_at DESC
       LIMIT ?`
    )
    .all(limit);
}

/** Idempotent: credits wallet once when payment succeeds. */
export function completePaystackPayment(db, reference, { paystackId = null } = {}) {
  const payment = getPaystackPaymentByReference(db, reference);
  if (!payment) return { ok: false, error: "not_found" };
  if (payment.status === "success") {
    return {
      ok: true,
      already: true,
      payment,
      wallet: getWallet(db, payment.credit_instance_name || payment.instance_name)
    };
  }
  if (payment.status === "success_pending_credit") {
    const target = payment.credit_instance_name;
    if (target) {
      return creditPaymentToInstance(db, payment, target, { paystackId });
    }
    return { ok: true, already: true, pendingCredit: true, payment };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const again = getPaystackPaymentByReference(db, reference);
    if (again.status === "success") {
      db.exec("COMMIT");
      return {
        ok: true,
        already: true,
        payment: again,
        wallet: getWallet(db, again.credit_instance_name || again.instance_name)
      };
    }

    const now = Date.now();
    let creditInstance = again.credit_instance_name || null;
    if (!creditInstance && again.prospect_phone) {
      const match = db
        .prepare(
          `SELECT instance_name FROM clients
           WHERE REPLACE(REPLACE(IFNULL(contact_phone,''), '+', ''), ' ', '') LIKE ?
              OR REPLACE(REPLACE(IFNULL(whatsapp_order_number,''), '+', ''), ' ', '') LIKE ?
           LIMIT 1`
        )
        .get(`%${String(again.prospect_phone).slice(-9)}%`, `%${String(again.prospect_phone).slice(-9)}%`);
      creditInstance = match?.instance_name || null;
    }
    if (!creditInstance && again.sale_channel !== "agency") {
      creditInstance = again.instance_name;
    }

    if (!creditInstance && again.sale_channel === "agency") {
      db.prepare(
        `UPDATE paystack_payments SET
          status = 'success_pending_credit',
          paystack_id = COALESCE(?, paystack_id),
          paid_at = ?
         WHERE id = ?`
      ).run(paystackId, now, again.id);
      db.exec("COMMIT");
      return {
        ok: true,
        pendingCredit: true,
        payment: getPaystackPayment(db, again.id),
        prospectPhone: again.prospect_phone
      };
    }

    db.exec("COMMIT");
    return creditPaymentToInstance(db, getPaystackPayment(db, again.id), creditInstance, {
      paystackId,
      useTransaction: true
    });
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function failPaystackPayment(db, reference) {
  db.prepare(`UPDATE paystack_payments SET status = 'failed' WHERE reference = ? AND status = 'pending'`).run(
    reference
  );
  return getPaystackPaymentByReference(db, reference);
}

export function packageTotalPoints(pkg) {
  if (!pkg) return 0;
  return Math.floor(Number(pkg.points) || 0) + Math.floor(Number(pkg.bonus_points) || 0);
}

/** Map outbound media usage to a rate key. */
export function rateKeyForAiUsage({ hasImage = false, hasAudio = false, hasVideo = false, hasDocument = false } = {}) {
  if (hasVideo) return "ai_video";
  if (hasAudio) return "ai_audio";
  if (hasDocument) return "ai_document";
  if (hasImage) return "ai_image";
  return "ai_text";
}

export function rateKeyForCampaignPart(partType) {
  if (partType === "image") return "campaign_image";
  if (partType === "pdf" || partType === "document") return "campaign_document";
  return "campaign_text";
}

export function pointsForRate(db, rateKey) {
  const rates = getPointRates(db);
  return Math.max(0, Number(rates[rateKey]) || 0);
}
