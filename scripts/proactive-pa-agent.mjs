/**
 * Personal RAG + PA Agent (Telegram, owner-only)
 *
 * ChatGPT/Gemini-style assistant with web search, document RAG,
 * long-term memory, task reminders, preaching companion, and daily brief.
 *
 * Usage:
 *   node scripts/proactive-pa-agent.mjs
 *
 * Required:
 *   TELEGRAM_PA_BOT_TOKEN
 *   TELEGRAM_PA_OWNER_IDS
 * Optional:
 *   GEMINI_API_KEY
 *   BRAVE_SEARCH_API_KEY
 *   JAB_PA_TZ=Africa/Accra
 *   JAB_PA_DAILY_BRIEF_HOUR=6
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  openHubDb,
  getHubPaths,
  addPaMessage,
  listPaMessages,
  upsertPaMemory,
  listPaMemories,
  searchPaMemories,
  createPaTask,
  listPaTasks,
  completePaTask,
  cancelPaTask,
  claimDuePaReminders,
  listPaDocs,
  getPaSettings,
  updatePaSettings,
  getPaStats,
  addPaEvent
} from "../packages/hub-db/index.mjs";
import {
  buildPaSystemPrompt,
  buildPaDailyBriefPrompt,
  normalizePaMode,
  listPaModes
} from "../packages/pa-prompt.mjs";
import { researchQuestion, newsDigestBlock } from "../packages/pa-web.mjs";
import { ingestPaDocument, retrievePaContext } from "../packages/pa-rag.mjs";
import {
  createCursorCloudJob,
  pollCursorJobs,
  isCursorLaunchIntent,
  extractCursorPrompt,
  isCursorStatusIntent,
  parseCursorJobId,
  getCursorJob,
  listCursorJobs,
  refreshCursorJob,
  formatCursorJob
} from "../packages/pa-cursor.mjs";
import {
  wantsWebSearch,
  wantsRag,
  parseRemember,
  parseRemind,
  parseCompleteTask,
  parseCancelTask,
  parseModeSwitch,
  inferModeFromMessage,
  wantsMemories,
  wantsDocs,
  wantsBrief,
  wantsHelp,
  wantsStatus,
  wantsTaskList,
  wantsCursorCapability,
  naturalWelcome
} from "../packages/pa-tools.mjs";
import { readHubEnv } from "../packages/evolution-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const HUB_ENV_PATH = path.join(REPO_ROOT, ".env");

const POLL_MS = 1200;
const TICK_MS = 30_000;
let hubEnvCache = {};
let offset = 0;

function cfg() {
  const env = { ...hubEnvCache, ...process.env };
  const token = String(env.TELEGRAM_PA_BOT_TOKEN || "").trim();
  const owners = String(env.TELEGRAM_PA_OWNER_IDS || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    token,
    owners,
    ownerName: env.JAB_PA_OWNER_NAME || "Boss",
    tz: env.JAB_PA_TZ || "Africa/Accra",
    briefHour: Number(env.JAB_PA_DAILY_BRIEF_HOUR || 6),
    geminiKey: String(
      env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || ""
    ).trim(),
    geminiModel: env.JAB_PA_GEMINI_MODEL || env.JAB_HUB_GEMINI_MODEL || env.GEMINI_MODEL || "gemini-2.5-flash",
    dataDir: env.JAB_HUB_DATA_DIR || getHubPaths().baseDir,
    cursorApiKey: String(env.CURSOR_API_KEY || "").trim(),
    cursorRepoUrl: String(env.JAB_PA_CURSOR_REPO_URL || "https://github.com/Kwameboat/jab-hub.git").trim(),
    cursorBranch: String(env.JAB_PA_CURSOR_BRANCH || "master").trim(),
    cursorModel: String(env.JAB_PA_CURSOR_MODEL || "composer-2.5").trim(),
    cursorAutoPr: String(env.JAB_PA_CURSOR_AUTO_PR || "0").trim() === "1"
  };
}

function isOwner(userId) {
  const { owners } = cfg();
  if (!owners.length) return false;
  return owners.includes(String(userId));
}

async function loadEnv() {
  hubEnvCache = await readHubEnv(HUB_ENV_PATH);
  for (const key of [
    "TELEGRAM_PA_BOT_TOKEN",
    "TELEGRAM_PA_OWNER_IDS",
    "JAB_PA_OWNER_NAME",
    "JAB_PA_TZ",
    "JAB_PA_DAILY_BRIEF_HOUR",
    "JAB_PA_GEMINI_MODEL",
    "JAB_PA_EMBED_MODEL",
    "JAB_HUB_DATA_DIR",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "CURSOR_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "GOOGLE_CSE_API_KEY",
    "GOOGLE_CSE_ID",
    "JAB_MARKETING_SEARCH_PROVIDER",
    "JAB_PA_CURSOR_REPO_URL",
    "JAB_PA_CURSOR_BRANCH",
    "JAB_PA_CURSOR_MODEL",
    "JAB_PA_CURSOR_AUTO_PR"
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
  if (!token) throw new Error("TELEGRAM_PA_BOT_TOKEN missing");
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

async function sendTelegram(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: String(text).slice(0, 3900),
    disable_web_page_preview: false
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

async function downloadTelegramFile(fileId) {
  const file = await tg("getFile", { file_id: fileId });
  const { token } = cfg();
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buffer: buf, path: file.file_path || "" };
}

async function draftWithGemini(systemPrompt, history, userText) {
  const { geminiKey, geminiModel } = cfg();
  if (!geminiKey) return null;
  const contents = [];
  for (const turn of history || []) {
    contents.push({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: String(turn.body || turn.text || "").slice(0, 4000) }]
    });
  }
  contents.push({ role: "user", parts: [{ text: String(userText || "").slice(0, 6000) }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    geminiModel
  )}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    }),
    signal: AbortSignal.timeout(90000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${body.slice(0, 220)}`);
  const json = JSON.parse(body || "{}");
  return (
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || ""
  ).trim() || null;
}

function localDayKey(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function localHour(tz) {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "numeric",
        hour12: false
      }).format(new Date())
    );
  } catch {
    return new Date().getUTCHours();
  }
}

async function replyWithTools(db, { chatId, ownerId, text }) {
  const { ownerName, tz, dataDir, cursorApiKey, cursorRepoUrl, cursorBranch, cursorModel, cursorAutoPr } = cfg();
  const settings = getPaSettings(db, ownerId);
  let mode = normalizePaMode(settings.mode);

  // Persistent mode switch from natural language
  const modeSwitch = parseModeSwitch(text);
  if (modeSwitch) {
    mode = normalizePaMode(modeSwitch);
    updatePaSettings(db, ownerId, { mode });
  } else {
    // Smart one-turn mode (sermon/news/topics) without changing saved preference
    mode = inferModeFromMessage(text, mode);
  }

  const memories = listPaMemories(db, ownerId, { limit: 24 });
  const openTasks = listPaTasks(db, ownerId, { status: "open", limit: 20 });
  const stats = getPaStats(db, ownerId);
  const toolBlocks = [];

  if (modeSwitch) {
    toolBlocks.push(`Mode updated to: ${mode}. Continue naturally in this style.`);
  }

  if (wantsHelp(text)) {
    await sendTelegram(chatId, naturalWelcome(ownerName));
    addPaMessage(db, { ownerId, role: "user", body: text, mode });
    addPaMessage(db, { ownerId, role: "assistant", body: naturalWelcome(ownerName), mode });
    return;
  }

  if (wantsBrief(text)) {
    await sendDailyBrief(db, ownerId, chatId, { force: true });
    addPaMessage(db, { ownerId, role: "user", body: text, mode });
    return;
  }

  if (wantsMemories(text)) {
    toolBlocks.push(
      memories.length
        ? `Saved memories:\n${memories.map((m) => `• ${m.key}: ${m.value}`).join("\n")}`
        : "Saved memories: none yet — say “remember …” anytime."
    );
  }

  if (wantsDocs(text)) {
    const docs = listPaDocs(db, ownerId);
    toolBlocks.push(
      docs.length
        ? `Your documents:\n${docs.map((d) => `• #${d.id} ${d.title}`).join("\n")}`
        : "Your documents: none yet — send a PDF/TXT/MD file anytime."
    );
  }

  if (wantsStatus(text)) {
    toolBlocks.push(
      [
        `Status: online`,
        `Mode: ${mode}`,
        `Memories: ${stats.memories}`,
        `Open tasks: ${stats.openTasks}`,
        `Docs: ${stats.docs}`,
        `Gemini: ${cfg().geminiKey ? "ok" : "missing key"}`,
        `Cursor cloud worker: ${cursorApiKey ? "configured" : "not configured"}`
      ].join("\n")
    );
  }

  if (wantsTaskList(text)) {
    toolBlocks.push(
      openTasks.length
        ? `Open tasks:\n${openTasks.map((t) => `#${t.id} ${t.title}`).join("\n")}`
        : "Open tasks: none"
    );
  }

  if (isCursorStatusIntent(text)) {
    const requestedId = parseCursorJobId(text);
    if (requestedId) {
      let job = getCursorJob(dataDir, requestedId);
      if (job && cursorApiKey && !["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(String(job.status || "").toUpperCase())) {
        try {
          job = await refreshCursorJob(dataDir, cursorApiKey, requestedId);
        } catch {
          /* ignore refresh failure */
        }
      }
      toolBlocks.push(job ? formatCursorJob(job) : `I couldn't find Cursor job #${requestedId}.`);
    } else {
      const jobs = listCursorJobs(dataDir, ownerId, { limit: 6 });
      toolBlocks.push(
        jobs.length
          ? `Recent Cursor jobs:\n${jobs.map((j) => `#${j.localId} ${j.status} — ${j.prompt.slice(0, 90)}`).join("\n")}`
          : "Recent Cursor jobs: none yet."
      );
    }
  }

  if (isCursorLaunchIntent(text)) {
    if (!cursorApiKey) {
      toolBlocks.push(
        "Cursor cloud worker is not configured yet. Add CURSOR_API_KEY on the VPS, then I can send repo tasks to Cursor while your laptop is off."
      );
    } else {
      const prompt = extractCursorPrompt(text);
      if (!prompt) {
        toolBlocks.push("Tell me exactly what you want Cursor to do in the repo, and I will launch it.");
      } else {
        await sendTelegram(chatId, "Launching a Cursor cloud coding job…");
        try {
          const job = await createCursorCloudJob(dataDir, {
            ownerId,
            chatId,
            prompt,
            apiKey: cursorApiKey,
            repoUrl: cursorRepoUrl,
            startingRef: cursorBranch,
            modelId: cursorModel,
            autoCreatePR: cursorAutoPr
          });
          toolBlocks.push(
            [
              `Launched Cursor job #${job.localId}.`,
              `Status: ${job.status}`,
              `Repo: ${cursorRepoUrl} @ ${cursorBranch}`,
              job.agentUrl ? `Agent: ${job.agentUrl}` : null,
              "I'll keep checking in the background and report back here when it finishes."
            ].filter(Boolean).join("\n")
          );
        } catch (error) {
          toolBlocks.push(`I couldn't launch the Cursor cloud job: ${error.message}`);
        }
      }
    }
  }

  // Explicit remember
  const remember = parseRemember(text);
  if (remember) {
    upsertPaMemory(db, { ownerId, key: remember.key, value: remember.value, tags: "user" });
    toolBlocks.push(`Saved memory: ${remember.key} = ${remember.value}`);
  }

  // Explicit remind / task
  const remind = parseRemind(text);
  if (remind) {
    const task = createPaTask(db, {
      ownerId,
      title: remind.title,
      dueAt: remind.dueAt,
      remindAt: remind.remindAt,
      telegramChatId: String(chatId)
    });
    toolBlocks.push(
      `Scheduled reminder #${task.id}: “${task.title}” at ${new Date(task.remind_at).toISOString()}`
    );
  }

  const doneId = parseCompleteTask(text);
  if (doneId) {
    const task = completePaTask(db, doneId);
    if (task && String(task.owner_id) === String(ownerId)) {
      toolBlocks.push(`Marked task #${doneId} done.`);
    }
  }

  const cancelId = parseCancelTask(text);
  if (cancelId) {
    const task = cancelPaTask(db, cancelId);
    if (task && String(task.owner_id) === String(ownerId)) {
      toolBlocks.push(`Cancelled task #${cancelId}.`);
    }
  }

  // Web research when needed — always fetch live articles for news/current events
  const needWeb =
    wantsWebSearch(text) ||
    mode === "news" ||
    /\b(brief me|daily brief|headlines)\b/i.test(text);
  if (needWeb && !remember) {
    await sendTelegram(chatId, "Checking live news & the web…");
    const isCurrent =
      mode === "news" ||
      wantsNewsTone(text) ||
      /\b(news|today|latest|sentence|sentenced|jailed|court|headline|current)\b/i.test(text);
    const research = await researchQuestion(text, {
      fetchTop: isCurrent ? 3 : 2,
      env: process.env,
      current: true
    });
    toolBlocks.push(research.promptBlock);
    if (!research.search?.results?.length) {
      toolBlocks.push(
        "Note: live search returned no hits. Say you could not find fresh coverage yet — do NOT invent a story."
      );
    }
  }

  // RAG when preaching or asking about own docs
  const needRag = wantsRag(text) || mode === "preach" || /\b(my notes|documents)\b/i.test(text);
  if (needRag) {
    const rag = await retrievePaContext(db, ownerId, text, { topK: 5 });
    if (rag.promptBlock) toolBlocks.push(rag.promptBlock);
  }

  // Soft auto-RAG for general questions if docs exist
  if (!needRag && stats.docs > 0 && text.length > 20) {
    const rag = await retrievePaContext(db, ownerId, text, { topK: 3 });
    if (rag.hits?.length) toolBlocks.push(rag.promptBlock);
  }

  const history = listPaMessages(db, ownerId, { limit: 16 }).map((m) => ({
    role: m.role,
    body: m.body
  }));

  const systemPrompt = buildPaSystemPrompt({
    mode,
    ownerName,
    tz,
    memories,
    openTasks: listPaTasks(db, ownerId, { status: "open", limit: 15 }),
    toolContext: toolBlocks.join("\n\n"),
    stats
  });

  let reply = null;
  try {
    reply = await draftWithGemini(systemPrompt, history, text);
  } catch (error) {
    reply = `I hit a model error: ${error.message}`;
  }
  if (!reply) {
    reply = toolBlocks.length
      ? toolBlocks.join("\n\n").slice(0, 3500)
      : "I’m here — ask me anything, set a reminder, or upload a note and ask about it later.";
  }

  addPaMessage(db, { ownerId, role: "user", body: text, mode });
  addPaMessage(db, { ownerId, role: "assistant", body: reply, mode });
  await sendTelegram(chatId, reply);
}

