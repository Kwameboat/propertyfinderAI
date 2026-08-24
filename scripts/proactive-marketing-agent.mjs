/**
 * Proactive Marketing Agent (Telegram-operated)
 *
 * Discovers Ghana SMB WhatsApp-CTA leads via Brave Search or /lead <url>,
 * researches + drafts personalized JAB outreach, and sends only after
 * authorized Telegram approval.
 *
 * Usage:
 *   node scripts/proactive-marketing-agent.mjs
 *
 * Required env (in repo .env or process env):
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_APPROVER_IDS   (comma-separated numeric Telegram user IDs)
 * Optional:
 *   BRAVE_SEARCH_API_KEY
 *   JAB_MARKETING_INSTANCE=jab-whatsapp
 *   JAB_MARKETING_DRY_RUN=1
 *   JAB_MARKETING_DAILY_CAP=10
 *   JAB_MARKETING_COOLDOWN_DAYS=30
 *   JAB_MARKETING_FOLLOWUP_HOURS=48
 *   JAB_MARKETING_DISCOVER_MS=3600000
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  openHubDb,
  upsertClient,
  upsertContact,
  getContactByPhone,
  upsertMarketingLead,
  updateMarketingLead,
  listMarketingLeads,
  getMarketingLead,
  approveMarketingLead,
  markMarketingLeadSent,
  markMarketingLeadSkipped,
  markMarketingLeadBlocked,
  markMarketingLeadReplied,
  scheduleFollowUpJob,
  claimDueFollowUpJobs,
  completeFollowUpJob,
  cancelFollowUpsForPhone,
  countMarketingSendsToday,
  wasPhoneContactedRecently,
  getMarketingStats,
  addMarketingEvent,
  getAgencySettings
} from "../packages/hub-db/index.mjs";
import {
  discoverMarketingLeads,
  ingestLeadFromUrl,
  getDiscoveryQueries
} from "../packages/marketing-discovery.mjs";
import { researchMarketingLead } from "../packages/company-research.mjs";
import {
  buildAgencyColdOutreachDraftPrompt,
  buildAgencyColdOutreachFallback,
  buildAgencyMarketingFollowUpPrompt
} from "../packages/agency-growth-prompt.mjs";
import {
  readHubEnv,
  getEvolutionConfig,
  resolveEvolutionInstanceToken,
  sendEvolutionText,
  getEvolutionConnectionState
} from "../packages/evolution-client.mjs";
import { isAgencyOutboundPaused } from "../packages/whatsapp-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const HUB_ENV_PATH = path.join(REPO_ROOT, ".env");

const POLL_MS = 1200;
const FOLLOWUP_TICK_MS = Number(process.env.JAB_MARKETING_FOLLOWUP_TICK_MS || 60_000);
const DISCOVER_MS = Number(process.env.JAB_MARKETING_DISCOVER_MS || 3_600_000);

let paused = false;
let hubEnvCache = {};
let offset = 0;
const chatMemory = new Map();
const CHAT_MEMORY_MAX = 12;

function rememberChat(chatId, role, text) {
  const key = String(chatId);
  const rows = chatMemory.get(key) || [];
  rows.push({ role, text: String(text || "").slice(0, 1200) });
  while (rows.length > CHAT_MEMORY_MAX) rows.shift();
  chatMemory.set(key, rows);
}

function getChatHistory(chatId) {
  return chatMemory.get(String(chatId)) || [];
}

function cfg() {
  const env = { ...hubEnvCache, ...process.env };
  const instance =
    env.JAB_MARKETING_INSTANCE ||
    env.JAB_AGENCY_INSTANCE ||
    "jab-whatsapp";
  const dryRun = String(env.JAB_MARKETING_DRY_RUN || "1") !== "0";
  const dailyCap = Math.max(1, Number(env.JAB_MARKETING_DAILY_CAP || 10));
  const cooldownDays = Math.max(1, Number(env.JAB_MARKETING_COOLDOWN_DAYS || 30));
  const followupHours = Math.max(1, Number(env.JAB_MARKETING_FOLLOWUP_HOURS || 48));
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const approvers = String(env.TELEGRAM_APPROVER_IDS || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    instance,
    dryRun,
    dailyCap,
    cooldownMs: cooldownDays * 24 * 60 * 60 * 1000,
    followupHours,
    token,
    approvers,
    braveKey: String(env.BRAVE_SEARCH_API_KEY || "").trim(),
    googleCseKey: String(env.GOOGLE_CSE_API_KEY || "").trim(),
    googleCseId: String(env.GOOGLE_CSE_ID || "").trim(),
    searchProvider: String(env.JAB_MARKETING_SEARCH_PROVIDER || "auto").toLowerCase(),
    geminiKey:
      String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim(),
    geminiModel: env.JAB_HUB_GEMINI_MODEL || env.GEMINI_MODEL || "gemini-2.5-flash"
  };
}

function isApprover(userId) {
  const { approvers } = cfg();
  if (!approvers.length) return false;
  return approvers.includes(String(userId));
}

async function loadEnv() {
  hubEnvCache = await readHubEnv(HUB_ENV_PATH);
  // Promote marketing/.env keys into process.env so discovery providers see them.
  for (const key of [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_APPROVER_IDS",
    "BRAVE_SEARCH_API_KEY",
    "GOOGLE_CSE_API_KEY",
    "GOOGLE_CSE_ID",
    "JAB_MARKETING_SEARCH_PROVIDER",
    "JAB_MARKETING_INSTANCE",
    "JAB_MARKETING_DRY_RUN",
    "JAB_MARKETING_DAILY_CAP",
    "JAB_MARKETING_COOLDOWN_DAYS",
    "JAB_MARKETING_FOLLOWUP_HOURS",
    "JAB_MARKETING_DISCOVER_MS",
    "JAB_MARKETING_QUERIES",
    "AUTHENTICATION_API_KEY",
    "SERVER_URL",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GEMINI_MODEL",
    "JAB_HUB_GEMINI_MODEL"
  ]) {
    if (!process.env[key] && hubEnvCache[key]) process.env[key] = hubEnvCache[key];
  }
  // Prefer OpenClaw google key if present
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
      const key = auth?.profiles?.["google:manual"]?.key;
      if (key) process.env.GEMINI_API_KEY = key;
    } catch {
      /* optional */
    }
  }
}

