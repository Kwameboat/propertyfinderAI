/**

 * Agency ops alerts — summary to connected WhatsApp numbers + optional Telegram.

 * Full chat stays in Hub Inbox; connected numbers get score + summary on WhatsApp.

 */

import {

  getAgencySettings,

  resolveAgencyInstanceName,

  getClientAdminPhones,

  updateContactQualification,

  getClient,

  findClientByProspectPhone

} from "./hub-db/index.mjs";

import { guardedEvolutionSend } from "./whatsapp-guard.mjs";

import { formatAgencyLeadDigest, agencyInboxUrl } from "./agency-qualification.mjs";

import { sendTelegramOpsMessage, telegramOpsConfigured } from "./telegram-notify.mjs";



function resolveDigestContext(db, instanceName, prospectPhone) {

  const channel = getClient(db, instanceName);

  const hubClient = findClientByProspectPhone(db, prospectPhone);

  return {

    channelName: channel?.display_name || instanceName,

    channelPhone: channel?.contact_phone || channel?.whatsapp_order_number || null,

    hubClientName: hubClient?.display_name || hubClient?.instance_name || "",

    hubClientPhone: hubClient?.contact_phone || hubClient?.whatsapp_order_number || ""

  };

}



function resolveOpsPhones(db, instanceName, excludePhone = null) {

  const exclude = String(excludePhone || "").replace(/\D/g, "");

  const envFallback = String(process.env.JAB_AGENCY_OPS_PHONE || process.env.JAB_HUB_ADMIN_PHONE || "")

    .split(/[,;\s]+/)

    .map((p) => p.replace(/\D/g, ""))

    .filter(Boolean);

  const merged = [...new Set([...getClientAdminPhones(db, instanceName), ...envFallback])];

  return merged.filter((phone) => {

    if (!phone || !exclude) return Boolean(phone);

    return phone !== exclude && !exclude.endsWith(phone) && !phone.endsWith(exclude);

  });

}



export function resolveAgencyOpsChannel(db) {

  const settings = getAgencySettings(db);

  const raw = String(

    settings?.agency_ops_channel || process.env.JAB_AGENCY_OPS_CHANNEL || "both"

  ).toLowerCase();

  if (["telegram", "whatsapp", "both", "off", "hub"].includes(raw)) return raw;

  return "both";

}



function digestIncludeHubUrl(db) {

  const settings = getAgencySettings(db);

  if (settings?.agency_digest_include_hub_url !== undefined && settings?.agency_digest_include_hub_url !== null) {

    return Boolean(Number(settings.agency_digest_include_hub_url));

  }

  return String(process.env.JAB_AGENCY_DIGEST_HUB_URL || "0").toLowerCase() === "1";

}



async function sendWhatsAppOpsDigest({

  db,

  evoApiUrl,

  resolveToken,

  agencyInstance,

  text,

  excludePhone = null,

  alsoNotifyAgents = []

}) {

  const phones = [...new Set([...resolveOpsPhones(db, agencyInstance, excludePhone), ...alsoNotifyAgents])];

  let sent = 0;

  for (const toPhone of phones) {

    if (!toPhone) continue;

    try {

      await guardedEvolutionSend({

        evoApiUrl,

        apiKey: await resolveToken(agencyInstance),

        instance: agencyInstance,

        number: toPhone,

        text,

        category: "ops",

        isAgency: true,

        linkPreview: false

      });

      sent += 1;

    } catch (error) {

      console.error(

        JSON.stringify({ at: new Date().toISOString(), agencyDigestError: error.message, toPhone })

      );

    }

  }

  return { sent, phones: phones.length };

}