async function handleDocument(db, msg) {
  const chatId = msg.chat?.id;
  const ownerId = String(msg.from?.id);
  const doc = msg.document;
  if (!doc?.file_id) return;
  await sendTelegram(chatId, "Ingesting document into your private knowledge base…");
  try {
    const { buffer, path: remotePath } = await downloadTelegramFile(doc.file_id);
    const filename = doc.file_name || path.basename(remotePath) || "document";
    const result = await ingestPaDocument(db, {
      ownerId,
      baseDir: cfg().dataDir,
      filename,
      mime: doc.mime_type || "",
      buffer,
      title: filename
    });
    await sendTelegram(
      chatId,
      `Saved “${result.doc.title}” as doc #${result.doc.id} (${result.chunkCount} chunks). Ask me about it anytime.`
    );
  } catch (error) {
    await sendTelegram(chatId, `Couldn’t ingest that file: ${error.message}`);
  }
}

async function handleSlash(db, { chatId, ownerId, command, rest }) {
  const { ownerName, tz, briefHour } = cfg();
  if (command === "/start" || command === "/help") {
    await sendTelegram(chatId, naturalWelcome(ownerName));
    return;
  }

  if (command === "/mode") {
    const next = normalizePaMode(rest[0] || "pa");
    updatePaSettings(db, ownerId, { mode: next });
    await sendTelegram(chatId, `Mode set to ${next}. Available: ${listPaModes().join(", ")}`);
    return;
  }

  if (command === "/tasks") {
    const tasks = listPaTasks(db, ownerId, { status: "open", limit: 25 });
    if (!tasks.length) {
      await sendTelegram(chatId, "No open tasks.");
      return;
    }
    await sendTelegram(
      chatId,
      tasks
        .map((t) => {
          const when = t.due_at ? new Date(t.due_at).toISOString() : "no due";
          return `#${t.id} · ${t.title}\n  ${when}`;
        })
        .join("\n\n")
    );
    return;
  }

  if (command === "/done") {
    const id = Number(rest[0]);
    if (!id) {
      await sendTelegram(chatId, "Usage: /done <taskId>");
      return;
    }
    const task = completePaTask(db, id);
    await sendTelegram(chatId, task ? `Done #${id}: ${task.title}` : "Task not found.");
    return;
  }

  if (command === "/cancel") {
    const id = Number(rest[0]);
    if (!id) {
      await sendTelegram(chatId, "Usage: /cancel <taskId>");
      return;
    }
    const task = cancelPaTask(db, id);
    await sendTelegram(chatId, task ? `Cancelled #${id}` : "Task not found.");
    return;
  }

  if (command === "/memories") {
    const rows = listPaMemories(db, ownerId, { limit: 30 });
    if (!rows.length) {
      await sendTelegram(chatId, "No memories yet. Say: remember my …");
      return;
    }
    await sendTelegram(
      chatId,
      rows.map((m) => `• ${m.key}: ${m.value}`).join("\n").slice(0, 3800)
    );
    return;
  }

  if (command === "/docs") {
    const docs = listPaDocs(db, ownerId);
    if (!docs.length) {
      await sendTelegram(chatId, "No documents yet — send a PDF/TXT/MD here.");
      return;
    }
    await sendTelegram(
      chatId,
      docs.map((d) => `#${d.id} · ${d.title} (${d.char_count} chars)`).join("\n")
    );
    return;
  }

  if (command === "/brief") {
    await sendDailyBrief(db, ownerId, chatId, { force: true });
    return;
  }

  if (command === "/status") {
    const stats = getPaStats(db, ownerId);
    const settings = getPaSettings(db, ownerId);
    await sendTelegram(
      chatId,
      [
        `PA status`,
        `Mode: ${settings.mode}`,
        `Memories: ${stats.memories}`,
        `Open tasks: ${stats.openTasks}`,
        `Docs: ${stats.docs} · chunks: ${stats.chunks}`,
        `Daily brief: ${settings.daily_brief_enabled ? "on" : "off"} (last ${settings.last_brief_day || "—"})`,
        `Gemini: ${cfg().geminiKey ? "configured" : "MISSING"}`
        ,
        `Cursor cloud worker: ${cfg().cursorApiKey ? "configured" : "MISSING"}`
      ].join("\n")
    );
    return;
  }

  if (command === "/briefon") {
    updatePaSettings(db, ownerId, { dailyBriefEnabled: true });
    await sendTelegram(chatId, "Daily brief enabled.");
    return;
  }
  if (command === "/briefoff") {
    updatePaSettings(db, ownerId, { dailyBriefEnabled: false });
    await sendTelegram(chatId, "Daily brief disabled.");
    return;
  }

  await sendTelegram(chatId, "Unknown command. Try /help");
}