async function tg(method, body = {}) {
  const { token } = cfg();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
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

async function editTelegram(chatId, messageId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: String(text).slice(0, 3900),
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  else payload.reply_markup = { inline_keyboard: [] };
  try {
    return await tg("editMessageText", payload);
  } catch {
    return null;
  }
}

async function sendTyping(chatId) {
  try {
    await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    /* optional */
  }
}

async function draftWithGemini(prompt, { temperature = 0.7, maxOutputTokens = 400 } = {}) {
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
    signal: AbortSignal.timeout(45000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Gemini draft failed ${response.status}: ${body.slice(0, 200)}`);
  const json = JSON.parse(body || "{}");
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return String(text).trim() || null;
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
    signal: AbortSignal.timeout(45000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Gemini chat failed ${response.status}: ${body.slice(0, 200)}`);
  const json = JSON.parse(body || "{}");
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return String(text).trim() || null;
}

async function generateDraft(lead, research) {
  const opportunityHint = research?.researchJson?.opportunityHint || "";
  const prompt = buildAgencyColdOutreachDraftPrompt({
    businessName: research?.businessName || lead.business_name || lead.businessName,
    industry: research?.industry || lead.industry,
    adText: research?.adText || lead.ad_text || lead.adText,
    researchSummary: research?.researchSummary || lead.research_summary,
    opportunityHint,
    sourceUrl: lead.source_url || lead.sourceUrl,
    location: lead.location || "Ghana"
  });
  try {
    const drafted = await draftWithGemini(prompt);
    if (drafted) return drafted.slice(0, 900);
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), draftError: error.message }));
  }
  return buildAgencyColdOutreachFallback({
    businessName: research?.businessName || lead.business_name || lead.businessName,
    industry: research?.industry || lead.industry,
    opportunityHint,
    adText: research?.adText || lead.ad_text || lead.adText
  });
}

function leadCardText(lead, { header = "Marketing lead" } = {}) {
  const c = cfg();
  return [
    `${header} #${lead.id}`,
    `Status: ${lead.status} · Score: ${lead.score}${c.dryRun ? " · DRY_RUN" : ""}`,
    `Business: ${lead.business_name || "—"}`,
    `Industry: ${lead.industry || "—"} · ${lead.location || "Ghana"}`,
    `WhatsApp: ${lead.whatsapp_phone ? "+" + lead.whatsapp_phone : "MISSING"}`,
    `Platform: ${lead.platform || "—"}`,
    lead.source_url ? `Source: ${lead.source_url}` : null,
    "",
    "Research:",
    String(lead.research_summary || "—").slice(0, 700),
    "",
    "Draft message:",
    String(lead.draft_message || "—").slice(0, 900)
  ]
    .filter((x) => x !== null)
    .join("\n");
}

function leadKeyboard(leadId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve & send", callback_data: `mkt:approve:${leadId}` },
        { text: "♻️ Regenerate", callback_data: `mkt:regen:${leadId}` }
      ],
      [
        { text: "⏭ Skip", callback_data: `mkt:skip:${leadId}` },
        { text: "🚫 Block", callback_data: `mkt:block:${leadId}` }
      ]
    ]
  };
}

