/**
 * Agency Social Media Agent (Telegram-operated)
 *
 * Draft AI captions + flyers + short videos, preview for approval,
 * then publish to Instagram, Facebook, TikTok, X, LinkedIn, YouTube Shorts.
 *
 * Usage:
 *   node scripts/proactive-social-agent.mjs
 *
 * Required:
 *   TELEGRAM_SOCIAL_BOT_TOKEN   (separate bot from marketing)
 *   TELEGRAM_SOCIAL_APPROVER_IDS
 * Optional:
 *   JAB_SOCIAL_DRY_RUN=1
 *   GEMINI_API_KEY
 *   META_ / TIKTOK_ / X_ / LINKEDIN_ / YOUTUBE_ tokens
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  openHubDb,
  getHubPaths,
  createSocialPost,
  getSocialPost,
  listSocialPosts,
  updateSocialPost,
  getSocialStats,
  connectedPlatforms,
  listSocialAccounts,
  addSocialEvent
} from "../packages/hub-db/index.mjs";
import {
  buildSocialCaptionsPrompt,
  buildSocialChatSystemPrompt,
  parseCaptionsJson,
  fallbackCaptions,
  captionForPlatform
} from "../packages/social-prompt.mjs";
import { generateSocialFlyer, generateSocialVideo } from "../packages/social-media-gen.mjs";
import { fetchStockImagesForBrief } from "../packages/social-stock.mjs";
import {
  FLYER_STYLES,
  getBriefSession,
  clearBriefSession,
  startBriefSession,
  updateBriefSession,
  extractBriefHints,
  extractPhones,
  briefReady,
  nextBriefQuestion,
  applyBriefAnswer,
  buildBriefSummaryText,
  stylePromptFor
} from "../packages/social-briefing.mjs";
import {
  SOCIAL_PLATFORMS,
  publishSocialPost,
  isAccountReady,
  resolveAccountCreds
} from "../packages/social-publishers/index.mjs";
import { readHubEnv } from "../packages/evolution-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const HUB_ENV_PATH = path.join(REPO_ROOT, ".env");

const POLL_MS = 1200;
let hubEnvCache = {};
let offset = 0;
let dryRunOverride = null;
const chatMemory = new Map();
const CHAT_MEMORY_MAX = 14;

function rememberChat(chatId, role, text) {
  const key = String(chatId);
  const rows = chatMemory.get(key) || [];
  rows.push({ role, text: String(text || "").slice(0, 1400) });
  while (rows.length > CHAT_MEMORY_MAX) rows.shift();
  chatMemory.set(key, rows);
}

function getChatHistory(chatId) {
  return chatMemory.get(String(chatId)) || [];
}

function cfg() {
  const env = { ...hubEnvCache, ...process.env };
  const dryEnv = String(env.JAB_SOCIAL_DRY_RUN || "1") !== "0";
  const dryRun = dryRunOverride === null ? dryEnv : dryRunOverride;
  const token = String(env.TELEGRAM_SOCIAL_BOT_TOKEN || "").trim();
  const approvers = String(env.TELEGRAM_SOCIAL_APPROVER_IDS || env.TELEGRAM_APPROVER_IDS || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    dryRun,
    token,
    approvers,
    brandName: env.JAB_SOCIAL_BRAND_NAME || "JAB Digital Hub",
    brandColors: env.JAB_SOCIAL_BRAND_COLORS || "#0F4C5C,#E8D5B7",
    geminiKey: String(
      env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || ""
    ).trim(),
    geminiModel: env.JAB_HUB_GEMINI_MODEL || env.GEMINI_MODEL || "gemini-2.5-flash",
    dataDir: env.JAB_HUB_DATA_DIR || getHubPaths().baseDir
  };
}

function isApprover(userId) {
  const { approvers } = cfg();
  if (!approvers.length) return false;
  return approvers.includes(String(userId));
}

async function loadEnv() {
  hubEnvCache = await readHubEnv(HUB_ENV_PATH);
  for (const key of [
    "TELEGRAM_SOCIAL_BOT_TOKEN",
    "TELEGRAM_SOCIAL_APPROVER_IDS",
    "TELEGRAM_APPROVER_IDS",
    "JAB_SOCIAL_DRY_RUN",
    "JAB_SOCIAL_TOKEN_SECRET",
    "JAB_SOCIAL_BRAND_NAME",
    "JAB_SOCIAL_BRAND_COLORS",
    "JAB_SOCIAL_IMAGE_MODEL",
    "JAB_SOCIAL_PUBLIC_MEDIA_BASE",
    "PEXELS_API_KEY",
    "UNSPLASH_ACCESS_KEY",
    "POSTERMYWALL_API_KEY",
    "JAB_HUB_DATA_DIR",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GEMINI_MODEL",
    "JAB_HUB_GEMINI_MODEL",
    "META_ACCESS_TOKEN",
    "META_PAGE_ID",
    "META_IG_USER_ID",
    "TIKTOK_ACCESS_TOKEN",
    "X_API_KEY",
    "X_API_SECRET",
    "X_ACCESS_TOKEN",
    "X_ACCESS_SECRET",
    "LINKEDIN_ACCESS_TOKEN",
    "LINKEDIN_AUTHOR_URN",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
    "YOUTUBE_ACCESS_TOKEN"
  ]) {
    if (!process.env[key] && hubEnvCache[key]) process.env[key] = hubEnvCache[key];
  }
  if (!process.env.GEMINI_API_KEY && !hubEnvCache.GEMINI_API_KEY) {
    try {
      const authPath = path.join(
        process.env.USERPROFILE || process.env.HOME || "",
        ".openclaw",
        "agents",
        "main",
        "agent",
        "auth-profiles.json"
      );
      const auth = JSON.parse(await readFile(authPath, "utf8"));
      const google = auth?.profiles?.["google:manual"];
      const key = google?.token || google?.key;
      if (key) process.env.GEMINI_API_KEY = key;
    } catch {
      /* optional */
    }
  }
}