async function sendDailyBrief(db, ownerId, chatId, { force = false } = {}) {
  const { tz, briefHour, ownerName } = cfg();
  const settings = getPaSettings(db, ownerId);
  if (!force && !settings.daily_brief_enabled) return;
  const day = localDayKey(tz);
  if (!force && settings.last_brief_day === day) return;
  if (!force && localHour(tz) < briefHour) return;

  await sendTyping(chatId);
  let news = "";
  try {
    news = await newsDigestBlock({ env: process.env });
  } catch {
    news = "";
  }
  const memories = listPaMemories(db, ownerId, { limit: 10 });
  const openTasks = listPaTasks(db, ownerId, { status: "open", limit: 15 });
  const prompt = buildPaDailyBriefPrompt({ memories, openTasks, newsDigest: news });
  let brief = null;
  try {
    brief = await draftWithGemini(
      `You write concise morning briefs for ${ownerName}.`,
      [],
      prompt
    );
  } catch {
    brief = null;
  }
  if (!brief) {
    brief = [
      `Good morning, ${ownerName}.`,
      openTasks.length
        ? `Open tasks:\n${openTasks.map((t) => `• #${t.id} ${t.title}`).join("\n")}`
        : "No open tasks.",
      news ? "\n(News search ran — ask me for headlines anytime.)" : ""
    ].join("\n");
  }
  await sendTelegram(chatId, brief);
  updatePaSettings(db, ownerId, { lastBriefDay: day });
  addPaEvent(db, { ownerId, eventType: "daily_brief", detail: day });
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  if (!chatId || !fromId) return;

  if (!isOwner(fromId)) {
    const { owners } = cfg();
    await sendTelegram(
      chatId,
      owners.length
        ? "Not authorized. This PA is private."
        : [
            "Welcome — this will be your private Personal Assistant.",
            `Your Telegram user id: ${fromId}`,
            "",
            "Add to .env:",
            `TELEGRAM_PA_OWNER_IDS=${fromId}`,
            "TELEGRAM_PA_BOT_TOKEN=<this bot token>",
            "Then restart jab-hub-pa."
          ].join("\n")
    );
    return;
  }

  const { db } = openHubDb();
  const ownerId = String(fromId);

  // Document upload
  if (msg.document) {
    return handleDocument(db, msg);
  }

  // Plain text (also caption on photos ignored for v1)
  const text = String(msg.text || msg.caption || "").trim();
  if (!text) {
    await sendTelegram(chatId, "Send me a message, ask for a reminder, or upload a PDF/TXT/MD.");
    return;
  }

  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.split(/\s+/);
    return handleSlash(db, {
      chatId,
      ownerId,
      command: cmd.split("@")[0].toLowerCase(),
      rest
    });
  }

  await sendTyping(chatId);
  try {
    await replyWithTools(db, { chatId, ownerId, text });
  } catch (error) {
    await sendTelegram(chatId, `Something went wrong: ${error.message}`);
  }
}

