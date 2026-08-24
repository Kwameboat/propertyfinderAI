/**
 * Knowledge base, conversation inbox, bookings, digests, customer payments.
 */

import { createHash } from "node:crypto";
import { scheduleFollowUpJob, claimDueFollowUpJobs, completeFollowUpJob } from "./marketing.mjs";

export function migrateAgentsFeatures(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_instance ON knowledge_docs(instance_name);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      contact_id INTEGER,
      direction TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conv_instance_phone ON conversation_messages(instance_name, phone, id DESC);
    CREATE INDEX IF NOT EXISTS idx_conv_created ON conversation_messages(created_at DESC);

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      contact_id INTEGER,
      phone TEXT NOT NULL,
      customer_name TEXT,
      service_name TEXT,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER,
      status TEXT NOT NULL DEFAULT 'confirmed',
      notes TEXT DEFAULT '',
      reminder_job_id INTEGER,
      payment_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_instance ON bookings(instance_name, starts_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(instance_name, phone);

    CREATE TABLE IF NOT EXISTS customer_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_name TEXT NOT NULL,
      phone TEXT,
      contact_id INTEGER,
      amount_ghs REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GHS',
      purpose TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL UNIQUE,
      paystack_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cust_pay_instance ON customer_payments(instance_name, created_at DESC);
  `);

  const clientCols = db.prepare(`PRAGMA table_info(clients)`).all().map((c) => c.name);
  if (!clientCols.includes("digest_hour")) {
    db.exec(`ALTER TABLE clients ADD COLUMN digest_hour INTEGER`);
  }
  if (!clientCols.includes("digest_enabled")) {
    db.exec(`ALTER TABLE clients ADD COLUMN digest_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!clientCols.includes("owner_notify_phone")) {
    db.exec(`ALTER TABLE clients ADD COLUMN owner_notify_phone TEXT`);
  }
  if (!clientCols.includes("client_notify_mode")) {
    db.exec(`ALTER TABLE clients ADD COLUMN client_notify_mode TEXT NOT NULL DEFAULT 'digest'`);
  }
  if (!clientCols.includes("client_score_notify_threshold")) {
    db.exec(`ALTER TABLE clients ADD COLUMN client_score_notify_threshold INTEGER NOT NULL DEFAULT 60`);
  }
  if (!clientCols.includes("client_ops_channel")) {
    db.exec(`ALTER TABLE clients ADD COLUMN client_ops_channel TEXT NOT NULL DEFAULT 'whatsapp'`);
  }
}

export function listKnowledgeDocs(db, instanceName, { activeOnly = true } = {}) {
  if (activeOnly) {
    return db
      .prepare(
        `SELECT * FROM knowledge_docs WHERE instance_name = ? AND active = 1 ORDER BY id DESC`
      )
      .all(instanceName);
  }
  return db
    .prepare(`SELECT * FROM knowledge_docs WHERE instance_name = ? ORDER BY id DESC`)
    .all(instanceName);
}

