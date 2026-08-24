/**
 * Personal Assistant — memory, tasks, docs/RAG chunks, chat log.
 */

export function migratePa(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pa_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      role TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'pa',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pa_messages_owner ON pa_messages(owner_id, id DESC);

    CREATE TABLE IF NOT EXISTS pa_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(owner_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_pa_memories_owner ON pa_memories(owner_id);

    CREATE TABLE IF NOT EXISTS pa_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      due_at INTEGER,
      remind_at INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      recurrence TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pa_tasks_owner ON pa_tasks(owner_id, status);
    CREATE INDEX IF NOT EXISTS idx_pa_tasks_remind ON pa_tasks(status, remind_at);

    CREATE TABLE IF NOT EXISTS pa_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      char_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pa_docs_owner ON pa_docs(owner_id, active);

    CREATE TABLE IF NOT EXISTS pa_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      owner_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(doc_id) REFERENCES pa_docs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pa_chunks_owner ON pa_chunks(owner_id);
    CREATE INDEX IF NOT EXISTS idx_pa_chunks_doc ON pa_chunks(doc_id);

    CREATE TABLE IF NOT EXISTS pa_settings (
      owner_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'pa',
      daily_brief_enabled INTEGER NOT NULL DEFAULT 1,
      last_brief_day TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pa_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT,
      event_type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
  `);
}

export function addPaEvent(db, { ownerId = null, eventType, detail = "" }) {
  db.prepare(
    `INSERT INTO pa_events (owner_id, event_type, detail, created_at) VALUES (?, ?, ?, ?)`
  ).run(ownerId ? String(ownerId) : null, String(eventType), String(detail).slice(0, 2000), Date.now());
}

export function addPaMessage(db, { ownerId, role, body, mode = "pa" }) {
  db.prepare(
    `INSERT INTO pa_messages (owner_id, role, body, mode, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(String(ownerId), String(role), String(body || "").slice(0, 8000), String(mode || "pa"), Date.now());
}

export function listPaMessages(db, ownerId, { limit = 24 } = {}) {
  const rows = db
    .prepare(
      `SELECT * FROM pa_messages WHERE owner_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(String(ownerId), Math.max(1, Math.min(80, Number(limit) || 24)));
  return rows.reverse();
}

export function upsertPaMemory(db, { ownerId, key, value, tags = "" }) {
  const now = Date.now();
  const k = String(key || "").trim().slice(0, 120) || "note";
  const v = String(value || "").trim().slice(0, 4000);
  const existing = db
    .prepare(`SELECT id FROM pa_memories WHERE owner_id = ? AND key = ?`)
    .get(String(ownerId), k);
  if (existing) {
    db.prepare(
      `UPDATE pa_memories SET value = ?, tags = ?, updated_at = ? WHERE id = ?`
    ).run(v, String(tags || "").slice(0, 200), now, existing.id);
    return db.prepare(`SELECT * FROM pa_memories WHERE id = ?`).get(existing.id);
  }
  const info = db
    .prepare(
      `INSERT INTO pa_memories (owner_id, key, value, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(String(ownerId), k, v, String(tags || "").slice(0, 200), now, now);
  return db.prepare(`SELECT * FROM pa_memories WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function listPaMemories(db, ownerId, { limit = 40 } = {}) {
  return db
    .prepare(
      `SELECT * FROM pa_memories WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?`
    )
    .all(String(ownerId), Math.max(1, Math.min(100, Number(limit) || 40)));
}

export function searchPaMemories(db, ownerId, query, { limit = 8 } = {}) {
  const q = `%${String(query || "").trim().slice(0, 80)}%`;
  if (q === "%%") return listPaMemories(db, ownerId, { limit });
  return db
    .prepare(
      `SELECT * FROM pa_memories
       WHERE owner_id = ? AND (key LIKE ? OR value LIKE ? OR tags LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(String(ownerId), q, q, q, Math.max(1, Math.min(20, Number(limit) || 8)));
}

export function deletePaMemory(db, ownerId, key) {
  return db
    .prepare(`DELETE FROM pa_memories WHERE owner_id = ? AND key = ?`)
    .run(String(ownerId), String(key).trim());
}

export function createPaTask(db, {
  ownerId,
  title,
  notes = "",
  dueAt = null,
  remindAt = null,
  recurrence = "",
  telegramChatId = null
}) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO pa_tasks (
        owner_id, title, notes, due_at, remind_at, status, recurrence,
        telegram_chat_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
    )
    .run(
      String(ownerId),
      String(title || "").trim().slice(0, 300) || "Task",
      String(notes || "").slice(0, 2000),
      dueAt || null,
      remindAt || dueAt || null,
      String(recurrence || "").slice(0, 40),
      telegramChatId ? String(telegramChatId) : null,
      now,
      now
    );
  return db.prepare(`SELECT * FROM pa_tasks WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function listPaTasks(db, ownerId, { status = "open", limit = 30 } = {}) {
  if (status === "all") {
    return db
      .prepare(`SELECT * FROM pa_tasks WHERE owner_id = ? ORDER BY COALESCE(due_at, created_at) ASC LIMIT ?`)
      .all(String(ownerId), Math.max(1, Math.min(100, Number(limit) || 30)));
  }
  return db
    .prepare(
      `SELECT * FROM pa_tasks WHERE owner_id = ? AND status = ? ORDER BY COALESCE(due_at, created_at) ASC LIMIT ?`
    )
    .all(String(ownerId), String(status), Math.max(1, Math.min(100, Number(limit) || 30)));
}

export function getPaTask(db, id) {
  return db.prepare(`SELECT * FROM pa_tasks WHERE id = ?`).get(Number(id)) || null;
}

export function completePaTask(db, id) {
  const now = Date.now();
  db.prepare(
    `UPDATE pa_tasks SET status = 'done', completed_at = ?, updated_at = ?, remind_at = NULL WHERE id = ?`
  ).run(now, now, Number(id));
  return getPaTask(db, id);
}

export function cancelPaTask(db, id) {
  const now = Date.now();
  db.prepare(
    `UPDATE pa_tasks SET status = 'cancelled', updated_at = ?, remind_at = NULL WHERE id = ?`
  ).run(now, Number(id));
  return getPaTask(db, id);
}

export function claimDuePaReminders(db, { limit = 10 } = {}) {
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT id FROM pa_tasks
       WHERE status = 'open' AND remind_at IS NOT NULL AND remind_at <= ?
       ORDER BY remind_at ASC LIMIT ?`
    )
    .all(now, Math.max(1, Math.min(30, Number(limit) || 10)));
  const claimed = [];
  for (const row of rows) {
    // Clear remind_at so we don't double-fire; keep due_at for listing
    db.prepare(`UPDATE pa_tasks SET remind_at = NULL, updated_at = ? WHERE id = ? AND status = 'open'`).run(
      now,
      row.id
    );
    const task = getPaTask(db, row.id);
    if (task) claimed.push(task);
  }
  return claimed;
}

export function createPaDoc(db, { ownerId, title, sourcePath = "", mime = "", charCount = 0 }) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO pa_docs (owner_id, title, source_path, mime, char_count, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      String(ownerId),
      String(title || "Untitled").slice(0, 200),
      String(sourcePath || ""),
      String(mime || "").slice(0, 80),
      Number(charCount) || 0,
      now,
      now
    );
  return db.prepare(`SELECT * FROM pa_docs WHERE id = ?`).get(Number(info.lastInsertRowid));
}

export function listPaDocs(db, ownerId, { activeOnly = true } = {}) {
  if (activeOnly) {
    return db
      .prepare(`SELECT * FROM pa_docs WHERE owner_id = ? AND active = 1 ORDER BY id DESC`)
      .all(String(ownerId));
  }
  return db.prepare(`SELECT * FROM pa_docs WHERE owner_id = ? ORDER BY id DESC`).all(String(ownerId));
}

export function deactivatePaDoc(db, ownerId, docId) {
  db.prepare(`UPDATE pa_docs SET active = 0, updated_at = ? WHERE id = ? AND owner_id = ?`).run(
    Date.now(),
    Number(docId),
    String(ownerId)
  );
  return db.prepare(`SELECT * FROM pa_docs WHERE id = ?`).get(Number(docId));
}

export function replacePaChunks(db, { docId, ownerId, chunks }) {
  db.prepare(`DELETE FROM pa_chunks WHERE doc_id = ?`).run(Number(docId));
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO pa_chunks (doc_id, owner_id, chunk_index, text, embedding_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  let i = 0;
  for (const ch of chunks || []) {
    insert.run(
      Number(docId),
      String(ownerId),
      i++,
      String(ch.text || "").slice(0, 4000),
      JSON.stringify(ch.embedding || []),
      now
    );
  }
  return i;
}

export function listPaChunks(db, ownerId) {
  return db
    .prepare(
      `SELECT c.*, d.title AS doc_title, d.active AS doc_active
       FROM pa_chunks c
       JOIN pa_docs d ON d.id = c.doc_id
       WHERE c.owner_id = ? AND d.active = 1`
    )
    .all(String(ownerId));
}

export function getPaSettings(db, ownerId) {
  const row = db.prepare(`SELECT * FROM pa_settings WHERE owner_id = ?`).get(String(ownerId));
  if (row) return row;
  const now = Date.now();
  db.prepare(
    `INSERT INTO pa_settings (owner_id, mode, daily_brief_enabled, last_brief_day, updated_at)
     VALUES (?, 'pa', 1, '', ?)`
  ).run(String(ownerId), now);
  return db.prepare(`SELECT * FROM pa_settings WHERE owner_id = ?`).get(String(ownerId));
}

export function updatePaSettings(db, ownerId, patch = {}) {
  const cur = getPaSettings(db, ownerId);
  const mode = patch.mode != null ? String(patch.mode) : cur.mode;
  const brief =
    patch.dailyBriefEnabled != null ? (patch.dailyBriefEnabled ? 1 : 0) : cur.daily_brief_enabled;
  const lastDay = patch.lastBriefDay != null ? String(patch.lastBriefDay) : cur.last_brief_day;
  db.prepare(
    `UPDATE pa_settings SET mode = ?, daily_brief_enabled = ?, last_brief_day = ?, updated_at = ? WHERE owner_id = ?`
  ).run(mode, brief, lastDay, Date.now(), String(ownerId));
  return getPaSettings(db, ownerId);
}

export function getPaStats(db, ownerId) {
  const oid = String(ownerId);
  const memories = db.prepare(`SELECT COUNT(*) AS n FROM pa_memories WHERE owner_id = ?`).get(oid)?.n || 0;
  const openTasks =
    db.prepare(`SELECT COUNT(*) AS n FROM pa_tasks WHERE owner_id = ? AND status = 'open'`).get(oid)?.n || 0;
  const docs =
    db.prepare(`SELECT COUNT(*) AS n FROM pa_docs WHERE owner_id = ? AND active = 1`).get(oid)?.n || 0;
  const chunks =
    db.prepare(`SELECT COUNT(*) AS n FROM pa_chunks WHERE owner_id = ?`).get(oid)?.n || 0;
  return { memories, openTasks, docs, chunks };
}