async function enrichAndQueueLead(db, raw, { notifyChatId = null } = {}) {
  const c = cfg();
  upsertClient(db, { instanceName: c.instance, displayName: c.instance, status: "open" });

  if (raw.whatsappPhone && wasPhoneContactedRecently(db, c.instance, raw.whatsappPhone, c.cooldownMs)) {
    return { skipped: "cooldown", phone: raw.whatsappPhone };
  }

  const { lead, created } = upsertMarketingLead(db, {
    instanceName: c.instance,
    source: raw.source || "web_search",
    sourceUrl: raw.sourceUrl,
    platform: raw.platform,
    adText: raw.adText,
    businessName: raw.businessName,
    whatsappPhone: raw.whatsappPhone,
    website: raw.website,
    industry: raw.industry,
    location: raw.location || "Ghana",
    score: raw.score || 0,
    fingerprint: raw.fingerprint,
    status: "discovered"
  });

  if (!lead.whatsapp_phone) {
    updateMarketingLead(db, lead.id, { status: "skipped", blockedReason: "missing_whatsapp" });
    return { skipped: "missing_whatsapp", lead };
  }

  const research = await researchMarketingLead({
    sourceUrl: lead.source_url,
    businessName: lead.business_name,
    adText: lead.ad_text,
    whatsappPhone: lead.whatsapp_phone,
    website: lead.website,
    industry: lead.industry
  });

  const draft = await generateDraft(lead, research);
  const updated = updateMarketingLead(db, lead.id, {
    businessName: research.businessName || lead.business_name,
    whatsappPhone: research.whatsappPhone || lead.whatsapp_phone,
    website: research.website || lead.website,
    industry: research.industry || lead.industry,
    adText: research.adText || lead.ad_text,
    researchSummary: research.researchSummary,
    researchJson: research.researchJson,
    draftMessage: draft,
    score: Math.max(Number(lead.score) || 0, Number(raw.score) || 0),
    status: "queued"
  });

  addMarketingEvent(db, {
    leadId: lead.id,
    eventType: "queued",
    detail: created ? "New lead queued for approval" : "Lead refreshed and queued"
  });

  if (notifyChatId) {
    const msg = await sendTelegram(
      notifyChatId,
      leadCardText(updated, { header: "🆕 Queued marketing lead" }),
      leadKeyboard(updated.id)
    );
    updateMarketingLead(db, updated.id, {
      telegramChatId: String(notifyChatId),
      telegramMessageId: String(msg.message_id)
    });
  }

  return { lead: updated, created };
}

async function runDiscovery({ notifyChatId = null, maxQueue = 8 } = {}) {
  const c = cfg();
  const { db } = openHubDb();
  const mergedEnv = { ...hubEnvCache, ...process.env };
  const result = await discoverMarketingLeads({
    maxResults: 25,
    env: mergedEnv
  });
  if (!result.ok) {
    return result;
  }
  const queued = [];
  let researched = 0;
  let skippedNoPhone = 0;
  // Prefer hits that already include a WhatsApp number, then other business-looking pages.
  const candidates = [...result.eligible].sort((a, b) => {
    const ap = a.whatsappPhone ? 1 : 0;
    const bp = b.whatsappPhone ? 1 : 0;
    if (bp !== ap) return bp - ap;
    return (b.score || 0) - (a.score || 0);
  });
  for (const hit of candidates) {
    if (queued.length >= maxQueue) break;
    researched += 1;
    const out = await enrichAndQueueLead(db, hit, { notifyChatId });
    if (out.skipped === "missing_whatsapp") {
      skippedNoPhone += 1;
      continue;
    }
    if (out.lead && out.lead.status === "queued") queued.push(out.lead);
  }
  return {
    ok: true,
    provider: result.provider || "unknown",
    braveConfigured: Boolean(c.braveKey),
    found: result.leads.length,
    eligible: result.eligible.length,
    researched,
    skippedNoPhone,
    queued: queued.length,
    leads: queued
  };
}

async function getEvoSendContext() {
  const c = cfg();
  const { evoApiUrl, globalKey } = getEvolutionConfig(hubEnvCache, process.env);
  if (!globalKey) throw new Error("AUTHENTICATION_API_KEY / EVO_GLOBAL_KEY missing");
  const { token } = await resolveEvolutionInstanceToken(evoApiUrl, globalKey, c.instance);
  const state = await getEvolutionConnectionState(evoApiUrl, token, c.instance);
  const open = state?.instance?.state === "open" || state?.state === "open";
  if (!open) throw new Error(`Evolution instance ${c.instance} is not open`);
  return { evoApiUrl, apiKey: token, instance: c.instance };
}