export function upsertKnowledgeDoc(db, { instanceName, id = null, title, content, active = 1 }) {
  const now = Date.now();
  const t = String(title || "Untitled").trim().slice(0, 200) || "Untitled";
  const body = String(content || "").trim().slice(0, 20000);
  if (id) {
    db.prepare(
      `UPDATE knowledge_docs SET title = ?, content = ?, active = ?, updated_at = ? WHERE id = ? AND instance_name = ?`
    ).run(t, body, active ? 1 : 0, now, id, instanceName);
    return db.prepare(`SELECT * FROM knowledge_docs WHERE id = ?`).get(id);
  }
  const info = db
    .prepare(
      `INSERT INTO knowledge_docs (instance_name, title, content, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(instanceName, t, body, active ? 1 : 0, now, now);
  return db.prepare(`SELECT * FROM knowledge_docs WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function deleteKnowledgeDoc(db, id, instanceName) {
  db.prepare(`DELETE FROM knowledge_docs WHERE id = ? AND instance_name = ?`).run(id, instanceName);
}

export function formatKnowledgeForAgent(db, instanceName, { maxChars = 3500 } = {}) {
  const docs = listKnowledgeDocs(db, instanceName, { activeOnly: true });
  if (!docs.length) return "";
  const lines = ["KNOWLEDGE BASE (use only this for facts; say if unknown):"];
  let used = lines[0].length;
  for (const doc of docs) {
    const chunk = `\n### ${doc.title}\n${String(doc.content || "").slice(0, 1200)}`;
    if (used + chunk.length > maxChars) break;
    lines.push(chunk);
    used += chunk.length;
  }
  return lines.join("\n");
}

export function addConversationMessage(
  db,
  { instanceName, phone, contactId = null, direction, role, body, meta = {} }
) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!instanceName || !digits || !body) return null;
  const info = db
    .prepare(
      `INSERT INTO conversation_messages
        (instance_name, phone, contact_id, direction, role, body, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      instanceName,
      digits,
      contactId,
      direction === "out" ? "out" : "in",
      role || (direction === "out" ? "assistant" : "customer"),
      String(body).slice(0, 4000),
      JSON.stringify(meta || {}),
      Date.now()
    );
  return Number(info.lastInsertRowid);
}

export function listInboxThreads(db, instanceName, { limit = 40 } = {}) {
  return db
    .prepare(
      `SELECT c.phone, c.push_name, c.handoff_status, c.notes, c.last_inbound_at, c.last_outbound_at,
              c.last_inbound_text, c.id AS contact_id,
              c.qualification_score, c.qualification_summary,
              (SELECT body FROM conversation_messages m
               WHERE m.instance_name = c.instance_name AND m.phone = c.phone
               ORDER BY m.id DESC LIMIT 1) AS last_body
       FROM contacts c
       WHERE c.instance_name = ?
       ORDER BY COALESCE(c.last_inbound_at, c.last_outbound_at, 0) DESC
       LIMIT ?`
    )
    .all(instanceName, Math.max(1, Math.min(100, Number(limit) || 40)));
}

export function listConversationMessages(db, instanceName, phone, { limit = 80 } = {}) {
  const digits = String(phone || "").replace(/\D/g, "");
  const rows = db
    .prepare(
      `SELECT * FROM conversation_messages
       WHERE instance_name = ? AND phone = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(instanceName, digits, Math.max(1, Math.min(200, Number(limit) || 80)));
  return rows.reverse();
}

export function createBooking(
  db,
  {
    instanceName,
    phone,
    contactId = null,
    customerName = "",
    serviceName = "",
    startsAt,
    endsAt = null,
    notes = ""
  }
) {
  const digits = String(phone || "").replace(/\D/g, "");
  const start = Number(startsAt);
  if (!instanceName || !digits || !start) return null;
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO bookings (
         instance_name, contact_id, phone, customer_name, service_name,
         starts_at, ends_at, status, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
    )
    .run(
      instanceName,
      contactId,
      digits,
      customerName || null,
      serviceName || null,
      start,
      endsAt ? Number(endsAt) : null,
      notes || "",
      now,
      now
    );
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(Number(info.lastInsertRowid));

  // Reminder 24h before (or 1h if booking is sooner than 24h)
  const leadMs = 24 * 60 * 60 * 1000;
  let dueAt = start - leadMs;
  if (dueAt < now + 5 * 60 * 1000) {
    dueAt = Math.max(now + 5 * 60 * 1000, start - 60 * 60 * 1000);
  }
  if (dueAt < start) {
    const job = scheduleFollowUpJob(db, {
      contactId,
      instanceName,
      phone: digits,
      dueAt,
      kind: "booking_reminder",
      maxAttempts: 1,
      idempotencyKey: `booking_reminder:${booking.id}`
    });
    if (job?.id) {
      db.prepare(`UPDATE bookings SET reminder_job_id = ?, updated_at = ? WHERE id = ?`).run(
        job.id,
        now,
        booking.id
      );
    }
  }
  return db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(booking.id);
}

export function listBookings(db, instanceName, { limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT * FROM bookings WHERE instance_name = ? ORDER BY starts_at DESC LIMIT ?`
    )
    .all(instanceName, Math.max(1, Math.min(100, Number(limit) || 50)));
}

export function getBooking(db, id) {
  return db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(id);
}

export function updateBookingStatus(db, id, status) {
  db.prepare(`UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    Date.now(),
    id
  );
  return getBooking(db, id);
}

export function createCustomerPayment(
  db,
  { instanceName, phone = null, contactId = null, amountGhs, purpose = "", paystackUrl = null, reference }
) {
  const now = Date.now();
  const ref =
    reference ||
    `cust_${createHash("sha256").update(`${instanceName}:${amountGhs}:${now}:${Math.random()}`).digest("hex").slice(0, 16)}`;
  const info = db
    .prepare(
      `INSERT INTO customer_payments (
         instance_name, phone, contact_id, amount_ghs, purpose, reference, paystack_url, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(
      instanceName,
      phone ? String(phone).replace(/\D/g, "") : null,
      contactId,
      Number(amountGhs),
      String(purpose || "").slice(0, 200),
      ref,
      paystackUrl,
      now,
      now
    );
  return db.prepare(`SELECT * FROM customer_payments WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function getCustomerPaymentByReference(db, reference) {
  return db.prepare(`SELECT * FROM customer_payments WHERE reference = ?`).get(reference);
}

export function markCustomerPaymentPaid(db, reference) {
  db.prepare(
    `UPDATE customer_payments SET status = 'paid', updated_at = ? WHERE reference = ?`
  ).run(Date.now(), reference);
  return getCustomerPaymentByReference(db, reference);
}

export function buildOwnerDigestText(db, instanceName) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const inbound = db
    .prepare(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE instance_name = ? AND direction = 'in' AND created_at >= ?`
    )
    .get(instanceName, since)?.n || 0;
  const outbound = db
    .prepare(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE instance_name = ? AND direction = 'out' AND created_at >= ?`
    )
    .get(instanceName, since)?.n || 0;
  const handoffs = db
    .prepare(
      `SELECT COUNT(*) AS n FROM lead_assignments
       WHERE instance_name = ? AND created_at >= ?`
    )
    .get(instanceName, since)?.n || 0;
  const bookings = db
    .prepare(
      `SELECT COUNT(*) AS n FROM bookings
       WHERE instance_name = ? AND created_at >= ?`
    )
    .get(instanceName, since)?.n || 0;
  const openHuman = db
    .prepare(
      `SELECT COUNT(*) AS n FROM contacts
       WHERE instance_name = ? AND handoff_status IN ('unassigned','assigned','human_active')`
    )
    .get(instanceName)?.n || 0;

  return [
    `Daily digest for ${instanceName}`,
    `Last 24h: ${inbound} inbound · ${outbound} AI/outbound · ${handoffs} handoffs · ${bookings} bookings`,
    `Needs attention now: ${openHuman} chats with human ownership`,
    "Open Hub Inbox for details."
  ].join("\n");
}

export function ensureOwnerDigestJobs(db, { hourLocal = null } = {}) {
  const clients = db
    .prepare(
      `SELECT instance_name, owner_notify_phone, contact_phone, digest_enabled, digest_hour
       FROM clients WHERE digest_enabled = 1`
    )
    .all();
  const now = new Date();
  const scheduled = [];
  for (const c of clients) {
    const phone = String(c.owner_notify_phone || c.contact_phone || "").replace(/\D/g, "");
    if (!phone) continue;
    const hour = c.digest_hour != null ? Number(c.digest_hour) : hourLocal != null ? hourLocal : 8;
    const due = new Date(now);
    due.setHours(hour, 0, 0, 0);
    if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
    const dayKey = due.toISOString().slice(0, 10);
    const job = scheduleFollowUpJob(db, {
      instanceName: c.instance_name,
      phone,
      dueAt: due.getTime(),
      kind: "owner_digest",
      maxAttempts: 1,
      idempotencyKey: `owner_digest:${c.instance_name}:${dayKey}`
    });
    if (job) scheduled.push(job);
  }
  return scheduled;
}

export { claimDueFollowUpJobs, completeFollowUpJob };
