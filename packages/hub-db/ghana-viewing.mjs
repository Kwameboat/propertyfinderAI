import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { clusterKey } from "../real-estate/cluster.mjs";

export function migrateGhanaViewing(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS re_viewings (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      listing_id TEXT,
      cluster_id TEXT DEFAULT '',
      session_id TEXT DEFAULT '',
      renter_name TEXT DEFAULT '',
      renter_phone TEXT NOT NULL,
      renter_email TEXT DEFAULT '',
      agent_phone TEXT DEFAULT '',
      agent_momo TEXT DEFAULT '',
      pin_hash TEXT DEFAULT '',
      pin_expires_at INTEGER,
      status TEXT NOT NULL DEFAULT 'awaiting_payment',
      paystack_reference TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      paid_at INTEGER,
      redeemed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_re_viewings_ref ON re_viewings(paystack_reference);
    CREATE INDEX IF NOT EXISTS idx_re_viewings_phone ON re_viewings(renter_phone, status);

    CREATE TABLE IF NOT EXISTS re_ledger (
      id TEXT PRIMARY KEY,
      viewing_id TEXT,
      deal_id TEXT,
      kind TEXT NOT NULL,
      amount_ghs REAL NOT NULL,
      party TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      momo TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_re_ledger_viewing ON re_ledger(viewing_id);

    CREATE TABLE IF NOT EXISTS re_deals (
      id TEXT PRIMARY KEY,
      viewing_id TEXT NOT NULL,
      listing_id TEXT,
      agreed_amount_ghs REAL NOT NULL,
      commission_ghs REAL NOT NULL,
      platform_share_ghs REAL NOT NULL,
      agent_share_ghs REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_collection',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  for (const sql of [`ALTER TABLE re_listings ADD COLUMN cluster_id TEXT DEFAULT ''`]) {
    try {
      db.exec(sql);
    } catch {
      /* exists */
    }
  }
}

export function hashPin(pin, viewingId) {
  return createHash("sha256").update(`${viewingId}:${String(pin)}`).digest("hex");
}

export function generateViewingPin() {
  return String(100000 + (randomBytes(3).readUIntBE(0, 3) % 900000));
}

export function createViewing(db, input = {}) {
  const now = Date.now();
  const id = randomUUID();
  const listing = input.listing || {};
  db.prepare(`
    INSERT INTO re_viewings (
      id, lead_id, listing_id, cluster_id, session_id, renter_name, renter_phone,
      renter_email, agent_phone, notes, status, paystack_reference, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', ?, ?, ?)
  `).run(
    id,
    input.lead_id || null,
    input.listing_id || listing.id || null,
    input.cluster_id || listing.cluster_id || clusterKey(listing),
    input.session_id || "",
    String(input.renter_name || "").trim(),
    String(input.renter_phone || "").trim(),
    String(input.renter_email || "").trim(),
    String(input.agent_phone || listing.agent_phone || "").trim(),
    String(input.notes || "").trim(),
    String(input.paystack_reference || "").trim(),
    now,
    now
  );
  return getViewing(db, id);
}

export function getViewing(db, id) {
  return db.prepare(`SELECT * FROM re_viewings WHERE id = ?`).get(id) || null;
}

export function getViewingByReference(db, reference) {
  return db.prepare(`SELECT * FROM re_viewings WHERE paystack_reference = ?`).get(reference) || null;
}

export function listViewings(db, { status, limit = 50 } = {}) {
  if (status) {
    return db
      .prepare(`SELECT * FROM re_viewings WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
      .all(status, limit);
  }
  return db.prepare(`SELECT * FROM re_viewings ORDER BY created_at DESC LIMIT ?`).all(limit);
}

export function setViewingReference(db, id, reference) {
  db.prepare(`UPDATE re_viewings SET paystack_reference = ?, updated_at = ? WHERE id = ?`).run(
    reference,
    Date.now(),
    id
  );
  return getViewing(db, id);
}

export function markViewingPaid(db, { viewingId, pin, platformShareGhs = 50, agentShareGhs = 50 }) {
  const viewing = getViewing(db, viewingId);
  if (!viewing) throw new Error("Viewing not found");
  if (viewing.status === "paid_awaiting_viewing" || viewing.status === "completed") {
    return { viewing, already: true };
  }
  const now = Date.now();
  const pinHash = hashPin(pin, viewing.id);
  const expires = now + 48 * 60 * 60 * 1000;
  db.prepare(`
    UPDATE re_viewings SET
      status = 'paid_awaiting_viewing', pin_hash = ?, pin_expires_at = ?, paid_at = ?, updated_at = ?
    WHERE id = ?
  `).run(pinHash, expires, now, now, viewing.id);
  insertLedger(db, {
    viewing_id: viewing.id,
    kind: "viewing_fee_platform",
    amount_ghs: platformShareGhs,
    party: "platform",
    status: "settled",
    note: "GH₵50 platform share of viewing fee"
  });
  insertLedger(db, {
    viewing_id: viewing.id,
    kind: "viewing_fee_agent_hold",
    amount_ghs: agentShareGhs,
    party: "listing_agent",
    status: "held",
    note: "GH₵50 held until PIN redeemed"
  });
  return { viewing: getViewing(db, viewing.id), pin, already: false };
}

export function redeemViewingPin(db, { pin, momo = "", fromPhone = "" }) {
  const code = String(pin || "").replace(/\D/g, "");
  if (code.length !== 6) throw new Error("PIN must be 6 digits");
  const open = db
    .prepare(
      `SELECT * FROM re_viewings WHERE status = 'paid_awaiting_viewing' AND pin_hash != '' ORDER BY paid_at DESC LIMIT 80`
    )
    .all();
  const now = Date.now();
  const match = open.find((row) => {
    if (row.pin_expires_at && row.pin_expires_at < now) return false;
    const expected = Buffer.from(hashPin(code, row.id));
    const got = Buffer.from(String(row.pin_hash));
    return expected.length === got.length && timingSafeEqual(expected, got);
  });
  if (!match) throw new Error("PIN not found or already used");

  db.prepare(`
    UPDATE re_viewings SET
      status = 'completed', redeemed_at = ?, agent_momo = ?, updated_at = ?,
      agent_phone = CASE WHEN ? != '' THEN ? ELSE agent_phone END
    WHERE id = ?
  `).run(now, String(momo || "").trim(), now, fromPhone, fromPhone, match.id);

  db.prepare(`
    UPDATE re_ledger SET status = 'ready_to_payout', momo = ?, updated_at = ?, note = ?
    WHERE viewing_id = ? AND kind = 'viewing_fee_agent_hold'
  `).run(
    String(momo || "").trim(),
    now,
    "PIN redeemed — pay GH₵50 to listing agent MoMo",
    match.id
  );

  return getViewing(db, match.id);
}

export function insertLedger(db, input = {}) {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO re_ledger (id, viewing_id, deal_id, kind, amount_ghs, party, status, momo, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.viewing_id || null,
    input.deal_id || null,
    input.kind,
    Number(input.amount_ghs || 0),
    input.party,
    input.status || "pending",
    String(input.momo || "").trim(),
    String(input.note || "").trim(),
    now,
    now
  );
  return id;
}

export function createDeal(db, { viewingId, agreedAmountGhs, commissionRate = 0.1, platformSplit = 0.5 }) {
  const viewing = getViewing(db, viewingId);
  if (!viewing) throw new Error("Viewing not found");
  const agreed = Number(agreedAmountGhs);
  if (!agreed || agreed <= 0) throw new Error("agreedAmountGhs required");
  const commission = Math.round(agreed * commissionRate * 100) / 100;
  const platform = Math.round(commission * platformSplit * 100) / 100;
  const agent = Math.round((commission - platform) * 100) / 100;
  const now = Date.now();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO re_deals (
      id, viewing_id, listing_id, agreed_amount_ghs, commission_ghs,
      platform_share_ghs, agent_share_ghs, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_collection', ?, ?)
  `).run(id, viewing.id, viewing.listing_id, agreed, commission, platform, agent, now, now);
  insertLedger(db, {
    viewing_id: viewing.id,
    deal_id: id,
    kind: "deal_commission_platform",
    amount_ghs: platform,
    party: "platform",
    status: "pending",
    note: "50% of 10% deal commission"
  });
  insertLedger(db, {
    viewing_id: viewing.id,
    deal_id: id,
    kind: "deal_commission_agent",
    amount_ghs: agent,
    party: "listing_agent",
    status: "pending",
    momo: viewing.agent_momo || "",
    note: "50% of 10% deal commission"
  });
  return db.prepare(`SELECT * FROM re_deals WHERE id = ?`).get(id);
}

export function listViewingLedger(db, viewingId) {
  return db.prepare(`SELECT * FROM re_ledger WHERE viewing_id = ? ORDER BY created_at`).all(viewingId);
}

export function listDeals(db, { limit = 50 } = {}) {
  return db.prepare(`SELECT * FROM re_deals ORDER BY created_at DESC LIMIT ?`).all(limit);
}