export async function notifyAgencyOps({

  db,

  text,

  event = "Lead update",

  evoApiUrl = null,

  resolveToken = null,

  excludePhone = null,

  alsoNotifyAgents = []

}) {

  const channel = resolveAgencyOpsChannel(db);

  if (channel === "off") return { sent: 0, skipped: "off", channel };



  const agencyInstance = resolveAgencyInstanceName(db);

  const result = { channel, telegram: null, whatsapp: null, sent: 0 };



  if (channel === "hub") {

    console.log(JSON.stringify({ at: new Date().toISOString(), agencyOpsHub: event, preview: text.slice(0, 240) }));

    return result;

  }



  if (channel === "telegram" || channel === "both") {

    if (telegramOpsConfigured()) {

      try {

        const hubMatch = String(text || "").match(/(?:Full chat|Hub)\s*→\s*(https?:\/\/\S+)/i);

        result.telegram = await sendTelegramOpsMessage(text, { hubUrl: hubMatch?.[1] || "" });

        result.sent += result.telegram.sent || 0;

      } catch (error) {

        result.telegram = { sent: 0, error: error.message };

        console.error(JSON.stringify({ at: new Date().toISOString(), telegramOpsNotify: error.message }));

      }

    }

  }



  if ((channel === "whatsapp" || channel === "both") && evoApiUrl && resolveToken) {

    result.whatsapp = await sendWhatsAppOpsDigest({

      db,

      evoApiUrl,

      resolveToken,

      agencyInstance,

      text,

      excludePhone,

      alsoNotifyAgents

    });

    result.sent += result.whatsapp.sent || 0;

  }



  return result;

}



export async function sendAgencyLeadDigest({

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

  excludePhone = null,

  alsoNotifyAgents = []

}) {

  const settings = getAgencySettings(db);

  const mode = String(settings?.agency_notify_mode || "digest").toLowerCase();

  if (mode === "off") return { sent: 0, skipped: "off" };



  const hubUrl = agencyInboxUrl(publicBase, instanceName, phone);

  const ctx = resolveDigestContext(db, instanceName, phone);

  const text = formatAgencyLeadDigest({

    pushName,

    phone,

    score,

    summary,

    event,

    hubUrl,

    includeHubUrl: digestIncludeHubUrl(db),

    ...ctx

  });



  return notifyAgencyOps({

    db,

    text,

    event,

    evoApiUrl,

    resolveToken,

    excludePhone,

    alsoNotifyAgents

  });

}



export async function sendAgencyHandoffBriefing({

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

  const settings = getAgencySettings(db);

  if (String(settings?.agency_notify_mode || "digest").toLowerCase() === "off") {

    return { sent: 0, skipped: "off" };

  }



  const includeHub = digestIncludeHubUrl(db);

  const hubUrl = includeHub ? agencyInboxUrl(publicBase, instanceName, phone) : "";

  const ctx = resolveDigestContext(db, instanceName, phone);

  const briefing = String(summary || "").trim();

  const shortBrief =

    briefing.length > 900 ? `${briefing.slice(0, 880).trim()}…\n(Full briefing in Hub)` : briefing;



  const text = [

    `📋 Handoff`,

    `Client: ${pushName || "Unknown"}`,

    `WhatsApp: ${phone || "—"}`,

    ctx.channelName ? `Channel: ${ctx.channelName}` : null,

    score ? `Qualification: ${score}/100` : null,

    reason ? `Reason: ${reason}` : null,

    shortBrief ? `\nSummary:\n${shortBrief}` : null,

    lastCustomerMessage ? `\nLast message: ${lastCustomerMessage}` : null,

    includeHub && hubUrl ? `\nHub → ${hubUrl}` : null

  ]

    .filter(Boolean)

    .join("\n");



  return notifyAgencyOps({

    db,

    text,

    event: "Handoff",

    evoApiUrl,

    resolveToken,

    excludePhone: phone

  });

}



export async function notifyAgencyPaymentOps({ db, evoApiUrl, resolveToken, text }) {

  return notifyAgencyOps({

    db,

    text,

    event: "Payment",

    evoApiUrl,

    resolveToken

  });

}



export async function maybeNotifyAgencyScoreThreshold({

  db,

  evoApiUrl,

  resolveToken,

  instanceName,

  contact,

  publicBase

}) {

  const settings = getAgencySettings(db);

  const mode = String(settings?.agency_notify_mode || "digest").toLowerCase();

  if (mode === "off") return null;



  const threshold = Number(settings?.agency_score_notify_threshold ?? 60);

  const score = Math.round(Number(contact?.qualification_score) || 0);

  if (score < threshold) return null;

  if (contact?.score_notified_at) return null;



  const result = await sendAgencyLeadDigest({

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