async function sendApprovedLead(db, lead, { approvedBy }) {
  const c = cfg();
  if (isAgencyOutboundPaused()) {
    throw new Error("Agency outbound paused (JAB_AGENCY_OUTBOUND_PAUSE) — cold sends blocked");
  }
  if (!lead?.whatsapp_phone) throw new Error("Lead missing WhatsApp number");
  const existingContact = getContactByPhone(db, c.instance, lead.whatsapp_phone);
  if (existingContact?.opted_out) {
    throw new Error("Contact opted out — cold send blocked");
  }
  if (countMarketingSendsToday(db, c.instance) >= c.dailyCap) {
    throw new Error(`Daily send cap reached (${c.dailyCap})`);
  }
  const bypassCooldown = String(process.env.JAB_MARKETING_BYPASS_COOLDOWN || "").toLowerCase() === "1";
  if (
    !bypassCooldown &&
    wasPhoneContactedRecently(db, c.instance, lead.whatsapp_phone, c.cooldownMs)
  ) {
    throw new Error("Phone recently contacted / cooldown active");
  }

  const contact = upsertContact(db, {
    instanceName: c.instance,
    phone: lead.whatsapp_phone,
    pushName: lead.business_name || null,
    lastInboundText: null
  });

  const approved = approveMarketingLead(db, lead.id, {
    approvedBy,
    contactId: contact?.id || null
  });
  if (!approved) throw new Error("Could not approve lead (status conflict)");

  const draft = String(approved.draft_message || "").trim();
  if (!draft) throw new Error("Draft message empty");

  if (c.dryRun) {
    markMarketingLeadSent(db, approved.id, { contactId: contact?.id || null });
    addMarketingEvent(db, {
      leadId: approved.id,
      eventType: "dry_run_sent",
      detail: "DRY_RUN — message not sent to WhatsApp"
    });
    scheduleFollowUpJob(db, {
      leadId: approved.id,
      contactId: contact?.id || null,
      instanceName: c.instance,
      phone: approved.whatsapp_phone,
      dueAt: Date.now() + c.followupHours * 3600 * 1000,
      kind: "marketing_followup",
      maxAttempts: 1,
      idempotencyKey: `marketing_followup:${approved.id}:1`
    });
    return { dryRun: true, lead: getMarketingLead(db, approved.id), draft };
  }

  const evo = await getEvoSendContext();
  await sendEvolutionText({
    evoApiUrl: evo.evoApiUrl,
    apiKey: evo.apiKey,
    instance: evo.instance,
    number: approved.whatsapp_phone,
    text: draft,
    category: "proactive",
    isAgency: true
  });

  markMarketingLeadSent(db, approved.id, { contactId: contact?.id || null });
  scheduleFollowUpJob(db, {
    leadId: approved.id,
    contactId: contact?.id || null,
    instanceName: c.instance,
    phone: approved.whatsapp_phone,
    dueAt: Date.now() + c.followupHours * 3600 * 1000,
    kind: "marketing_followup",
    maxAttempts: 1,
    idempotencyKey: `marketing_followup:${approved.id}:1`
  });

  return { dryRun: false, lead: getMarketingLead(db, approved.id), draft };
}

async function handleCallback(cb) {
  const data = String(cb.data || "");
  const fromId = cb.from?.id;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;

  if (!isApprover(fromId)) {
    await answerCallback(cb.id, "Not authorized");
    return;
  }

  const m = data.match(/^mkt:(approve|regen|skip|block):(\d+)$/);
  if (!m) {
    await answerCallback(cb.id, "Unknown action");
    return;
  }
  const action = m[1];
  const leadId = Number(m[2]);
  const { db } = openHubDb();
  const lead = getMarketingLead(db, leadId);
  if (!lead) {
    await answerCallback(cb.id, "Lead not found");
    return;
  }

  if (action === "skip") {
    await answerCallback(cb.id, "Skipped");
    const updated = markMarketingLeadSkipped(db, leadId, `skipped_by:${fromId}`);
    await editTelegram(chatId, messageId, leadCardText(updated || lead, { header: "⏭ Skipped" }));
    return;
  }

  if (action === "block") {
    await answerCallback(cb.id, "Blocked");
    const updated = markMarketingLeadBlocked(db, leadId, `blocked_by:${fromId}`);
    if (updated?.whatsapp_phone) {
      cancelFollowUpsForPhone(db, cfg().instance, updated.whatsapp_phone, "blocked");
    }
    await editTelegram(chatId, messageId, leadCardText(updated || lead, { header: "🚫 Blocked" }));
    return;
  }

  if (action === "regen") {
    await answerCallback(cb.id, "Regenerating…");
    const research = {
      businessName: lead.business_name,
      industry: lead.industry,
      adText: lead.ad_text,
      researchSummary: lead.research_summary,
      researchJson: (() => {
        try {
          return JSON.parse(lead.research_json || "{}");
        } catch {
          return {};
        }
      })()
    };
    const draft = await generateDraft(lead, research);
    const updated = updateMarketingLead(db, leadId, {
      draftMessage: draft,
      status: lead.status === "queued" ? "queued" : "researched"
    });
    addMarketingEvent(db, { leadId, eventType: "regenerated", detail: `By ${fromId}` });
    await editTelegram(
      chatId,
      messageId,
      leadCardText(updated, { header: "♻️ Regenerated draft" }),
      leadKeyboard(leadId)
    );
    return;
  }

  if (action === "approve") {
    await answerCallback(cb.id, cfg().dryRun ? "Approving (dry-run)…" : "Sending…");
    try {
      const result = await sendApprovedLead(db, lead, { approvedBy: String(fromId) });
      const header = result.dryRun ? "✅ Approved (DRY_RUN — not sent)" : "✅ Sent on WhatsApp";
      await editTelegram(chatId, messageId, leadCardText(result.lead, { header }));
    } catch (error) {
      updateMarketingLead(db, leadId, { error: error.message });
      addMarketingEvent(db, { leadId, eventType: "send_error", detail: error.message });
      await editTelegram(
        chatId,
        messageId,
        leadCardText(getMarketingLead(db, leadId), { header: `❌ Send failed: ${error.message}` }),
        leadKeyboard(leadId)
      );
    }
  }
}

function extractHttpUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[),.;]+$/, "") : null;
}

function normalizeChatText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s@:/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAffirmation(text) {
  const t = normalizeChatText(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|run it|send it|proceed|correct|affirmative)( please| now| boss| chale| bro)?[!.?]*$/.test(
    t
  );
}

function isClearDiscoverAction(text) {
  const t = normalizeChatText(text);
  return (
    /\b(run|start|trigger|do|kick off|fire up)\b.*\bdiscover/.test(t) ||
    /\bdiscover(y)?\s*(now|please|leads)?[!.?]*$/.test(t) ||
    /\bfind (me )?(some )?(new )?(leads|prospects|businesses|clients)\b/.test(t) ||
    /\bsearch (for|the web for) (leads|businesses|prospects)\b/.test(t)
  );
}

function isClearQueueAction(text) {
  const t = normalizeChatText(text);
  return (
    /\b(show|open|list|see|check)\b.*\b(queue|pending approvals?|approval cards?)\b/.test(t) ||
    /\bwhat needs (my )?approval\b/.test(t) ||
    /\bany(thing)? (waiting|pending)\b/.test(t)
  );
}

function isClearPauseAction(text) {
  const t = normalizeChatText(text);
  return /\b(pause|stop|hold)\b.*\b(discover(y|ies)?|search(ing)?|automation)\b/.test(t) || t === "pause";
}

function isClearResumeAction(text) {
  const t = normalizeChatText(text);
  return /\b(resume|continue|unpause|start again)\b/.test(t) && /\b(discover|search|automation)\b/.test(t);
}

function isClearDryRunOff(text) {
  const t = normalizeChatText(text);
  return (
    /\bdry[\s-]?run\s+off\b/.test(t) ||
    /\b(go|switch)\s+live\b/.test(t) ||
    /\bsend for real\b/.test(t) ||
    /\bturn off dry[\s-]?run\b/.test(t)
  );
}

function isClearDryRunOn(text) {
  const t = normalizeChatText(text);
  return (
    /\bdry[\s-]?run\s+on\b/.test(t) ||
    /\bsafe mode\b/.test(t) ||
    /\bturn on dry[\s-]?run\b/.test(t)
  );
}

function wantsSlashHelp(text) {
  const t = normalizeChatText(text);
  // Only the literal command list — plain “help” / “how do I…” goes to natural chat.
  return /^(commands|\/help)[!.?]*$/.test(t) || /\b(list|show) (the )?commands\b/.test(t);
}

function classifyNaturalLanguage(text, history = []) {
  const url = extractHttpUrl(text);
  // Only act on a bare/pasted URL — not every message that mentions a link in passing.
  if (url && /^\s*https?:\/\//i.test(text.trim()) && !/\b(don't|do not|skip|ignore)\b/i.test(text)) {
    return { kind: "action_lead", url };
  }
  // Explicit ops only — everything else chats naturally (including status/help/small talk).
  if (isClearDiscoverAction(text)) return { kind: "action_discover" };
  if (isClearQueueAction(text)) return { kind: "action_queue" };
  if (isClearPauseAction(text)) return { kind: "action_pause" };
  if (isClearResumeAction(text)) return { kind: "action_resume" };
  if (isClearDryRunOff(text)) return { kind: "action_dryrun", arg: "off" };
  if (isClearDryRunOn(text)) return { kind: "action_dryrun", arg: "on" };
  if (wantsSlashHelp(text)) return { kind: "help" };

  const lastAssistant = [...history].reverse().find((h) => h.role === "assistant")?.text || "";
  if (isAffirmation(text) && /\bdiscover(y|ies)?\b/i.test(lastAssistant)) {
    return { kind: "action_discover" };
  }
  if (isAffirmation(text) && /\b(queue|approval|pending)\b/i.test(lastAssistant)) {
    return { kind: "action_queue" };
  }

  return { kind: "chat" };
}

