/**
 * UAE Real Estate lead ops bot (Telegram).
 * After phone qualification, approve sending the lead to the listing agent's WhatsApp.
 *
 * Usage:
 *   node scripts/proactive-re-leads-bot.mjs
 *
 * Required env:
 *   TELEGRAM_RE_LEADS_BOT_TOKEN
 *   TELEGRAM_RE_LEADS_APPROVER_IDS
 * Optional:
 *   JAB_RE_LEADS_INSTANCE=jab-whatsapp
 *   JAB_RE_LEADS_DRY_RUN=1
 *   EVO_API_URL / AUTHENTICATION_API_KEY (Evolution)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  openHubDb,
  listLeadsByStatus,
  getReLead,
  getListing,
  updateLead
} from "../packages/hub-db/index.mjs";
import {
  readHubEnv,
  getEvolutionConfig,
  resolveEvolutionInstanceToken,
  sendEvolutionText
} from "../packages/evolution-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const HUB_ENV_PATH = path.join(REPO_ROOT, ".env");
const POLL_MS = 1500;
const QUEUE_TICK_MS = Number(process.env.JAB_RE_LEADS_QUEUE_MS || 120_000);

let hubEnvCache = {};
let offset = 0;

function cfg() {
  const env = { ...hubEnvCache, ...process.env };
  return {
    token: String(env.TELEGRAM_RE_LEADS_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || "").trim(),
    approvers: String(env.TELEGRAM_RE_LEADS_APPROVER_IDS || env.TELEGRAM_APPROVER_IDS || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    instance: env.JAB_RE_LEADS_INSTANCE || env.JAB_AGENCY_INSTANCE || "jab-whatsapp",
    dryRun: String(env.JAB_RE_LEADS_DRY_RUN || "1") !== "0"
  };
}

function isApprover(userId) {
  const { approvers } = cfg();
  if (!approvers.length) return false;
  return approvers.includes(String(userId));
}

async function tg(method, body = {}) {
  const { token } = cfg();
  if (!token) throw new Error("TELEGRAM_RE_LEADS_BOT_TOKEN missing");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description || JSON.stringify(json)}`);
  return json.result;
}

function leadCard(lead, listing, { header = "" } = {}) {
  const criteria = lead.criteria || {};
  const lines = [
    header || "🏠 UAE Property Lead",
    `ID: ${lead.id}`,
    `Status: ${lead.ops_status}`,
    `Score: ${lead.qualification_score}/100`,
    "",
    `Renter: ${lead.renter_name || "—"} · ${lead.renter_phone}`,
    criteria.transaction_type ? `Want: ${criteria.transaction_type}` : null,
    criteria.emirates?.length ? `Emirates: ${criteria.emirates.join(", ")}` : null,
    criteria.beds != null ? `Beds: ${criteria.beds}` : null,
    criteria.max_price != null ? `Budget: up to AED ${criteria.max_price}` : null,
    "",
    listing
      ? `Listing: ${listing.beds || "?"}BR · ${listing.community || listing.emirate} · AED ${listing.price_aed}`
      : "Listing: general search (no specific pick)",
    listing?.agent_name ? `Agent: ${listing.agent_name}` : null,
    listing?.agent_phone ? `Agent WA: ${listing.agent_phone}` : null,
    listing?.source_url ? `URL: ${listing.source_url}` : null,
    "",
    "Draft WhatsApp to agent:",
    String(lead.draft_message || "").slice(0, 900)
  ].filter(Boolean);
  return lines.join("\n");
}

function leadKeyboard(leadId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Send to agent WA", callback_data: `re:send:${leadId}` },
        { text: "⏭ Skip", callback_data: `re:skip:${leadId}` }
      ],
      [
        { text: "📞 Called", callback_data: `re:called:${leadId}` },
        { text: "🚫 Bad lead", callback_data: `re:bad:${leadId}` }
      ]
    ]
  };
}

async function notifyNewLeads(db, chatId) {
  const leads = listLeadsByStatus(db, "new", 10);
  for (const lead of leads) {
    if (lead.telegram_message_id) continue;
    const listing = lead.listing_id ? getListing(db, lead.listing_id) : null;
    const msg = await tg("sendMessage", {
      chat_id: chatId,
      text: leadCard(lead, listing, { header: "🆕 New lead — review after your call" }),
      reply_markup: leadKeyboard(lead.id)
    });
    updateLead(db, lead.id, {
      telegram_chat_id: String(chatId),
      telegram_message_id: String(msg.message_id)
    });
  }
}

async function sendLeadToAgent(db, leadId, approvedBy) {
  const lead = getReLead(db, leadId);
  if (!lead) throw new Error("Lead not found");
  const listing = lead.listing_id ? getListing(db, lead.listing_id) : null;
  const agentPhone = listing?.agent_phone;
  if (!agentPhone) throw new Error("No listing agent phone on file");

  const { instance, dryRun } = cfg();
  const draft = String(lead.draft_message || "").trim();
  if (!draft) throw new Error("Empty draft message");

  if (dryRun) {
    updateLead(db, leadId, {
      ops_status: "approved_send",
      sent_to_agent_phone: agentPhone,
      notes: `dry_run by ${approvedBy}`
    });
    return { dryRun: true, lead: getReLead(db, leadId), listing };
  }

  const hubEnv = await readHubEnv(HUB_ENV_PATH);
  const { evoApiUrl, globalKey } = getEvolutionConfig(hubEnv, process.env);
  const { token } = await resolveEvolutionInstanceToken(evoApiUrl, globalKey, instance);
  const digits = agentPhone.replace(/\D/g, "");

  await sendEvolutionText({
    evoApiUrl,
    apiKey: token,
    instance,
    number: digits,
    text: draft,
    linkPreview: true
  });

  updateLead(db, leadId, {
    ops_status: "sent",
    sent_to_agent_phone: agentPhone,
    sent_at: Date.now(),
    notes: `sent by ${approvedBy}`
  });
  return { dryRun: false, lead: getReLead(db, leadId), listing };
}

async function handleCallback(cb) {
  const data = String(cb.data || "");
  const fromId = cb.from?.id;
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;

  if (!isApprover(fromId)) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Not authorized" });
    return;
  }

  const m = data.match(/^re:(send|skip|called|bad):(.+)$/);
  if (!m) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Unknown action" });
    return;
  }

  const action = m[1];
  const leadId = m[2];
  const { db } = openHubDb();
  const lead = getReLead(db, leadId);
  if (!lead) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Lead not found" });
    return;
  }
  const listing = lead.listing_id ? getListing(db, lead.listing_id) : null;

  if (action === "skip") {
    updateLead(db, leadId, { ops_status: "skipped", notes: `skipped by ${fromId}` });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Skipped" });
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: leadCard(getReLead(db, leadId), listing, { header: "⏭ Skipped" })
    });
    return;
  }

  if (action === "bad") {
    updateLead(db, leadId, { ops_status: "bad", notes: `bad by ${fromId}` });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Marked bad" });
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: leadCard(getReLead(db, leadId), listing, { header: "🚫 Bad lead" })
    });
    return;
  }

  if (action === "called") {
    updateLead(db, leadId, { ops_status: "called", notes: `called by ${fromId}` });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Marked called" });
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: leadCard(getReLead(db, leadId), listing, { header: "📞 Called — ready to send?" }),
      reply_markup: leadKeyboard(leadId)
    });
    return;
  }

  if (action === "send") {
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Sending…" });
    try {
      const result = await sendLeadToAgent(db, leadId, String(fromId));
      const header = result.dryRun ? "✅ Approved (DRY_RUN)" : "✅ Sent to agent WhatsApp";
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: leadCard(result.lead, result.listing, { header })
      });
    } catch (error) {
      updateLead(db, leadId, { notes: error.message });
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: leadCard(getReLead(db, leadId), listing, { header: `❌ ${error.message}` }),
        reply_markup: leadKeyboard(leadId)
      });
    }
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  const text = String(msg.text || "").trim();

  if (!isApprover(fromId)) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `Unauthorized. Your Telegram id: ${fromId}\nAdd to TELEGRAM_RE_LEADS_APPROVER_IDS`
    });
    return;
  }

  const { db } = openHubDb();

  if (text === "/start" || text === "/help") {
    await tg("sendMessage", {
      chat_id: chatId,
      text: [
        "UAE Real Estate Lead Ops",
        "",
        "/queue — post new lead cards",
        "/status — lead counts",
        "",
        "After your phone call with the renter, tap Send to agent WA or Skip.",
        `DRY_RUN: ${cfg().dryRun ? "ON" : "OFF"}`
      ].join("\n")
    });
    return;
  }

  if (text === "/queue") {
    await notifyNewLeads(db, chatId);
    await tg("sendMessage", { chat_id: chatId, text: "Queue refreshed." });
    return;
  }

  if (text === "/status") {
    const counts = {};
    for (const status of ["new", "called", "sent", "skipped", "bad"]) {
      counts[status] = db.prepare(`SELECT COUNT(*) AS n FROM re_leads WHERE ops_status = ?`).get(status)?.n || 0;
    }
    await tg("sendMessage", { chat_id: chatId, text: `Lead counts:\n${JSON.stringify(counts, null, 2)}` });
  }
}

async function poll() {
  const { token, approvers } = cfg();
  if (!token || !approvers.length) {
    console.error("Set TELEGRAM_RE_LEADS_BOT_TOKEN and TELEGRAM_RE_LEADS_APPROVER_IDS");
    process.exit(1);
  }

  try {
    const updates = await tg("getUpdates", { offset, timeout: 30 });
    for (const update of updates) {
      offset = update.update_id + 1;
      if (update.callback_query) await handleCallback(update.callback_query);
      if (update.message) await handleMessage(update.message);
    }
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), pollError: error.message }));
  }
}

async function queueTick() {
  const { approvers } = cfg();
  if (!approvers.length) return;
  const chatId = approvers[0];
  const { db } = openHubDb();
  await notifyNewLeads(db, chatId);
}

async function main() {
  try {
    hubEnvCache = await readHubEnv(HUB_ENV_PATH);
  } catch {
    hubEnvCache = {};
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), event: "re_leads_bot_start", dryRun: cfg().dryRun }));
  setInterval(queueTick, QUEUE_TICK_MS);
  for (;;) {
    await poll();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
