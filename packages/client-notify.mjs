/**
 * Client tenant ops alerts — owner gets score + summary only on WhatsApp/Telegram.
 * Full customer chat stays in Hub Inbox; AI replies on the client business number.
 */

import {
  getClient,
  getClientOwnerNotifyPhones,
  updateContactQualification
} from "./hub-db/index.mjs";
import { resolveAgencyInstanceName } from "./hub-db/billing.mjs";
import { guardedEvolutionSend } from "./whatsapp-guard.mjs";
import {
  formatAgencyLeadDigest,
  digestFromHandoffBriefing,
  formatContactAlertLines,
  agencyInboxUrl
} from "./agency-qualification.mjs";
import { sendTelegramOpsMessage, telegramOpsConfigured } from "./telegram-notify.mjs";

function resolveWhatsAppSendInstance(db, instanceName) {
  const client = getClient(db, instanceName);
  if (Number(client?.platform_whatsapp_enabled)) {
    return resolveAgencyInstanceName(db);
  }
  return instanceName;
}

function resolveClientNotifyMode(client) {
  const raw = String(client?.client_notify_mode || "digest").toLowerCase();
  if (["digest", "handoff_full", "off"].includes(raw)) return raw;
  return "digest";
}

function resolveClientOpsChannel(client) {
  const raw = String(client?.client_ops_channel || "whatsapp").toLowerCase();
  if (["whatsapp", "telegram", "both", "off"].includes(raw)) return raw;
  return "whatsapp";
}

function resolveClientScoreThreshold(client) {
  const n = Number(client?.client_score_notify_threshold);
  return Number.isFinite(n) ? n : 60;
}

function resolveClientDigestPhones(db, instanceName, excludePhone = null) {
  const exclude = String(excludePhone || "").replace(/\D/g, "");
  return getClientOwnerNotifyPhones(db, instanceName).filter((phone) => {
    if (!phone) return false;
    if (!exclude) return true;
    return phone !== exclude && !exclude.endsWith(phone) && !phone.endsWith(exclude);
  });
}

function resolveClientDigestContext(db, instanceName) {
  const client = getClient(db, instanceName);
  return {
    channelName: client?.display_name || instanceName,
    channelPhone: client?.contact_phone || client?.whatsapp_order_number || null
  };
}