async function buildRichChatContext(db) {
  const c = cfg();
  const stats = getMarketingStats(db, c.instance);
  const queued = listMarketingLeads(db, {
    instanceName: c.instance,
    status: "queued",
    limit: 5
  });
  const recent = listMarketingLeads(db, {
    instanceName: c.instance,
    limit: 5
  });
  const queueLines = queued.length
    ? queued.map((l) => `- ${l.business_name || "Unknown"} (score ${Math.round(l.score || 0)})`).join("\n")
    : "- none waiting";
  const recentLines = recent.length
    ? recent
        .map((l) => `- ${l.business_name || "Unknown"} · ${l.status}${l.score ? ` · ${Math.round(l.score)}` : ""}`)
        .join("\n")
    : "- none yet";

  return [
    `WhatsApp instance: ${c.instance}`,
    `Mode: ${c.dryRun ? "DRY_RUN (approvals only, no real WhatsApp send)" : "LIVE (approved sends go out on WhatsApp)"}`,
    `Discovery paused: ${paused}`,
    `Sent today: ${stats.sentToday} of ${c.dailyCap}`,
    `Pending follow-ups: ${stats.pendingFollowups}`,
    `Lead counts: ${JSON.stringify(stats.byStatus)}`,
    `Search: ${c.searchProvider} · Brave key ${c.braveKey ? "configured" : "missing"}`,
    `Queued for approval:\n${queueLines}`,
    `Recent leads:\n${recentLines}`
  ].join("\n");
}

function marketingChatSystemPrompt(context) {
  return [
    "You are Agyenim’s proactive sales partner on Telegram for JAB Digital Hub.",
    "You help find Ghana SMB leads, research them, draft WhatsApp outreach, and get approvals before any send.",
    "",
    "How to talk:",
    "- Chat like a real colleague — warm, sharp, slightly Ghana-friendly when it fits.",
    "- NEVER sound like a bot manual, FAQ, or system status dump.",
    "- Do not recite slash commands unless they explicitly ask for commands.",
    "- Mirror their energy: short if they are short; banter if they are casual.",
    "- Prefer 1–3 short paragraphs. Ask at most one question when useful.",
    "- Use live context only for facts (counts, dry-run, queue). Never invent leads or sends.",
    "- If they ask how things are going, answer in plain speech (e.g. “We sent 2 today, 1 waiting for your approve”).",
    "- If they want something done, confirm naturally — they can also say “run discovery” / “show queue”.",
    "- First WhatsApp outbound to a lead always needs their Approve tap on a card.",
    "",
    "You are the agency sales/ops agent only — not a client store bot.",
    "",
    "Live context (for accuracy; don’t dump raw):",
    context
  ].join("\n");
}

async function replyNaturalLanguage(chatId, userText, db) {
  const context = await buildRichChatContext(db);
  const history = getChatHistory(chatId);
  const systemPrompt = marketingChatSystemPrompt(context);

  let reply = null;
  try {
    reply = await draftChatWithGemini({ systemPrompt, history, userText });
  } catch {
    /* fallback below */
  }
  if (!reply) {
    reply =
      "I’m here with you — we can hunt leads, check what’s waiting for approval, or just talk through the pipeline. What do you feel like doing?";
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
        ? "Not authorized. Add your Telegram user id to TELEGRAM_APPROVER_IDS in .env.\nYour id: " +
            fromId
        : [
            "Welcome. Your Telegram user id is:",
            String(fromId),
            "",
            "Add this to your jab-hub .env:",
            `TELEGRAM_APPROVER_IDS=${fromId}`,
            "",
            "Then restart: node scripts/proactive-marketing-agent.mjs",
            "Keep JAB_MARKETING_DRY_RUN=1 until you are ready for live WhatsApp sends."
          ].join("\n")
    );
    return;
  }

  const { db } = openHubDb();
  const c = cfg();

  // Slash commands
  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.split(/\s+/);
    const command = cmd.split("@")[0].toLowerCase();
    return handleSlashCommand({ chatId, command, rest, db, c });
  }

  // Natural language
  await sendTyping(chatId);
  const history = getChatHistory(chatId);
  const intent = classifyNaturalLanguage(text, history);

  if (intent.kind === "help") {
    return handleSlashCommand({ chatId, command: "/help", rest: [], db, c });
  }
  if (intent.kind === "action_discover") {
    rememberChat(chatId, "user", text);
    return handleSlashCommand({ chatId, command: "/discover", rest: [], db, c });
  }
  if (intent.kind === "action_queue") {
    rememberChat(chatId, "user", text);
    return handleSlashCommand({ chatId, command: "/queue", rest: [], db, c });
  }
  if (intent.kind === "action_pause") {
    rememberChat(chatId, "user", text);
    return handleSlashCommand({ chatId, command: "/pause", rest: [], db, c });
  }
  if (intent.kind === "action_resume") {
    rememberChat(chatId, "user", text);
    return handleSlashCommand({ chatId, command: "/resume", rest: [], db, c });
  }
  if (intent.kind === "action_dryrun") {
    rememberChat(chatId, "user", text);
    return handleSlashCommand({ chatId, command: "/dryrun", rest: [intent.arg], db, c });
  }
  if (intent.kind === "action_lead") {
    rememberChat(chatId, "user", text);
    return handleSlashCommand({ chatId, command: "/lead", rest: [intent.url], db, c });
  }

  return replyNaturalLanguage(chatId, text, db);
}

