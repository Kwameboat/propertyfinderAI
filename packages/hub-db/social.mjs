/**
 * Agency social media accounts, drafts, and publish audit.
 * Agency-scoped (not per client WhatsApp instance).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "x",
  "linkedin",
  "youtube"
];

export function migrateSocial(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL DEFAULT '',
      external_id TEXT DEFAULT '',
      token_enc TEXT DEFAULT '',
      meta_json TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'disconnected',
      connected_at INTEGER,
      updated_at INTEGER NOT NULL,
      UNIQUE(platform, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);

    CREATE TABLE IF NOT EXISTS social_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brief TEXT NOT NULL DEFAULT '',
      captions_json TEXT NOT NULL DEFAULT '{}',
      media_json TEXT NOT NULL DEFAULT '{}',
      platforms_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      dry_run INTEGER NOT NULL DEFAULT 1,
      results_json TEXT DEFAULT '{}',
      error TEXT,
      telegram_chat_id TEXT,
      telegram_message_id TEXT,
      approved_by TEXT,
      approved_at INTEGER,
      posted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
    CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC);

    CREATE TABLE IF NOT EXISTS social_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER,
      event_type TEXT NOT NULL,
      detail TEXT DEFAULT '',
      meta_json TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_social_events_post ON social_events(post_id);
  `);
}

function tokenSecret() {
  const raw = String(process.env.JAB_SOCIAL_TOKEN_SECRET || process.env.HUB_ADMIN_PASSWORD || "jab-social-dev").trim();
  return createHash("sha256").update(raw).digest();
}

export function encryptSocialToken(plain) {
  const text = String(plain || "");
  if (!text) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenSecret(), iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSocialToken(blob) {
  const raw = String(blob || "");
  if (!raw) return "";
  if (!raw.startsWith("v1:")) return raw;
  const [, ivB64, tagB64, dataB64] = raw.split(":");
  const decipher = createDecipheriv("aes-256-gcm", tokenSecret(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export function addSocialEvent(db, { postId = null, eventType, detail = "", meta = {} }) {
  db.prepare(
    `INSERT INTO social_events (post_id, event_type, detail, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(postId, eventType, detail, JSON.stringify(meta || {}), Date.now());
}

export function listSocialAccounts(db) {
  return db
    .prepare(`SELECT id, platform, handle, external_id, status, connected_at, updated_at, meta_json FROM social_accounts ORDER BY platform, id`)
    .all()
    .map((row) => ({
      ...row,
      meta: safeJson(row.meta_json, {}),
      connected: row.status === "connected"
    }));
}

export function getSocialAccount(db, id) {
  const row = db.prepare(`SELECT * FROM social_accounts WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    ...row,
    meta: safeJson(row.meta_json, {}),
    accessToken: decryptSocialToken(row.token_enc)
  };
}

export function getSocialAccountByPlatform(db, platform, externalId = "") {
  if (externalId) {
    return db
      .prepare(`SELECT * FROM social_accounts WHERE platform = ? AND external_id = ?`)
      .get(platform, externalId);
  }
  return db
    .prepare(
      `SELECT * FROM social_accounts WHERE platform = ? AND status = 'connected' ORDER BY id DESC LIMIT 1`
    )
    .get(platform);
}

export function upsertSocialAccount(
  db,
  { platform, handle = "", externalId = "", accessToken = "", meta = {}, status = "connected" }
) {
  const now = Date.now();
  const plat = String(platform || "").toLowerCase();
  if (!SOCIAL_PLATFORMS.includes(plat)) throw new Error(`Unsupported platform: ${platform}`);
  const ext = String(externalId || handle || plat).trim() || plat;
  const existing = db
    .prepare(`SELECT * FROM social_accounts WHERE platform = ? AND external_id = ?`)
    .get(plat, ext);
  const tokenEnc = accessToken ? encryptSocialToken(accessToken) : existing?.token_enc || "";
  if (existing) {
    db.prepare(
      `UPDATE social_accounts SET
        handle = COALESCE(NULLIF(?, ''), handle),
        token_enc = CASE WHEN ? != '' THEN ? ELSE token_enc END,
        meta_json = ?,
        status = ?,
        connected_at = CASE WHEN ? = 'connected' THEN COALESCE(connected_at, ?) ELSE connected_at END,
        updated_at = ?
       WHERE id = ?`
    ).run(
      handle,
      tokenEnc,
      tokenEnc,
      JSON.stringify(meta || safeJson(existing.meta_json, {})),
      status,
      status,
      now,
      now,
      existing.id
    );
    return getSocialAccount(db, existing.id);
  }
  const info = db
    .prepare(
      `INSERT INTO social_accounts
        (platform, handle, external_id, token_enc, meta_json, status, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      plat,
      handle || ext,
      ext,
      tokenEnc,
      JSON.stringify(meta || {}),
      status,
      status === "connected" ? now : null,
      now
    );
  return getSocialAccount(db, info.lastInsertRowid);
}

export function disconnectSocialAccount(db, id) {
  db.prepare(
    `UPDATE social_accounts SET status = 'disconnected', token_enc = '', updated_at = ? WHERE id = ?`
  ).run(Date.now(), id);
}

export function connectedPlatforms(db) {
  const rows = db
    .prepare(`SELECT platform FROM social_accounts WHERE status = 'connected'`)
    .all();
  const set = new Set(rows.map((r) => r.platform));
  // Env-connected platforms count as connected even without DB row
  for (const p of SOCIAL_PLATFORMS) {
    if (envHasPlatformCreds(p)) set.add(p);
  }
  return [...set];
}

export function envHasPlatformCreds(platform) {
  const env = process.env;
  switch (platform) {
    case "instagram":
    case "facebook":
      return Boolean(env.META_ACCESS_TOKEN && (env.META_PAGE_ID || env.META_IG_USER_ID));
    case "tiktok":
      return Boolean(env.TIKTOK_ACCESS_TOKEN);
    case "x":
      return Boolean(
        (env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET) || env.X_BEARER_TOKEN
      );
    case "linkedin":
      return Boolean(env.LINKEDIN_ACCESS_TOKEN && env.LINKEDIN_AUTHOR_URN);
    case "youtube":
      return Boolean(env.YOUTUBE_REFRESH_TOKEN || env.YOUTUBE_ACCESS_TOKEN);
    default:
      return false;
  }
}

function safeJson(raw, fallback) {
  try {
    return JSON.parse(raw || "") ?? fallback;
  } catch {
    return fallback;
  }
}

export function createSocialPost(
  db,
  {
    brief = "",
    captions = {},
    media = {},
    platforms = [],
    dryRun = true,
    telegramChatId = null,
    telegramMessageId = null,
    status = "queued"
  } = {}
) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO social_posts
        (brief, captions_json, media_json, platforms_json, status, dry_run,
         telegram_chat_id, telegram_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      brief,
      JSON.stringify(captions || {}),
      JSON.stringify(media || {}),
      JSON.stringify(platforms || []),
      status,
      dryRun ? 1 : 0,
      telegramChatId,
      telegramMessageId,
      now,
      now
    );
  const id = Number(info.lastInsertRowid);
  addSocialEvent(db, { postId: id, eventType: "created", detail: brief.slice(0, 200) });
  return getSocialPost(db, id);
}

export function getSocialPost(db, id) {
  const row = db.prepare(`SELECT * FROM social_posts WHERE id = ?`).get(id);
  if (!row) return null;
  return hydratePost(row);
}

export function listSocialPosts(db, { status = null, limit = 30 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  let rows;
  if (status) {
    rows = db
      .prepare(`SELECT * FROM social_posts WHERE status = ? ORDER BY id DESC LIMIT ?`)
      .all(status, lim);
  } else {
    rows = db.prepare(`SELECT * FROM social_posts ORDER BY id DESC LIMIT ?`).all(lim);
  }
  return rows.map(hydratePost);
}

function hydratePost(row) {
  return {
    ...row,
    dry_run: Boolean(row.dry_run),
    captions: safeJson(row.captions_json, {}),
    media: safeJson(row.media_json, {}),
    platforms: safeJson(row.platforms_json, []),
    results: safeJson(row.results_json, {})
  };
}

export function updateSocialPost(db, id, patch = {}) {
  const cur = getSocialPost(db, id);
  if (!cur) return null;
  const now = Date.now();
  const captions = patch.captions !== undefined ? patch.captions : cur.captions;
  const media = patch.media !== undefined ? patch.media : cur.media;
  const platforms = patch.platforms !== undefined ? patch.platforms : cur.platforms;
  const results = patch.results !== undefined ? patch.results : cur.results;
  db.prepare(
    `UPDATE social_posts SET
      brief = COALESCE(?, brief),
      captions_json = ?,
      media_json = ?,
      platforms_json = ?,
      status = COALESCE(?, status),
      dry_run = COALESCE(?, dry_run),
      results_json = ?,
      error = COALESCE(?, error),
      telegram_chat_id = COALESCE(?, telegram_chat_id),
      telegram_message_id = COALESCE(?, telegram_message_id),
      approved_by = COALESCE(?, approved_by),
      approved_at = COALESCE(?, approved_at),
      posted_at = COALESCE(?, posted_at),
      updated_at = ?
     WHERE id = ?`
  ).run(
    patch.brief ?? null,
    JSON.stringify(captions),
    JSON.stringify(media),
    JSON.stringify(platforms),
    patch.status ?? null,
    patch.dryRun === undefined ? null : patch.dryRun ? 1 : 0,
    JSON.stringify(results || {}),
    patch.error ?? null,
    patch.telegramChatId ?? null,
    patch.telegramMessageId ?? null,
    patch.approvedBy ?? null,
    patch.approvedAt ?? null,
    patch.postedAt ?? null,
    now,
    id
  );
  if (patch.status) {
    addSocialEvent(db, {
      postId: id,
      eventType: `status:${patch.status}`,
      detail: patch.error || ""
    });
  }
  return getSocialPost(db, id);
}

export function getSocialStats(db) {
  const byStatus = db
    .prepare(`SELECT status, COUNT(*) AS n FROM social_posts GROUP BY status`)
    .all();
  const accounts = listSocialAccounts(db);
  const connected = connectedPlatforms(db);
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    accounts: accounts.length,
    connected
  };
}