async function tg(method, body = {}, formData = null) {
  const { token } = cfg();
  if (!token) throw new Error("TELEGRAM_SOCIAL_BOT_TOKEN missing");
  const url = `https://api.telegram.org/bot${token}/${method}`;
  let response;
  if (formData) {
    response = await fetch(url, { method: "POST", body: formData });
  } else {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
  const json = await response.json();
  if (!json.ok) {
    throw new Error(`Telegram ${method} failed: ${json.description || JSON.stringify(json)}`);
  }
  return json.result;
}

async function answerCallback(id, text = "") {
  try {
    await tg("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 180) });
  } catch {
    /* ignore */
  }
}

async function sendTelegram(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: String(text).slice(0, 3900),
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return tg("sendMessage", payload);
}

async function sendTyping(chatId) {
  try {
    await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    /* optional */
  }
}

async function sendPhoto(chatId, filePath, caption, replyMarkup = null) {
  if (!existsSync(filePath)) {
    return sendTelegram(chatId, caption, replyMarkup);
  }
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", String(caption || "").slice(0, 1000));
  form.append("photo", new Blob([buf], { type: "image/png" }), path.basename(filePath));
  if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
  return tg("sendPhoto", {}, form);
}

async function sendVideo(chatId, filePath, caption = "") {
  if (!filePath || !existsSync(filePath)) return null;
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", String(caption).slice(0, 900));
  form.append("video", new Blob([buf], { type: "video/mp4" }), path.basename(filePath));
  form.append("supports_streaming", "true");
  return tg("sendVideo", {}, form);
}

async function draftWithGemini(prompt, { temperature = 0.85, maxOutputTokens = 1200 } = {}) {
  const { geminiKey, geminiModel } = cfg();
  if (!geminiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    geminiModel
  )}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens }
    }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`);
  const json = JSON.parse(body || "{}");
  return (
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || ""
  ).trim() || null;
}

async function draftChatWithGemini({ systemPrompt, history, userText }) {
  const { geminiKey, geminiModel } = cfg();
  if (!geminiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    geminiModel
  )}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const contents = [];
  for (const turn of history.slice(-12)) {
    contents.push({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.text }]
    });
  }
  contents.push({ role: "user", parts: [{ text: userText }] });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.95, maxOutputTokens: 700 }
    }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await response.text();
  if (!response.ok) return null;
  const json = JSON.parse(body || "{}");
  return (
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || ""
  ).trim() || null;
}

function approveKeyboard(postId) {
  return {
    inline_keyboard: [
      [
        { text: "Approve & post", callback_data: `soc:approve:${postId}` },
        { text: "Skip", callback_data: `soc:skip:${postId}` }
      ],
      [
        { text: "Regen caption", callback_data: `soc:regen_cap:${postId}` },
        { text: "Regen flyer", callback_data: `soc:regen_img:${postId}` }
      ]
    ]
  };
}

function parsePlatformsFromText(text) {
  const t = String(text || "").toLowerCase();
  const found = [];
  const map = [
    ["instagram", /\b(instagram|ig|insta)\b/],
    ["facebook", /\b(facebook|fb)\b/],
    ["tiktok", /\b(tiktok|tt)\b/],
    ["x", /\b(twitter|\bx\b)\b/],
    ["linkedin", /\blinkedin\b/],
    ["youtube", /\b(youtube|yt|shorts)\b/]
  ];
  for (const [p, re] of map) {
    if (re.test(t)) found.push(p);
  }
  if (/\b(all platforms|everywhere|all (social|handles|accounts))\b/.test(t)) {
    return [...SOCIAL_PLATFORMS];
  }
  return found;
}

function wantsDraft(text) {
  const t = String(text || "").toLowerCase().trim();
  // Complaints / visibility issues should chat, not spawn a new design.
  if (/\b(can'?t see|cannot see|don'?t see|no flyer|no video|where is|didn'?t (get|receive)|not showing)\b/.test(t)) {
    return false;
  }
  return (
    /\b(create|make|draft|design|post|publish|flyer|reel|video|caption|hiring|wanted)\b/.test(t) &&
    t.length > 12
  );
}

function wantsQueue(text) {
  const t = String(text || "").toLowerCase();
  return /\b(show|list|open) (the )?(queue|drafts|pending)\b/.test(t) || /^queue[!.?]*$/.test(t);
}

function wantsAccounts(text) {
  const t = String(text || "").toLowerCase();
  return /\b(accounts|handles|connected|which platforms)\b/.test(t);
}

function wantsSlashHelp(text) {
  const t = String(text || "")
    .trim()
    .toLowerCase();
  return /^(commands|\/help)[!.?]*$/.test(t) || /\b(list|show) (the )?commands\b/.test(t);
}

async function buildCaptions(brief, platforms) {
  const { brandName } = cfg();
  const prompt = buildSocialCaptionsPrompt({ brief, brandName, platforms });
  try {
    const raw = await draftWithGemini(prompt);
    const parsed = parseCaptionsJson(raw);
    if (parsed) return parsed;
  } catch {
    /* fallback */
  }
  return fallbackCaptions(brief, brandName);
}

async function createDraftFromBrief(db, { brief, platforms, chatId, stylePrompt = "", stockHint = {} }) {
  const { brandName, brandColors, dryRun, dataDir } = cfg();
  const plats = platforms?.length ? platforms : connectedPlatforms(db);
  const targetPlatforms = plats.length ? plats : [...SOCIAL_PLATFORMS];

  const captions = await buildCaptions(brief, targetPlatforms);
  if ((stockHint.phones || []).length && !String(captions.posterContact || "").trim()) {
    captions.posterContact = stockHint.phones.join(" / ");
  }
  if (stockHint.location && !String(captions.posterLine3 || "").trim()) {
    captions.posterLine3 = String(stockHint.location).toUpperCase();
  }
  let stockImages = [];
  try {
    stockImages = await fetchStockImagesForBrief(dataDir, {
      roles: stockHint.roles || captions.posterHeadline || "",
      location: stockHint.location || "",
      topic: brief
    });
  } catch {
    stockImages = [];
  }

  const flyer = await generateSocialFlyer({
    baseDir: dataDir,
    imagePrompt: captions.imagePrompt,
    headline: captions.posterHeadline || captions.videoHook || "",
    line2: captions.posterLine2 || "",
    line3: captions.posterLine3 || stockHint.location || "",
    contact: captions.posterContact || (stockHint.phones || []).join(" / "),
    brief,
    brandName,
    brandColors,
    stylePrompt: stylePrompt || captions.imagePrompt || "",
    stockImages
  });

  let video = null;
  try {
    video = await generateSocialVideo({
      baseDir: dataDir,
      imagePath: flyer.storyPath || flyer.squarePath,
      hookText: captions.videoHook || captions.posterHeadline || brandName,
      durationSec: 10
    });
  } catch (error) {
    addSocialEvent(db, {
      postId: null,
      eventType: "video_skip",
      detail: error.message
    });
  }

  const media = {
    squarePath: flyer.squarePath,
    storyPath: flyer.storyPath,
    videoPath: video?.videoPath || null,
    imageMethod: flyer.method,
    stock: stockImages.map((s) => ({ source: s.source, photographer: s.photographer, pageUrl: s.pageUrl }))
  };

  const post = createSocialPost(db, {
    brief,
    captions,
    media,
    platforms: targetPlatforms,
    dryRun,
    telegramChatId: chatId ? String(chatId) : null,
    status: "queued"
  });
  return post;
}

async function beginFlyerBriefing(chatId, text, platforms = []) {
  const hints = extractBriefHints(text);
  const state = startBriefSession(chatId, {
    topic: hints.topic,
    roles: hints.roles,
    location: hints.location,
    phones: hints.phones,
    styleId: hints.styleId,
    platforms
  });
  const q = nextBriefQuestion(state);
  rememberChat(chatId, "user", text);
  rememberChat(chatId, "assistant", q.text);
  await sendTelegram(chatId, [
    "Let’s design this properly — I’ll ask a few quick questions first (numbers, location, style), then generate the flyer + Reel.",
    "",
    q.text
  ].join("\n"));
}

async function continueFlyerBriefing(chatId, text, db) {
  const state = getBriefSession(chatId);
  if (!state) return false;

  const lower = text.toLowerCase().trim();
  if (/^(cancel|stop|nevermind|never mind)$/i.test(lower)) {
    clearBriefSession(chatId);
    await sendTelegram(chatId, "Okay — cancelled. Tell me whenever you want a new flyer.");
    return true;
  }

  // Confirm generate
  if (briefReady(state) && /^(yes|y|generate|go|go ahead|create|do it|looks good|ok|okay)$/i.test(lower)) {
    await sendTelegram(chatId, "Designing now — pulling free stock photos + building a unique PosterMyWall-style flyer…");
    const brief = buildBriefSummaryText(state);
    try {
      const post = await createDraftFromBrief(db, {
        brief,
        platforms: state.platforms || [],
        chatId,
        stylePrompt: stylePromptFor(state.styleId),
        stockHint: {
          roles: state.roles || state.topic,
          location: state.location,
          phones: state.phones
        }
      });
      clearBriefSession(chatId);
      await sendPostPreview(chatId, post);
      rememberChat(chatId, "user", text);
      rememberChat(chatId, "assistant", `Drafted #${post.id}`);
    } catch (error) {
      await sendTelegram(chatId, `Couldn’t finish the design: ${error.message}`);
    }
    return true;
  }

  const applied = applyBriefAnswer(state, text);
  if (!applied.ok) {
    await sendTelegram(chatId, applied.error);
    return true;
  }
  const next = updateBriefSession(chatId, applied.patch);
  const q = nextBriefQuestion(next);
  rememberChat(chatId, "user", text);
  rememberChat(chatId, "assistant", q.text);
  await sendTelegram(chatId, q.text);
  return true;
}