async function handleSlashCommand({ chatId, command, rest, db, c }) {
  if (command === "/start" || command === "/help") {
    await sendTelegram(
      chatId,
      [
        "Hey — I’m your JAB sales partner on Telegram.",
        c.dryRun
          ? "We’re in dry-run right now (I draft & queue; no live WhatsApp until you flip it)."
          : "Live mode is on — approved cards can go out on WhatsApp.",
        "",
        "Just talk to me like a colleague. Ask how the pipeline looks, brainstorm angles, paste a business URL, or say “find some leads” / “show what’s waiting”.",
        "",
        "If you prefer buttons: /discover · /queue · /status · /lead <url> · /pause · /resume · /dryrun on|off",
        "First outbound WhatsApp always needs your Approve tap."
      ].join("\n")
    );
    return;
  }

  if (command === "/status") {
    const stats = getMarketingStats(db, c.instance);
    const agency = getAgencySettings(db);
    await sendTelegram(
      chatId,
      [
        `Paused: ${paused}`,
        `Dry-run: ${c.dryRun}`,
        `Agency instance setting: ${agency?.agency_instance_name || "—"}`,
        `Marketing instance: ${c.instance}`,
        `Sent today: ${stats.sentToday}/${c.dailyCap}`,
        `Pending follow-ups: ${stats.pendingFollowups}`,
        `By status: ${JSON.stringify(stats.byStatus)}`,
        `Search: ${c.searchProvider} (Brave ${c.braveKey ? "set" : "no"} · Google CSE ${
          c.googleCseKey && c.googleCseId ? "set" : "no"
        } · DuckDuckGo free fallback)`,
        `Queries: ${getDiscoveryQueries().length}`
      ].join("\n")
    );
    return;
  }

  if (command === "/pause") {
    paused = true;
    await sendTelegram(chatId, "Scheduled discovery paused.");
    return;
  }
  if (command === "/resume") {
    paused = false;
    await sendTelegram(chatId, "Scheduled discovery resumed.");
    return;
  }

  if (command === "/dryrun") {
    const arg = String(rest[0] || "").toLowerCase();
    if (arg === "on") process.env.JAB_MARKETING_DRY_RUN = "1";
    else if (arg === "off") process.env.JAB_MARKETING_DRY_RUN = "0";
    await sendTelegram(chatId, `Dry-run is now ${cfg().dryRun ? "ON" : "OFF"}`);
    return;
  }

  if (command === "/discover") {
    await sendTelegram(chatId, "On it — running discovery now…");
    const result = await runDiscovery({ notifyChatId: chatId, maxQueue: 8 });
    if (!result.ok) {
      const msg = `Couldn't run discovery: ${result.reason || result.error || "unknown"}${result.note ? `\n${result.note}` : ""}`.trim();
      rememberChat(chatId, "assistant", msg);
      await sendTelegram(chatId, msg);
      return;
    }
    const msg = [
      `Done — searched via ${result.provider}.`,
      `Found ${result.found} pages, ${result.eligible} looked promising, researched ${result.researched || 0},`,
      `${result.queued} queued for your approval${result.skippedNoPhone ? ` (${result.skippedNoPhone} had no WhatsApp on the page)` : ""}.`
    ].join(" ");
    rememberChat(chatId, "assistant", msg);
    await sendTelegram(chatId, msg);
    return;
  }

  if (command === "/queue") {
    const rows = listMarketingLeads(db, { instanceName: c.instance, status: "queued", limit: 10 });
    if (!rows.length) {
      const msg = "Nothing in the queue right now — want me to run discovery?";
      rememberChat(chatId, "assistant", msg);
      await sendTelegram(chatId, msg);
      return;
    }
    for (const lead of rows) {
      const sent = await sendTelegram(chatId, leadCardText(lead), leadKeyboard(lead.id));
      updateMarketingLead(db, lead.id, {
        telegramChatId: String(chatId),
        telegramMessageId: String(sent.message_id)
      });
    }
    return;
  }

  if (command === "/lead") {
    const url = rest.join(" ").trim();
    if (!url) {
      await sendTelegram(chatId, "Usage: /lead https://…");
      return;
    }
    await sendTelegram(chatId, "Ingesting URL…");
    try {
      const normalized = await ingestLeadFromUrl(url);
      const out = await enrichAndQueueLead(db, normalized, { notifyChatId: chatId });
      if (out.skipped) {
        await sendTelegram(chatId, `Skipped: ${out.skipped}`);
      }
    } catch (error) {
      await sendTelegram(chatId, `Failed: ${error.message}`);
    }
    return;
  }

  await sendTelegram(chatId, "Unknown command. Try /help — or just ask in plain English.");
}

