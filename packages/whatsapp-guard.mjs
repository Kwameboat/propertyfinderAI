/**
 * Outbound WhatsApp guards — reduce Meta/Baileys ban risk.
 * Inbound replies stay allowed; proactive/ops/campaign traffic is throttled and capped.
 */

const lastSendByKey = new Map();
const dailyCountByKey = new Map();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pause non-reply outbound on agency instance (ops alerts, marketing, follow-ups). */
export function isAgencyOutboundPaused() {
  const pause = String(process.env.JAB_AGENCY_OUTBOUND_PAUSE || "").toLowerCase();
  if (["1", "on", "true", "yes"].includes(pause)) return true;
  const enabled = String(process.env.JAB_AGENCY_OUTBOUND_ENABLED ?? "1").toLowerCase();
  return ["0", "off", "false", "no"].includes(enabled);
}

export function agencyAutoFollowupsEnabled() {
  return ["1", "on", "true", "yes"].includes(String(process.env.JAB_AGENCY_FOLLOWUP || "off").toLowerCase());
}

export function agencyTypingEnabled() {
  const raw = String(process.env.JAB_AGENCY_TYPING ?? process.env.JAB_HUB_TYPING ?? "off").toLowerCase();
  return ["1", "on", "true", "yes"].includes(raw);
}

export function hubTypingEnabled() {
  const raw = String(process.env.JAB_HUB_TYPING ?? "on").toLowerCase();
  return !["0", "off", "false", "no"].includes(raw);
}

function minDelayMs(category) {
  const map = {
    reply: Number(process.env.JAB_WA_REPLY_MIN_MS || 800),
    ops: Number(process.env.JAB_WA_OPS_MIN_MS || 5000),
    proactive: Number(process.env.JAB_WA_PROACTIVE_MIN_MS || 10000),
    campaign: Number(process.env.JAB_WA_CAMPAIGN_MIN_MS || 5000),
    default: Number(process.env.JAB_WA_SEND_MIN_MS || 2000)
  };
  return map[category] || map.default;
}

function dailyCap(category) {
  if (category === "proactive") {
    return Number(process.env.JAB_WA_PROACTIVE_DAILY_CAP || process.env.JAB_MARKETING_DAILY_CAP || 5);
  }
  if (category === "ops") return Number(process.env.JAB_WA_OPS_DAILY_CAP || 30);
  if (category === "campaign") return Number(process.env.JAB_WA_CAMPAIGN_DAILY_CAP || 50);
  return Number(process.env.JAB_WA_DAILY_OUTBOUND_CAP || 150);
}

export function assertOutboundAllowed(instanceName, { category = "default", isAgency = false } = {}) {
  if (isAgency && isAgencyOutboundPaused() && category !== "reply" && category !== "ops") {
    const err = new Error("agency_outbound_paused");
    err.code = "agency_outbound_paused";
    throw err;
  }
  if (category === "campaign" && isAgency) {
    const err = new Error("campaigns_disabled_on_agency");
    err.code = "campaigns_disabled_on_agency";
    throw err;
  }

  const day = todayKey();
  const capKey = `${instanceName || "default"}:${category}:${day}`;
  const cap = dailyCap(category);
  let row = dailyCountByKey.get(capKey);
  if (!row || row.day !== day) row = { day, count: 0 };
  if (row.count >= cap) {
    const err = new Error(`daily_outbound_cap:${cap}`);
    err.code = "daily_outbound_cap";
    throw err;
  }
  row.count += 1;
  dailyCountByKey.set(capKey, row);
}

export async function throttleOutbound(instanceName, category = "default") {
  const key = `${instanceName || "default"}:${category}`;
  const min = minDelayMs(category);
  const jitter = Number(process.env.JAB_WA_SEND_JITTER_MS || 3000);
  const now = Date.now();
  const last = lastSendByKey.get(key) || 0;
  const targetGap = min + Math.floor(Math.random() * Math.max(0, jitter));
  const wait = Math.max(0, targetGap - (now - last));
  if (wait > 0) await sleep(wait);
  lastSendByKey.set(key, Date.now());
}

export async function guardedEvolutionSend({
  evoApiUrl,
  apiKey,
  instance,
  number,
  text,
  category = "default",
  isAgency = false,
  linkPreview = false
}) {
  assertOutboundAllowed(instance, { category, isAgency });
  await throttleOutbound(instance, category);
  const response = await fetch(`${evoApiUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number, text, linkPreview: Boolean(linkPreview) })
  });
  const body = await response.text();
  if (!response.ok) {
    const err = new Error(`Evolution sendText failed ${response.status}: ${body.slice(0, 400)}`);
    err.status = response.status;
    throw err;
  }
  return body;
}

/** Serialize ops alerts with spacing between recipients. */
export async function sendOpsMessages({
  instance,
  isAgency = true,
  evoApiUrl,
  resolveToken,
  phones,
  buildText
}) {
  const unique = [...new Set((phones || []).filter(Boolean))];
  let sent = 0;
  const errors = [];
  for (const toPhone of unique) {
    try {
      const apiKey = await resolveToken(instance);
      const text = buildText(toPhone);
      if (!text) continue;
      await guardedEvolutionSend({
        evoApiUrl,
        apiKey,
        instance,
        number: toPhone,
        text,
        category: "ops",
        isAgency
      });
      sent += 1;
    } catch (error) {
      errors.push({ toPhone, error: error.message, code: error.code });
    }
  }
  return { sent, errors, phones: unique.length };
}