async function sendPostPreview(chatId, post) {
  const { dryRun } = cfg();
  const caption = captionForPlatform(post.captions, "instagram");
  const lines = [
    `Draft #${post.id}${dryRun || post.dry_run ? " · DRY-RUN" : " · LIVE"}`,
    `Platforms: ${(post.platforms || []).join(", ")}`,
    `Flyer engine: ${post.media?.imageMethod || "ok"}`,
    post.media?.stock?.length
      ? `Stock: ${post.media.stock.map((s) => s.source).join(", ")}`
      : null,
    "",
    caption.slice(0, 700)
  ].filter((x) => x !== null);
  const photo = post.media?.squarePath || post.media?.storyPath;
  await sendPhoto(chatId, photo, lines.join("\n"), approveKeyboard(post.id));
  if (post.media?.videoPath) {
    try {
      await sendVideo(chatId, post.media.videoPath, `Draft #${post.id} Reel/Short preview`);
    } catch (error) {
      await sendTelegram(chatId, `Video ready but Telegram upload failed: ${error.message}`);
    }
  }
}

async function approveAndPublish(db, postId, userId, chatId) {
  const { dryRun } = cfg();
  let post = getSocialPost(db, postId);
  if (!post) {
    await sendTelegram(chatId, "That draft is gone.");
    return;
  }
  if (post.status === "posted") {
    await sendTelegram(chatId, `Draft #${postId} already posted.`);
    return;
  }
  post = updateSocialPost(db, postId, {
    status: "approved",
    approvedBy: String(userId),
    approvedAt: Date.now(),
    dryRun
  });
  await sendTelegram(chatId, dryRun ? `Publishing #${postId} in dry-run…` : `Publishing #${postId}…`);
  const results = await publishSocialPost(db, post, { dryRun });
  const ok = Object.values(results).filter((r) => r.ok).length;
  const fail = Object.values(results).filter((r) => !r.ok).length;
  updateSocialPost(db, postId, {
    status: fail && !ok ? "failed" : "posted",
    results,
    postedAt: Date.now(),
    error: fail ? Object.values(results).find((r) => !r.ok)?.error : null
  });
  const summary = Object.entries(results)
    .map(([p, r]) => {
      if (r.dryRun) return `· ${p}: would post (${r.ready ? "connected" : "not connected"})`;
      return r.ok ? `· ${p}: ok ${r.externalId || ""}` : `· ${p}: ${r.error}`;
    })
    .join("\n");
  await sendTelegram(
    chatId,
    [`Done #${postId}${dryRun ? " (dry-run)" : ""}.`, `${ok} ok · ${fail} failed`, "", summary].join(
      "\n"
    )
  );
}