async function processFollowUps() {
  const c = cfg();
  const { db } = openHubDb();
  const jobs = claimDueFollowUpJobs(db, { limit: 3 });
  for (const job of jobs) {
    try {
      const lead = job.lead_id ? getMarketingLead(db, job.lead_id) : null;
      if (lead && ["replied", "converted", "blocked"].includes(lead.status)) {
        completeFollowUpJob(db, job.id, { status: "cancelled", error: lead.status });
        continue;
      }
      const contact = getContactByPhone(db, job.instance_name, job.phone);
      if (contact?.opted_out) {
        completeFollowUpJob(db, job.id, { status: "cancelled", error: "opted_out" });
        continue;
      }
      const prompt = buildAgencyMarketingFollowUpPrompt({
        businessName: lead?.business_name || contact?.push_name || "",
        industry: lead?.industry || "",
        daysSinceSend: Math.max(1, Math.round(c.followupHours / 24))
      });
      let text = null;
      try {
        text = await draftWithGemini(prompt);
      } catch {
        /* fallback below */
      }
      if (!text) {
        text = `Hi${lead?.business_name ? " " + lead.business_name : ""} — just checking if WhatsApp automation for your enquiries is still useful. Happy to close the loop if not.`;
      }
      if (c.dryRun) {
        addMarketingEvent(db, {
          leadId: job.lead_id,
          eventType: "dry_run_followup",
          detail: text.slice(0, 500)
        });
        completeFollowUpJob(db, job.id, { status: "done" });
        continue;
      }
      if (isAgencyOutboundPaused()) {
        completeFollowUpJob(db, job.id, { status: "cancelled", error: "agency_outbound_paused" });
        continue;
      }
      const evo = await getEvoSendContext();
      await sendEvolutionText({
        evoApiUrl: evo.evoApiUrl,
        apiKey: evo.apiKey,
        instance: job.instance_name || evo.instance,
        number: job.phone,
        text: text.slice(0, 900),
        category: "proactive",
        isAgency: true
      });
      addMarketingEvent(db, {
        leadId: job.lead_id,
        eventType: "followup_sent",
        detail: text.slice(0, 500)
      });
      completeFollowUpJob(db, job.id, { status: "done" });
    } catch (error) {
      completeFollowUpJob(db, job.id, { status: "failed", error: error.message });
    }
  }
}

async function pollTelegram() {
  const updates = await tg("getUpdates", {
    offset,
    timeout: 25,
    allowed_updates: ["message", "callback_query"]
  });
  for (const update of updates) {
    offset = update.update_id + 1;
    try {
      if (update.callback_query) await handleCallback(update.callback_query);
      else if (update.message) await handleMessage(update.message);
    } catch (error) {
      console.error(
        JSON.stringify({ at: new Date().toISOString(), updateError: error.message })
      );
    }
  }
}

async function main() {
  await loadEnv();
  const c = cfg();
  if (!c.token) {
    console.error("TELEGRAM_BOT_TOKEN is required. Create a bot with @BotFather and set it in .env");
    process.exit(1);
  }
  if (!c.approvers.length) {
    console.warn(
      JSON.stringify({
        at: new Date().toISOString(),
        warn: "TELEGRAM_APPROVER_IDS empty — message the bot with /start to learn your user id, then set it in .env"
      })
    );
  }

  openHubDb();
  const me = await tg("getMe");
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      service: "jab-proactive-marketing",
      bot: me.username,
      instance: c.instance,
      dryRun: c.dryRun,
      dailyCap: c.dailyCap
    })
  );

  let lastDiscover = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollTelegram();
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), pollError: error.message }));
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    const now = Date.now();
    if (!paused && DISCOVER_MS > 0 && now - lastDiscover >= DISCOVER_MS) {
      lastDiscover = now;
      if (DISCOVER_MS > 0) {
        try {
          const result = await runDiscovery({ maxQueue: 5 });
          console.log(JSON.stringify({ at: new Date().toISOString(), scheduledDiscover: result }));
        } catch (error) {
          console.error(
            JSON.stringify({ at: new Date().toISOString(), discoverError: error.message })
          );
        }
      }
    }

    if (now % FOLLOWUP_TICK_MS < POLL_MS + 1000) {
      try {
        await processFollowUps();
      } catch (error) {
        console.error(
          JSON.stringify({ at: new Date().toISOString(), followupError: error.message })
        );
      }
    }
  }
}

// Export helpers for tests / bridge notifications
export {
  cfg,
  enrichAndQueueLead,
  runDiscovery,
  sendApprovedLead,
  leadCardText,
  generateDraft,
  markMarketingLeadReplied
};

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