async function tickReminders() {
  const { db } = openHubDb();
  const { dataDir, cursorApiKey } = cfg();
  const due = claimDuePaReminders(db, { limit: 15 });
  for (const task of due) {
    const chatId = task.telegram_chat_id;
    if (!chatId) continue;
    try {
      await sendTelegram(
        chatId,
        [`⏰ Reminder #${task.id}`, task.title, task.notes ? `\n${task.notes}` : ""]
          .filter(Boolean)
          .join("\n")
      );
      addPaEvent(db, {
        ownerId: task.owner_id,
        eventType: "reminder_sent",
        detail: `task #${task.id}`
      });
    } catch (error) {
      addPaEvent(db, {
        ownerId: task.owner_id,
        eventType: "reminder_fail",
        detail: error.message
      });
    }
  }

  if (cursorApiKey) {
    try {
      const updates = await pollCursorJobs(dataDir, cursorApiKey);
      for (const job of updates) {
        await sendTelegram(
          job.chatId,
          [
            `Cursor job #${job.localId} finished with status ${job.status}.`,
            job.result ? job.result.slice(0, 2000) : null,
            job.git?.branches?.[0]?.branch ? `Branch: ${job.git.branches[0].branch}` : null,
            job.git?.branches?.[0]?.prUrl ? `PR: ${job.git.branches[0].prUrl}` : null,
            job.agentUrl ? `Agent: ${job.agentUrl}` : null
          ].filter(Boolean).join("\n\n")
        );
      }
    } catch {
      /* ignore cloud polling errors */
    }
  }

  // Daily brief for each configured owner
  for (const ownerId of cfg().owners) {
    try {
      // Use last chat from messages if possible — fall back to owner id as chat id (private chats match)
      const settings = getPaSettings(db, ownerId);
      if (!settings.daily_brief_enabled) continue;
      await sendDailyBrief(db, ownerId, ownerId, { force: false });
    } catch {
      /* ignore brief errors */
    }
  }
}

