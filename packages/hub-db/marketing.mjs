/**
 * Proactive marketing leads, audit events, and follow-up jobs.
 */

export function migrateMarketing(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketing_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web_search',
      source_url TEXT,
      platform TEXT,
      ad_text TEXT DEFAULT '',
      business_name TEXT,
      whatsapp_phone TEXT,
      website TEXT,
      industry TEXT,
      location TEXT DEFAULT 'Ghana',
      score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'discovered',
      fingerprint TEXT NOT NULL,
      research_summary TEXT DEFAULT '',
      research_json TEXT DEFAULT '{}',
      draft_message TEXT DEFAULT '',
      telegram_chat_id TEXT,
      telegram_message_id TEXT,
      contact_id INTEGER,
      approved_by TEXT,
      approved_at INTEGER,
      sent_at INTEGER,
      last_reply_at INTEGER,
      blocked_reason TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(instance_name, fingerprint)
    );

    CREATE INDEX IF NOT EXISTS idx_mkt_leads_status ON marketing_leads(status);
    CREATE INDEX IF NOT EXISTS idx_mkt_leads_phone ON marketing_leads(whatsapp_phone);
    CREATE INDEX IF NOT EXISTS idx_mkt_leads_instance ON marketing_leads(instance_name);
    CREATE INDEX IF NOT EXISTS idx_mkt_leads_score ON marketing_leads(score DESC);

    CREATE TABLE IF NOT EXISTS marketing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      event_type TEXT NOT NULL,
      detail TEXT DEFAULT '',
      meta_json TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES marketing_leads(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mkt_events_lead ON marketing_events(lead_id);
    CREATE INDEX IF NOT EXISTS idx_mkt_events_type ON marketing_events(event_type);

    CREATE TABLE IF NOT EXISTS follow_up_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      contact_id INTEGER,
      instance_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      kind TEXT NOT NULL DEFAULT 'marketing_followup',
      due_at INTEGER NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT NOT NULL UNIQUE,
      last_error TEXT,
      claimed_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES marketing_leads(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_followups_due ON follow_up_jobs(status, due_at);
    CREATE INDEX IF NOT EXISTS idx_followups_phone ON follow_up_jobs(instance_name, phone);
  `);
}

export function normalizeGhanaPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith("0") === false) {
    // local without leading 0: 24xxxxxxx
    digits = `233${digits}`;
  } else if (digits.length === 10 && digits.startsWith("0")) {
    digits = `233${digits.slice(1)}`;
  } else if (digits.startsWith("2330") && digits.length === 13) {
    digits = `233${digits.slice(4)}`;
  }
  if (!/^233\d{9}$/.test(digits)) return digits.length >= 10 ? digits : "";
  return digits;
}

export function extractWhatsappPhoneFromText(text) {
  const raw = String(text || "");
  const waMe = raw.match(
    /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send)\??(?:phone=)?(\+?\d{8,15})/i
  );
  if (waMe?.[1]) {
    const n = normalizeGhanaPhone(waMe[1]);
    if (n) return n;
  }
  const phoneMatch = raw.match(/(?:\+?233|0)\s*\d[\d\s-]{7,14}\d/);
  if (phoneMatch) {
    const n = normalizeGhanaPhone(phoneMatch[0]);
    if (n) return n;
  }
  return "";
}

export function makeLeadFingerprint({ whatsappPhone = "", sourceUrl = "", businessName = "" } = {}) {
  const phone = normalizeGhanaPhone(whatsappPhone);
  if (phone) return `phone:${phone}`;
  try {
    const u = new URL(String(sourceUrl || "").trim());
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    if (host) return `url:${host}${path}`;
  } catch {
    /* ignore */
  }
  const name = String(businessName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return name ? `name:${name}` : `anon:${Date.now()}`;
}

export function addMarketingEvent(db, { leadId = null, eventType, detail = "", meta = null }) {
  db.prepare(
    `INSERT INTO marketing_events (lead_id, event_type, detail, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    leadId,
    String(eventType || "unknown"),
    String(detail || "").slice(0, 2000),
    JSON.stringify(meta || {}),
    Date.now()
  );
}

export function getMarketingLead(db, id) {
  return db.prepare(`SELECT * FROM marketing_leads WHERE id = ?`).get(id) || null;
}

export function getMarketingLeadByFingerprint(db, instanceName, fingerprint) {
  return db
    .prepare(`SELECT * FROM marketing_leads WHERE instance_name = ? AND fingerprint = ?`)
    .get(instanceName, fingerprint) || null;
}

export function getMarketingLeadByPhone(db, instanceName, phone) {
  const digits = normalizeGhanaPhone(phone);
  if (!digits) return null;
  return (
    db
      .prepare(
        `SELECT * FROM marketing_leads
         WHERE instance_name = ? AND whatsapp_phone = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(instanceName, digits) || null
  );
}

export function listMarketingLeads(
  db,
  { instanceName = null, status = null, limit = 50, offset = 0 } = {}
) {
  const clauses = [];
  const params = [];
  if (instanceName) {
    clauses.push(`instance_name = ?`);
    params.push(instanceName);
  }
  if (status) {
    clauses.push(`status = ?`);
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(Math.max(1, Math.min(200, Number(limit) || 50)));
  params.push(Math.max(0, Number(offset) || 0));
  return db
    .prepare(
      `SELECT * FROM marketing_leads ${where}
       ORDER BY
         CASE status
           WHEN 'queued' THEN 0
           WHEN 'researched' THEN 1
           WHEN 'discovered' THEN 2
           ELSE 3
         END,
         score DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params);
}

export function countMarketingSendsToday(db, instanceName) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM marketing_leads
       WHERE instance_name = ? AND sent_at IS NOT NULL AND sent_at >= ?`
    )
    .get(instanceName, start.getTime());
  return Number(row?.n || 0);
}

export function wasPhoneContactedRecently(db, instanceName, phone, cooldownMs) {
  const digits = normalizeGhanaPhone(phone);
  if (!digits) return false;
  const since = Date.now() - Math.max(0, Number(cooldownMs) || 0);
  const row = db
    .prepare(
      `SELECT id FROM marketing_leads
       WHERE instance_name = ? AND whatsapp_phone = ?
         AND (
           status IN ('blocked','sent','replied','converted','approved')
           OR (sent_at IS NOT NULL AND sent_at >= ?)
         )
       ORDER BY id DESC LIMIT 1`
    )
    .get(instanceName, digits, since);
  return Boolean(row);
}

/**
 * Insert or refresh a discovered lead. Returns { lead, created }.
 * Does not overwrite terminal statuses (sent/replied/blocked/converted).
 */
export function upsertMarketingLead(
  db,
  {
    instanceName,
    source = "web_search",
    sourceUrl = null,
    platform = null,
    adText = "",
    businessName = null,
    whatsappPhone = null,
    website = null,
    industry = null,
    location = "Ghana",
    score = 0,
    fingerprint = null,
    researchSummary = null,
    researchJson = null,
    draftMessage = null,
    status = "discovered"
  }
) {
  const phone = normalizeGhanaPhone(whatsappPhone);
  const fp =
    fingerprint ||
    makeLeadFingerprint({
      whatsappPhone: phone,
      sourceUrl,
      businessName
    });
  const now = Date.now();
  const existing = getMarketingLeadByFingerprint(db, instanceName, fp);
  if (existing) {
    const terminal = new Set(["sent", "replied", "converted", "blocked", "approved"]);
    if (terminal.has(existing.status)) {
      return { lead: existing, created: false, skipped: existing.status };
    }
    db.prepare(
      `UPDATE marketing_leads SET
         source = COALESCE(?, source),
         source_url = COALESCE(?, source_url),
         platform = COALESCE(?, platform),
         ad_text = CASE WHEN ? != '' THEN ? ELSE ad_text END,
         business_name = COALESCE(?, business_name),
         whatsapp_phone = COALESCE(?, whatsapp_phone),
         website = COALESCE(?, website),
         industry = COALESCE(?, industry),
         location = COALESCE(?, location),
         score = CASE WHEN ? > score THEN ? ELSE score END,
         research_summary = COALESCE(?, research_summary),
         research_json = COALESCE(?, research_json),
         draft_message = COALESCE(?, draft_message),
         status = CASE
           WHEN status IN ('discovered','researched','queued','skipped') THEN ?
           ELSE status
         END,
         updated_at = ?
       WHERE id = ?`
    ).run(
      source || null,
      sourceUrl || null,
      platform || null,
      String(adText || ""),
      String(adText || ""),
      businessName || null,
      phone || null,
      website || null,
      industry || null,
      location || null,
      Number(score) || 0,
      Number(score) || 0,
      researchSummary || null,
      researchJson ? JSON.stringify(researchJson) : null,
      draftMessage || null,
      status || existing.status,
      now,
      existing.id
    );
    const lead = getMarketingLead(db, existing.id);
    addMarketingEvent(db, {
      leadId: lead.id,
      eventType: "updated",
      detail: `Refreshed lead (${lead.status})`
    });
    return { lead, created: false };
  }

  const info = db
    .prepare(
      `INSERT INTO marketing_leads (
         instance_name, source, source_url, platform, ad_text, business_name,
         whatsapp_phone, website, industry, location, score, status, fingerprint,
         research_summary, research_json, draft_message, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      instanceName,
      source,
      sourceUrl || null,
      platform || null,
      String(adText || "").slice(0, 4000),
      businessName || null,
      phone || null,
      website || null,
      industry || null,
      location || "Ghana",
      Number(score) || 0,
      status || "discovered",
      fp,
      researchSummary || "",
      JSON.stringify(researchJson || {}),
      draftMessage || "",
      now,
      now
    );
  const lead = getMarketingLead(db, Number(info.lastInsertRowid));
  addMarketingEvent(db, {
    leadId: lead.id,
    eventType: "discovered",
    detail: `Discovered via ${source}`
  });
  return { lead, created: true };
}

export function updateMarketingLead(db, id, patch = {}) {
  const existing = getMarketingLead(db, id);
  if (!existing) return null;
  const map = {
    sourceUrl: "source_url",
    platform: "platform",
    adText: "ad_text",
    businessName: "business_name",
    whatsappPhone: "whatsapp_phone",
    website: "website",
    industry: "industry",
    location: "location",
    score: "score",
    status: "status",
    researchSummary: "research_summary",
    researchJson: "research_json",
    draftMessage: "draft_message",
    telegramChatId: "telegram_chat_id",
    telegramMessageId: "telegram_message_id",
    contactId: "contact_id",
    approvedBy: "approved_by",
    approvedAt: "approved_at",
    sentAt: "sent_at",
    lastReplyAt: "last_reply_at",
    blockedReason: "blocked_reason",
    error: "error"
  };
  const sets = [];
  const vals = [];
  for (const [key, col] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    let value = patch[key];
    if (key === "whatsappPhone") value = normalizeGhanaPhone(value) || null;
    if (key === "researchJson") value = JSON.stringify(value || {});
    if (key === "adText" || key === "draftMessage" || key === "researchSummary") {
      value = String(value ?? "");
    }
    sets.push(`${col} = ?`);
    vals.push(value);
  }
  if (!sets.length) return existing;
  sets.push(`updated_at = ?`);
  vals.push(Date.now(), id);
  db.prepare(`UPDATE marketing_leads SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getMarketingLead(db, id);
}

/**
 * Atomically claim a lead for approval action (approve/skip/block/regenerate).
 * Returns the lead if claim succeeded, else null.
 */
export function claimMarketingLeadAction(db, leadId, fromStatuses, toStatus) {
  const now = Date.now();
  const placeholders = fromStatuses.map(() => "?").join(",");
  const info = db
    .prepare(
      `UPDATE marketing_leads
       SET status = ?, updated_at = ?
       WHERE id = ? AND status IN (${placeholders})`
    )
    .run(toStatus, now, leadId, ...fromStatuses);
  if (!info.changes) return null;
  return getMarketingLead(db, leadId);
}

export function approveMarketingLead(db, leadId, { approvedBy, contactId = null } = {}) {
  const now = Date.now();
  const info = db
    .prepare(
      `UPDATE marketing_leads
       SET status = 'approved',
           approved_by = ?,
           approved_at = ?,
           contact_id = COALESCE(?, contact_id),
           updated_at = ?,
           error = NULL
       WHERE id = ? AND status IN ('queued','researched','discovered','approved')`
    )
    .run(String(approvedBy || "telegram"), now, contactId, now, leadId);
  if (!info.changes) return null;
  const lead = getMarketingLead(db, leadId);
  addMarketingEvent(db, {
    leadId,
    eventType: "approved",
    detail: `Approved by ${approvedBy || "unknown"}`
  });
  return lead;
}

export function markMarketingLeadSent(db, leadId, { contactId = null } = {}) {
  const now = Date.now();
  const info = db
    .prepare(
      `UPDATE marketing_leads
       SET status = 'sent',
           sent_at = ?,
           contact_id = COALESCE(?, contact_id),
           updated_at = ?,
           error = NULL
       WHERE id = ? AND status IN ('approved','sent')`
    )
    .run(now, contactId, now, leadId);
  if (!info.changes) return null;
  const lead = getMarketingLead(db, leadId);
  addMarketingEvent(db, { leadId, eventType: "sent", detail: "WhatsApp outreach sent" });
  return lead;
}

export function markMarketingLeadSkipped(db, leadId, reason = "skipped") {
  const lead = claimMarketingLeadAction(
    db,
    leadId,
    ["queued", "researched", "discovered"],
    "skipped"
  );
  if (!lead) return null;
  updateMarketingLead(db, leadId, { blockedReason: reason });
  addMarketingEvent(db, { leadId, eventType: "skipped", detail: reason });
  return getMarketingLead(db, leadId);
}

export function markMarketingLeadBlocked(db, leadId, reason = "blocked") {
  const now = Date.now();
  const info = db
    .prepare(
      `UPDATE marketing_leads
       SET status = 'blocked', blocked_reason = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(String(reason || "blocked").slice(0, 500), now, leadId);
  if (!info.changes) return null;
  addMarketingEvent(db, { leadId, eventType: "blocked", detail: reason });
  cancelFollowUpsForLead(db, leadId, "blocked");
  return getMarketingLead(db, leadId);
}

export function markMarketingLeadReplied(db, leadId) {
  const now = Date.now();
  db.prepare(
    `UPDATE marketing_leads
     SET status = CASE WHEN status IN ('converted','blocked') THEN status ELSE 'replied' END,
         last_reply_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(now, now, leadId);
  addMarketingEvent(db, { leadId, eventType: "replied", detail: "Inbound reply received" });
  cancelFollowUpsForLead(db, leadId, "replied");
  return getMarketingLead(db, leadId);
}

export function scheduleFollowUpJob(
  db,
  {
    leadId = null,
    contactId = null,
    instanceName,
    phone,
    dueAt,
    kind = "marketing_followup",
    maxAttempts = 1,
    idempotencyKey
  }
) {
  const digits = normalizeGhanaPhone(phone) || String(phone || "").replace(/\D/g, "");
  if (!instanceName || !digits || !dueAt) return null;
  const key =
    idempotencyKey ||
    `${kind}:${instanceName}:${digits}:${leadId || 0}:${Math.floor(Number(dueAt) / 60000)}`;
  const now = Date.now();
  try {
    const info = db
      .prepare(
        `INSERT INTO follow_up_jobs (
           lead_id, contact_id, instance_name, phone, channel, kind,
           due_at, attempt, max_attempts, status, idempotency_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'whatsapp', ?, ?, 0, ?, 'pending', ?, ?, ?)`
      )
      .run(
        leadId,
        contactId,
        instanceName,
        digits,
        kind,
        Number(dueAt),
        Math.max(1, Number(maxAttempts) || 1),
        key,
        now,
        now
      );
    return db.prepare(`SELECT * FROM follow_up_jobs WHERE id = ?`).get(Number(info.lastInsertRowid));
  } catch {
    return db.prepare(`SELECT * FROM follow_up_jobs WHERE idempotency_key = ?`).get(key) || null;
  }
}

export function claimDueFollowUpJobs(db, { limit = 5, now = Date.now(), kinds = null } = {}) {
  const kindList = Array.isArray(kinds) ? kinds.filter(Boolean) : null;
  let rows;
  if (kindList?.length) {
    const placeholders = kindList.map(() => "?").join(",");
    rows = db
      .prepare(
        `SELECT id FROM follow_up_jobs
         WHERE status = 'pending' AND due_at <= ? AND kind IN (${placeholders})
         ORDER BY due_at ASC LIMIT ?`
      )
      .all(now, ...kindList, Math.max(1, Math.min(20, Number(limit) || 5)));
  } else {
    rows = db
      .prepare(
        `SELECT id FROM follow_up_jobs
         WHERE status = 'pending' AND due_at <= ?
         ORDER BY due_at ASC LIMIT ?`
      )
      .all(now, Math.max(1, Math.min(20, Number(limit) || 5)));
  }
  const claimed = [];
  for (const row of rows) {
    const info = db
      .prepare(
        `UPDATE follow_up_jobs
         SET status = 'claimed', claimed_at = ?, attempt = attempt + 1, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(now, now, row.id);
    if (info.changes) {
      claimed.push(db.prepare(`SELECT * FROM follow_up_jobs WHERE id = ?`).get(row.id));
    }
  }
  return claimed;
}

export function completeFollowUpJob(db, jobId, { status = "done", error = null } = {}) {
  const now = Date.now();
  db.prepare(
    `UPDATE follow_up_jobs
     SET status = ?, last_error = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(status, error, now, now, jobId);
  return db.prepare(`SELECT * FROM follow_up_jobs WHERE id = ?`).get(jobId);
}

export function cancelFollowUpsForLead(db, leadId, reason = "cancelled") {
  const now = Date.now();
  db.prepare(
    `UPDATE follow_up_jobs
     SET status = 'cancelled', last_error = ?, completed_at = ?, updated_at = ?
     WHERE lead_id = ? AND status IN ('pending','claimed')`
  ).run(String(reason).slice(0, 500), now, now, leadId);
}

export function cancelFollowUpsForPhone(db, instanceName, phone, reason = "cancelled") {
  const digits = normalizeGhanaPhone(phone) || String(phone || "").replace(/\D/g, "");
  if (!digits) return;
  const now = Date.now();
  db.prepare(
    `UPDATE follow_up_jobs
     SET status = 'cancelled', last_error = ?, completed_at = ?, updated_at = ?
     WHERE instance_name = ? AND phone = ? AND status IN ('pending','claimed')`
  ).run(String(reason).slice(0, 500), now, now, instanceName, digits);
}

export function getMarketingStats(db, instanceName) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM marketing_leads
       WHERE instance_name = ?
       GROUP BY status`
    )
    .all(instanceName);
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const pendingFollowups = db
    .prepare(
      `SELECT COUNT(*) AS n FROM follow_up_jobs
       WHERE instance_name = ? AND status = 'pending'`
    )
    .get(instanceName)?.n;
  return {
    byStatus,
    sentToday: countMarketingSendsToday(db, instanceName),
    pendingFollowups: Number(pendingFollowups || 0)
  };
}