async function replyNaturalLanguage(chatId, userText, db) {
  const stats = getSocialStats(db);
  const context = [
    `Mode: ${cfg().dryRun ? "DRY_RUN" : "LIVE"}`,
    `Connected: ${(stats.connected || []).join(", ") || "none yet"}`,
    `Post counts: ${JSON.stringify(stats.byStatus)}`
  ].join("\n");
  const systemPrompt = buildSocialChatSystemPrompt({
    brandName: cfg().brandName,
    context
  });
  let reply = null;
  try {
    reply = await draftChatWithGemini({
      systemPrompt,
      history: getChatHistory(chatId),
      userText
    });
  } catch {
    /* fallback */
  }
  if (!reply) {
    reply =
      "I’m your social partner — tell me what to create (flyer, Reel, caption) and which platforms, and I’ll draft a preview for your approve.";
  }
  rememberChat(chatId, "user", userText);
  rememberChat(chatId, "assistant", reply);
  await sendTelegram(chatId, reply);
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  const text = String(msg.text || "").trim();
  if (!chatId || !text) return;

  if (!isApprover(fromId)) {
    const { approvers } = cfg();
    await sendTelegram(
      chatId,
      approvers.length
        ? "Not authorized. Add your Telegram id to TELEGRAM_SOCIAL_APPROVER_IDS.\nYour id: " + fromId
        : [
            "Welcome to the JAB Social Media Agent.",
            `Your Telegram user id: ${fromId}`,
            "",
            "Add to .env:",
            `TELEGRAM_SOCIAL_APPROVER_IDS=${fromId}`,
            "TELEGRAM_SOCIAL_BOT_TOKEN=<this bot token>",
            "Then restart jab-hub-social."
          ].join("\n")
    );
    return;
  }

  const { db } = openHubDb();

  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.split(/\s+/);
    const command = cmd.split("@")[0].toLowerCase();
    return handleSlashCommand({ chatId, command, rest, db });
  }

  await sendTyping(chatId);

  // Continue an in-progress flyer briefing first
  if (getBriefSession(chatId)) {
    const handled = await continueFlyerBriefing(chatId, text, db);
    if (handled) return;
  }

  if (wantsSlashHelp(text)) {
    return handleSlashCommand({ chatId, command: "/help", rest: [], db });
  }
  if (wantsQueue(text)) {
    return handleSlashCommand({ chatId, command: "/queue", rest: [], db });
  }
  if (wantsAccounts(text)) {
    return handleSlashCommand({ chatId, command: "/accounts", rest: [], db });
  }

  // Quick generate only when user explicitly skips interview
  if (/\b(skip questions|generate now|\/draftnow)\b/i.test(text)) {
    rememberChat(chatId, "user", text);
    await sendTelegram(chatId, "Generating now without the interview…");
    try {
      const platforms = parsePlatformsFromText(text);
      const brief = text.replace(/\b(skip questions|generate now|\/draftnow)\b/gi, "").trim() || text;
      const post = await createDraftFromBrief(db, { brief, platforms, chatId });
      await sendPostPreview(chatId, post);
    } catch (error) {
      await sendTelegram(chatId, `Couldn’t draft that: ${error.message}`);
    }
    return;
  }

  if (wantsDraft(text) || text.toLowerCase().startsWith("draft ")) {
    const platforms = parsePlatformsFromText(text);
    return beginFlyerBriefing(chatId, text.replace(/^\/?draft\s+/i, "").trim() || text, platforms);
  }

  return replyNaturalLanguage(chatId, text, db);
}