async function sendWhatsAppClientDigest({
  db,
  evoApiUrl,
  resolveToken,
  instanceName,
  text,
  excludePhone = null
}) {
  const phones = resolveClientDigestPhones(db, instanceName, excludePhone);
  if (!phones.length) {
    return { sent: 0, skipped: "no_owner_phones", phones: 0 };
  }

  const sendInstance = resolveWhatsAppSendInstance(db, instanceName);
  const viaAgencyLine = sendInstance !== instanceName;
  let sent = 0;
  let failed = 0;
  for (const toPhone of phones) {
    try {
      await guardedEvolutionSend({
        evoApiUrl,
        apiKey: await resolveToken(sendInstance),
        instance: sendInstance,
        number: toPhone,
        text,
        category: "ops",
        isAgency: viaAgencyLine,
        linkPreview: false
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({ at: new Date().toISOString(), clientDigestError: error.message, toPhone, instanceName })
      );
    }
  }
  return { sent, failed, phones: phones.length, skipped: sent ? undefined : failed ? "send_failed" : undefined };
}

export async function notifyClientOwner({
  db,
  instanceName,
  text,
  event = "Lead update",
  evoApiUrl = null,
  resolveToken = null,
  excludePhone = null
}) {
  const client = getClient(db, instanceName);
  if (!client) return { sent: 0, skipped: "no_client" };

  const channel = resolveClientOpsChannel(client);
  if (channel === "off") return { sent: 0, skipped: "off", channel };

  const result = { channel, telegram: null, whatsapp: null, sent: 0 };

  if (channel === "telegram" || channel === "both") {
    if (telegramOpsConfigured()) {
      try {
        result.telegram = await sendTelegramOpsMessage(text);
        result.sent += result.telegram.sent || 0;
      } catch (error) {
        result.telegram = { sent: 0, error: error.message };
        console.error(JSON.stringify({ at: new Date().toISOString(), clientTelegramOps: error.message }));
      }
    }
  }

  if ((channel === "whatsapp" || channel === "both") && evoApiUrl && resolveToken) {
    result.whatsapp = await sendWhatsAppClientDigest({
      db,
      evoApiUrl,
      resolveToken,
      instanceName,
      text,
      excludePhone
    });
    result.sent += result.whatsapp.sent || 0;
  }

  return result;
}

export async function sendClientLeadDigest({
  db,
  evoApiUrl,
  resolveToken,
  instanceName,
  pushName,
  phone,
  score,
  summary,
  event,
  publicBase,
  excludePhone = null
}) {
  const client = getClient(db, instanceName);
  if (!client) return { sent: 0, skipped: "no_client" };

  const mode = resolveClientNotifyMode(client);
  if (mode === "off") return { sent: 0, skipped: "off" };

  const hubUrl = agencyInboxUrl(publicBase, instanceName, phone);
  const ctx = resolveClientDigestContext(db, instanceName);
  const text = formatAgencyLeadDigest({
    pushName,
    phone,
    score,
    summary,
    event,
    hubUrl,
    includeHubUrl: Boolean(publicBase),
    ...ctx
  });

  return notifyClientOwner({
    db,
    instanceName,
    text,
    event,
    evoApiUrl,
    resolveToken,
    excludePhone
  });
}

export async function sendClientHandoffBriefing({
  db,
  evoApiUrl,
  resolveToken,
  instanceName,
  pushName,
  phone,
  summary,
  reason,
  lastCustomerMessage,
  publicBase,
  score = 0
}) {
  const client = getClient(db, instanceName);
  if (!client || resolveClientNotifyMode(client) === "off") {
    return { sent: 0, skipped: "off" };
  }

  const ctx = resolveClientDigestContext(db, instanceName);
  const briefing = String(summary || "").trim();
  const shortBrief =
    briefing.length > 900 ? `${briefing.slice(0, 880).trim()}…\n(Full briefing in Hub)` : briefing;
  const hubUrl = agencyInboxUrl(publicBase, instanceName, phone);

  const text = [
    `📋 Handoff — ${ctx.channelName || instanceName}`,
    ...formatContactAlertLines({ name: pushName, phone, label: "Customer" }),
    ctx.channelPhone ? `Business line: ${ctx.channelPhone}` : null,
    score ? `Qualification: ${score}/100` : null,
    reason ? `Reason: ${reason}` : null,
    shortBrief ? `\nSummary:\n${shortBrief}` : null,
    lastCustomerMessage ? `\nLast message: ${String(lastCustomerMessage).slice(0, 200)}` : null,
    hubUrl ? `\nFull chat → ${hubUrl}` : null
  ]
    .filter(Boolean)
    .join("\n");

  return notifyClientOwner({
    db,
    instanceName,
    text,
    event: "Handoff",
    evoApiUrl,
    resolveToken,
    excludePhone: phone
  });
}

export async function maybeNotifyClientScoreThreshold({
  db,
  evoApiUrl,
  resolveToken,
  instanceName,
  contact,
  publicBase
}) {
  const client = getClient(db, instanceName);
  if (!client) return null;

  const mode = resolveClientNotifyMode(client);
  if (mode === "off") return null;

  const threshold = resolveClientScoreThreshold(client);
  const score = Math.round(Number(contact?.qualification_score) || 0);
  if (score < threshold) return null;
  if (contact?.score_notified_at) return null;

  const result = await sendClientLeadDigest({
    db,
    evoApiUrl,
    resolveToken,
    instanceName,
    pushName: contact.push_name,
    phone: contact.phone,
    score,
    summary: contact.qualification_summary,
    event: `Hot lead (score ≥ ${threshold})`,
    publicBase,
    excludePhone: contact.phone
  });

  if ((result.sent || 0) > 0 || result.telegram?.sent > 0 || result.whatsapp?.sent > 0) {
    updateContactQualification(db, contact.id, {
      score: contact.qualification_score,
      summary: contact.qualification_summary,
      markScoreNotified: true
    });
  }

  return result;
}