async function pollOnce() {
  const updates = await tg("getUpdates", {
    offset,
    timeout: 25,
    allowed_updates: ["message"]
  });
  for (const u of updates || []) {
    offset = u.update_id + 1;
    if (u.message) {
      try {
        await handleMessage(u.message);
      } catch (error) {
        console.error("handleMessage", error.message);
      }
    }
  }
}

async function main() {
  await loadEnv();
  const { token, owners, dataDir } = cfg();
  if (!token) {
    console.error("TELEGRAM_PA_BOT_TOKEN is required. Create a bot with @BotFather.");
    process.exit(1);
  }
  await mkdir(path.join(dataDir, "pa", "docs"), { recursive: true });
  // Ensure DB migrations
  openHubDb();

  const me = await tg("getMe");
  console.log(
    JSON.stringify({
      ok: true,
      bot: me.username || me.first_name,
      owners: owners.length,
      warn: owners.length ? undefined : "TELEGRAM_PA_OWNER_IDS empty — /start to learn your id"
    })
  );

  // Persist offset across restarts lightly
  const offsetFile = path.join(dataDir, "pa", "telegram-offset.txt");
  if (existsSync(offsetFile)) {
    try {
      offset = Number((await readFile(offsetFile, "utf8")).trim()) || 0;
    } catch {
      offset = 0;
    }
  }

  setInterval(() => {
    tickReminders().catch((e) => console.error("tick", e.message));
  }, TICK_MS);
  tickReminders().catch(() => {});

  for (;;) {
    try {
      await pollOnce();
      await writeFile(offsetFile, String(offset), "utf8");
    } catch (error) {
      console.error("poll", error.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