async function handleSlashCommand({ chatId, command, rest, db }) {
  const { dryRun, brandName } = cfg();

  if (command === "/start" || command === "/help") {
    await sendTelegram(
      chatId,
      [
        `Hey — I’m ${brandName}'s social media partner.`,
        dryRun
          ? "Dry-run is on: I draft & preview; nothing goes live until you approve."
          : "Live mode: approved drafts can publish.",
        "",
        "Say what flyer you want and I’ll interview you for:",
        "• topic / roles",
        "• location",
        "• WhatsApp number(s)",
        "• unique style (dark recruit, neon, Ghana warm, luxury…)",
        "",
        "Then I pull free stock photos and generate a PosterMyWall-style flyer + Reel.",
        "",
        "Tips: reply cancel to stop a briefing · “generate now” to skip questions",
        "Commands: /draft … · /queue · /accounts · /status · /dryrun on|off · /styles"
      ].join("\n")
    );
    return;
  }

  if (command === "/styles") {
    await sendTelegram(
      chatId,
      ["Flyer styles:", ...FLYER_STYLES.map((s, i) => `${i + 1}. ${s.label}`)].join("\n")
    );
    return;
  }

  if (command === "/status") {
    const stats = getSocialStats(db);
    await sendTelegram(
      chatId,
      [
        `Dry-run: ${dryRun}`,
        `Connected: ${(stats.connected || []).join(", ") || "none"}`,
        `Counts: ${JSON.stringify(stats.byStatus)}`
      ].join("\n")
    );
    return;
  }

  if (command === "/accounts") {
    const connected = connectedPlatforms(db);
    const rows = listSocialAccounts(db);
    const envLines = SOCIAL_PLATFORMS.map((p) => {
      const c = resolveAccountCreds(db, p);
      return `· ${p}: ${isAccountReady(c) ? "ready" : "not connected"} (${c.handle || "—"})`;
    });
    await sendTelegram(
      chatId,
      [
        "Platform status:",
        ...envLines,
        "",
        rows.length ? `Hub DB accounts: ${rows.length}` : "Connect tokens in Hub → Social or .env",
        connected.length ? `Active: ${connected.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
    return;
  }

  if (command === "/queue") {
    const posts = listSocialPosts(db, { status: "queued", limit: 10 });
    if (!posts.length) {
      await sendTelegram(chatId, "Queue is empty. Say what you’d like to create.");
      return;
    }
    for (const post of posts) {
      await sendPostPreview(chatId, post);
    }
    return;
  }

  if (command === "/dryrun") {
    const arg = String(rest[0] || "").toLowerCase();
    if (arg === "on") dryRunOverride = true;
    else if (arg === "off") dryRunOverride = false;
    else {
      await sendTelegram(chatId, `Dry-run is ${cfg().dryRun ? "ON" : "OFF"}. Use /dryrun on|off`);
      return;
    }
    await sendTelegram(chatId, `Dry-run ${cfg().dryRun ? "ON" : "OFF"} for this process.`);
    return;
  }

  if (command === "/draft") {
    const brief = rest.join(" ").trim();
    if (!brief) {
      await sendTelegram(chatId, "Usage: /draft Security guards wanted in Dubai…");
      return;
    }
    return beginFlyerBriefing(chatId, brief, parsePlatformsFromText(brief));
  }

  if (command === "/post") {
    const id = Number(rest[0]);
    if (!id) {
      await sendTelegram(chatId, "Usage: /post <id>");
      return;
    }
    await approveAndPublish(db, id, "slash", chatId);
    return;
  }

  await sendTelegram(chatId, "Unknown command. Try /help — or just describe the post you want.");
}

async function handleCallback(cq) {
  const chatId = cq.message?.chat?.id;
  const fromId = cq.from?.id;
  const data = String(cq.data || "");
  if (!chatId || !data.startsWith("soc:")) return;
  if (!isApprover(fromId)) {
    await answerCallback(cq.id, "Not authorized");
    return;
  }
  const { db } = openHubDb();
  const [, action, idStr] = data.split(":");
  const postId = Number(idStr);
  await answerCallback(cq.id, action);

  if (action === "approve") {
    await approveAndPublish(db, postId, fromId, chatId);
    return;
  }
  if (action === "skip") {
    updateSocialPost(db, postId, { status: "skipped" });
    await sendTelegram(chatId, `Skipped #${postId}.`);
    return;
  }
  if (action === "regen_cap") {
    const post = getSocialPost(db, postId);
    if (!post) return;
    await sendTelegram(chatId, "Regenerating caption…");
    const captions = await buildCaptions(post.brief, post.platforms);
    updateSocialPost(db, postId, {
      captions: { ...captions, imagePrompt: post.captions?.imagePrompt || captions.imagePrompt }
    });
    await sendPostPreview(chatId, getSocialPost(db, postId));
    return;
  }
  if (action === "regen_img") {
    const post = getSocialPost(db, postId);
    if (!post) return;
    await sendTelegram(chatId, "Regenerating flyer (+ video)…");
    const { brandName, brandColors, dataDir } = cfg();
    const flyer = await generateSocialFlyer({
      baseDir: dataDir,
      imagePrompt: post.captions?.imagePrompt,
      headline: post.captions?.posterHeadline || post.captions?.videoHook || "",
      line2: post.captions?.posterLine2 || "",
      line3: post.captions?.posterLine3 || "",
      contact: post.captions?.posterContact || "",
      brief: post.brief,
      brandName,
      brandColors
    });
    let videoPath = null;
    try {
      const video = await generateSocialVideo({
        baseDir: dataDir,
        imagePath: flyer.storyPath || flyer.squarePath,
        hookText: post.captions?.videoHook || brandName
      });
      videoPath = video.videoPath;
    } catch {
      /* optional */
    }
    updateSocialPost(db, postId, {
      media: {
        squarePath: flyer.squarePath,
        storyPath: flyer.storyPath,
        videoPath,
        imageMethod: flyer.method
      }
    });
    await sendPostPreview(chatId, getSocialPost(db, postId));
  }
}

async function pollOnce() {
  const updates = await tg("getUpdates", {
    offset,
    timeout: 25,
    allowed_updates: ["message", "callback_query"]
  });
  for (const u of updates || []) {
    offset = u.update_id + 1;
    try {
      if (u.callback_query) await handleCallback(u.callback_query);
      else if (u.message) await handleMessage(u.message);
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), socialError: error.message }));
    }
  }
}

async function main() {
  await loadEnv();
  const { token, approvers, dryRun, brandName } = cfg();
  if (!token) {
    console.error("TELEGRAM_SOCIAL_BOT_TOKEN is required. Create a bot with @BotFather.");
    process.exit(1);
  }
  openHubDb();
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      socialAgent: "start",
      brand: brandName,
      dryRun,
      approvers: approvers.length
    })
  );
  for (;;) {
    try {
      await pollOnce();
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), pollError: error.message }));
      await new Promise((r) => setTimeout(r, POLL_MS * 3));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
