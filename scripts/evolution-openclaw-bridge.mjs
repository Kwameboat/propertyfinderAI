import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  openHubDb,
  upsertClient,
  upsertContact,
  getClient,
  getContactByPhone,
  isContactHumanOwned,
  processHandoff,
  appendLeadMessage,
  updateLeadSummary,
  getOpenLeadForContact,
  formatCatalogForAgent,
  formatDealsForAgent,
  listClientDeals,
  addClientDeal,
  removeClientDeal,
  updateClientDeal,
  isClientAdminPhone,
  getClientAdminPhones,
  formatPackagesForAgent,
  findProductForPhoto,
  listProducts,
  ensureWallet,
  applyWalletDelta,
  pointsForRate,
  rateKeyForAiUsage,
  resolveAgencyInstanceName,
  isAgencyInstance,
  getMarketingLeadByPhone,
  markMarketingLeadReplied,
  cancelFollowUpsForPhone,
  addMarketingEvent,
  updateContact,
  getContact,
  formatKnowledgeForAgent,
  addConversationMessage,
  listConversationMessages,
  updateContactQualification,
  createBooking,
  getBooking,
  createCustomerPayment,
  resolvePaystackBillingEmail,
  ensureClientBillingEmail,
  getLatestOpenPaymentForProspect,
  completePaystackPayment,
  getPaystackPaymentByReference,
  claimDueFollowUpJobs,
  completeFollowUpJob,
  buildOwnerDigestText,
  ensureOwnerDigestJobs,
  listKnowledgeDocs,
  getAgencySettings,
  claimPlatformInboundMessage,
  listPlatformTenants
} from "../packages/hub-db/index.mjs";
import {
  estimateYangoDeliveryFee,
  formatDeliveryFeeForChat
} from "../packages/yango-delivery.mjs";
import {
  initClientTopup,
  maybeNotifyLowBalance,
  sendAgencyText,
  notifyPaymentSuccess
} from "../packages/billing-notify.mjs";
import {
  buildAgencyInboundPrompt,
  buildAgencyFollowUpPrompt
} from "../packages/agency-growth-prompt.mjs";
import {
  scoreAgencyProspect,
  scoreClientProspect,
  digestFromHandoffBriefing,
  formatContactAlertLines,
  formatDisplayPhone
} from "../packages/agency-qualification.mjs";
import {
  sendAgencyLeadDigest,
  sendAgencyHandoffBriefing,
  maybeNotifyAgencyScoreThreshold
} from "../packages/agency-notify.mjs";
import {
  sendClientLeadDigest,
  sendClientHandoffBriefing,
  maybeNotifyClientScoreThreshold
} from "../packages/client-notify.mjs";
import { resolvePlatformRoute } from "../packages/platform-router.mjs";
import { checkMetaToken } from "../packages/pipeline-health.mjs";
import {
  handleReWhatsAppInbound,
  isReWhatsAppInstance,
  isReWhatsAppOnAgencyEnabled,
  shouldRouteInboundToRealEstate
} from "../packages/real-estate/re-wa.mjs";
import { voiceTranscriptionPrompt } from "../packages/real-estate/language.mjs";
import {
  guardedEvolutionSend,
  assertOutboundAllowed,
  throttleOutbound,
  agencyAutoFollowupsEnabled,
  agencyTypingEnabled,
  hubTypingEnabled,
  isAgencyOutboundPaused
} from "../packages/whatsapp-guard.mjs";
import {
  getEvolutionInstanceIntegration,
  isCloudApiIntegration,
  listMetaWebhookInboundMessages,
  metaDirectConfigured,
  metaWebhookVerifyToken,
  resolveMetaWebhookVerifyToken,
  verifyMetaWebhookSignature,
  resolveMetaPhoneNumberId,
  resolveMetaCloudCredentialsForInstance,
  resolveInstanceForMetaPhoneNumberId,
  sendMetaCloudText
} from "../packages/meta-cloud.mjs";
import { telegramOpsConfigured } from "../packages/telegram-notify.mjs";
import {
  paystackConfigured,
  paystackInitialize,
  makePaystackReference,
  paystackVerify
} from "../packages/paystack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function hubStore() {
  try {
    return openHubDb();
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), hubDbError: error.message }));
    return null;
  }
}
const PORT = Number(process.env.JAB_HUB_BRIDGE_PORT || 8787);
const SYNC_MS = Number(process.env.JAB_HUB_SYNC_MS || 30000);
const STATE_DIR = path.join(process.env.USERPROFILE || process.env.HOME, ".openclaw");
const CONFIG_PATH = path.join(STATE_DIR, "openclaw.json");
const HUB_ENV_PATH = path.join(REPO_ROOT, ".env");
const OPENCLAW_CLI =
  process.env.OPENCLAW_CLI ||
  (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || "", "pnpm", "openclaw.CMD")
    : "openclaw");
const OPENCLAW_GATEWAY_URL = (
  process.env.OPENCLAW_GATEWAY_URL ||
  process.env.JAB_HUB_OPENCLAW_URL ||
  "http://127.0.0.1:18789"
).replace(/\/$/, "");
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || "main";
/**
 * Agent backend for WhatsApp replies:
 * - gemini (default): direct Gemini HTTP — typically 1–3s
 * - http: OpenClaw gateway /v1/chat/completions — typically 15–30s
 * - cli: spawn openclaw agent — typically 60–90s
 */
const OPENCLAW_VIA = String(process.env.JAB_HUB_OPENCLAW_VIA || "gemini").toLowerCase();
const GEMINI_MODEL =
  process.env.JAB_HUB_GEMINI_MODEL ||
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash";
const GEMINI_API_BASE =
  process.env.JAB_HUB_GEMINI_API_BASE ||
  "https://generativelanguage.googleapis.com/v1beta";
const SESSION_HISTORY_MAX = Number(process.env.JAB_HUB_SESSION_HISTORY_MAX || 12);

const BRIDGE_URL = process.env.JAB_HUB_BRIDGE_URL || "http://host.docker.internal:8787/evolution";
const instanceTokenCache = new Map();
const instanceIntegrationCache = new Map();
const recentMessageClaims = new Map();
const DEDUPE_TTL_MS = Number(process.env.JAB_HUB_DEDUPE_TTL_MS || 180000);
const agencyInboundLast = new Map();
const AGENCY_INBOUND_COOLDOWN_MS = Number(process.env.JAB_AGENCY_INBOUND_COOLDOWN_MS || 2000);

const HUB_STATE_DIR = path.join(STATE_DIR, "jab-hub");
const SESSION_HISTORY_PATH = path.join(HUB_STATE_DIR, "wa-sessions.json");
const LEADS_PATH = path.join(HUB_STATE_DIR, "leads.json");
const FOLLOWUP_HOURS = Number(process.env.JAB_HUB_FOLLOWUP_HOURS || 24);
const FOLLOWUP_MS = FOLLOWUP_HOURS * 60 * 60 * 1000;
const FOLLOWUP_TICK_MS = Number(process.env.JAB_HUB_FOLLOWUP_TICK_MS || 300000);
const HUB_PUBLIC_URL = process.env.JAB_HUB_PUBLIC_URL || "http://127.0.0.1:3000";
const DEFAULT_HANDOFF_KEYWORDS =
  "human,agent,speak to someone,talk to someone,call me,representative";

let syncInFlight = false;
let followUpInFlight = false;
let leadsWriteChain = Promise.resolve();

function pruneMessageClaims(now = Date.now()) {
  for (const [key, ts] of recentMessageClaims) {
    if (now - ts > DEDUPE_TTL_MS) recentMessageClaims.delete(key);
  }
}

/** Claim a WhatsApp message id so global + instance webhooks cannot double-reply. */
function claimInboundMessage(instance, messageId) {
  if (!messageId) return true;
  const store = hubStore();
  if (store) {
    return claimPlatformInboundMessage(store.db, instance, messageId);
  }
  const key = `${instance}:${messageId}`;
  const now = Date.now();
  pruneMessageClaims(now);
  if (recentMessageClaims.has(key)) return false;
  recentMessageClaims.set(key, now);
  return true;
}

function isProductionBridge() {
  return process.env.NODE_ENV === "production" || process.env.JAB_HUB_PRODUCTION === "1";
}

function allowAgencyFastReply(phone) {
  if (AGENCY_INBOUND_COOLDOWN_MS <= 0) return true;
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return true;
  const now = Date.now();
  const last = agencyInboundLast.get(digits) || 0;
  if (now - last < AGENCY_INBOUND_COOLDOWN_MS) return false;
  agencyInboundLast.set(digits, now);
  return true;
}

function leadKey(instance, number) {
  return `${instance}:${number}`;
}

async function readLeads() {
  try {
    const raw = await readFile(LEADS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Serialize writes so concurrent inbound/follow-up updates never clobber leads.json. */
function persistLeads(mutator) {
  leadsWriteChain = leadsWriteChain.then(async () => {
    const leads = await readLeads();
    const result = await mutator(leads);
    await mkdir(HUB_STATE_DIR, { recursive: true });
    await writeFile(LEADS_PATH, JSON.stringify(leads, null, 2), "utf8");
    return result;
  });
  return leadsWriteChain;
}

async function recordInbound({ instance, number, pushName, text }) {
  const now = Date.now();
  await persistLeads((leads) => {
    const key = leadKey(instance, number);
    const existing = leads[key] || { stage: "open" };
    leads[key] = {
      ...existing,
      instance,
      number,
      pushName: pushName || existing.pushName || "WhatsApp contact",
      lastInboundAt: now,
      lastInboundText: String(text || "").slice(0, 200),
      followUpAt: now + FOLLOWUP_MS,
      followUpSent: false,
      stage: existing.stage || "open"
    };
    delete leads[key].followUpError;
  });

  // Agency Hub contacts: isolated per Evolution instance.
  const store = hubStore();
  if (store) {
    try {
      upsertClient(store.db, { instanceName: instance });
      upsertContact(store.db, {
        instanceName: instance,
        phone: number,
        pushName,
        lastInboundAt: now,
        lastInboundText: text
      });
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), contactUpsertError: error.message }));
    }
  }
}

async function recordOutbound({ instance, number, followUp = false }) {
  const now = Date.now();
  await persistLeads((leads) => {
    const key = leadKey(instance, number);
    const existing = leads[key];
    if (!existing) return;
    existing.lastOutboundAt = now;
    if (followUp) existing.followUpSent = true;
  });

  const store = hubStore();
  if (store) {
    try {
      upsertContact(store.db, {
        instanceName: instance,
        phone: number,
        lastOutboundAt: now
      });
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), contactOutboundError: error.message }));
    }
  }
}

function readMessageText(message = {}) {
  if (typeof message.conversation === "string") return message.conversation;
  if (typeof message.extendedTextMessage?.text === "string") return message.extendedTextMessage.text;
  if (typeof message.imageMessage?.caption === "string") return message.imageMessage.caption;
  if (typeof message.videoMessage?.caption === "string") return message.videoMessage.caption;
  if (typeof message.documentMessage?.caption === "string") return message.documentMessage.caption;
  const loc = message.locationMessage || message.liveLocationMessage;
  if (loc && (loc.degreesLatitude != null || loc.degreesLongitude != null)) {
    const lat = Number(loc.degreesLatitude);
    const lng = Number(loc.degreesLongitude);
    const label = [loc.name, loc.address].filter(Boolean).join(" — ");
    const coords = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : "";
    if (coords && label) return `Shared location: ${coords} (${label})`;
    if (coords) return `Shared location: ${coords}`;
    if (label) return `Shared location: ${label}`;
  }
  return "";
}

function hasAudioMessage(message = {}) {
  return Boolean(message.audioMessage || message.pttMessage);
}

async function fetchEvolutionMediaBase64({ evoApiUrl, apiKey, instance, message }) {
  const url = `${evoApiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ message, convertToMp4: false }),
    signal: AbortSignal.timeout(45000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`getBase64FromMediaMessage ${response.status}: ${body.slice(0, 200)}`);
  const json = JSON.parse(body || "{}");
  const b64 = json.base64 || json.data?.base64 || json.media || "";
  const mime = json.mimetype || json.mimeType || "audio/ogg";
  if (!b64) throw new Error("No base64 in media response");
  return { base64: String(b64).replace(/^data:[^;]+;base64,/, ""), mimetype: mime };
}

async function transcribeAudioWithGemini({ base64, mimetype }) {
  await applyHubEnvToProcess();
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    "";
  if (!key) return null;
  const model = process.env.JAB_HUB_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: voiceTranscriptionPrompt() },
            { inlineData: { mimeType: mimetype || "audio/ogg", data: base64 } }
          ]
        }
      ],
      generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
    }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Gemini transcribe ${response.status}: ${body.slice(0, 200)}`);
  const json = JSON.parse(body || "{}");
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return String(text).trim() || null;
}

async function resolveInboundText({ evoApiUrl, apiKey, instance, data, store }) {
  let text = readMessageText(data.message).trim();
  let fromVoice = false;
  if (!text && hasAudioMessage(data.message)) {
    try {
      const media = await fetchEvolutionMediaBase64({
        evoApiUrl,
        apiKey,
        instance,
        message: { key: data.key, message: data.message }
      });
      const transcript = await transcribeAudioWithGemini(media);
      if (transcript) {
        text = `[Voice note] ${transcript}`;
        fromVoice = true;
        if (store) {
          debitAiUsage(store, instance, { hasAudio: true });
        }
      }
    } catch (error) {
      console.error(
        JSON.stringify({ at: new Date().toISOString(), voiceTranscribeError: error.message, instance })
      );
    }
  }
  return { text, fromVoice };
}

function guessMimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function customerWantsPhoto(text) {
  return /\b(photo|photos|picture|pictures|pic|pics|image|images|send\s+(me\s+)?(a\s+)?(pic|photo|image)|show\s+(me\s+)?(a\s+)?(pic|photo|image)|how\s+does\s+it\s+look)\b/i.test(
    String(text || "")
  );
}

function isAdminDealCommand(text) {
  return /^\s*(deals|list\s+deals|help\s+deals|add\s+deal|new\s+deal|remove\s+deal|delete\s+deal|update\s+deal)\b/i.test(
    String(text || "")
  );
}

function parseDealFields(body) {
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const fields = {
    title: "",
    destination: "",
    salary: "",
    fee: "",
    requirements: "",
    benefits: "",
    notes: ""
  };
  const leftovers = [];
  for (const line of lines) {
    const m = line.match(
      /^(title|destination|country|salary|pay|fee|fees|requirements|docs|documents|benefits|notes|details)\s*[:=-]\s*(.+)$/i
    );
    if (!m) {
      leftovers.push(line);
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "title") fields.title = value;
    else if (key === "destination" || key === "country") fields.destination = value;
    else if (key === "salary" || key === "pay") fields.salary = value;
    else if (key === "fee" || key === "fees") fields.fee = value;
    else if (key === "requirements" || key === "docs" || key === "documents") fields.requirements = value;
    else if (key === "benefits") fields.benefits = value;
    else if (key === "notes" || key === "details") fields.notes = value;
  }
  if (!fields.title && leftovers.length) {
    // One-liner: Title | Destination | Salary | notes...
    const parts = leftovers[0].split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      fields.title = parts[0];
      fields.destination = parts[1] || "";
      fields.salary = parts[2] || "";
      fields.notes = parts.slice(3).join(" | ");
    } else {
      fields.title = leftovers[0];
      if (leftovers.length > 1) fields.notes = leftovers.slice(1).join(" ");
    }
  } else if (leftovers.length && !fields.notes) {
    fields.notes = leftovers.join(" ");
  }
  return fields;
}

function formatDealsAdminList(deals) {
  if (!deals.length) return "No live deals yet. Send:\nADD DEAL\nTitle: ...\nDestination: ...\nSalary: ...";
  return [
    `Live deals (${deals.length}):`,
    ...deals.map((d) => {
      const bits = [d.destination, d.salary, d.fee].filter(Boolean).join(" · ");
      return `#${d.id} ${d.title}${bits ? ` — ${bits}` : ""}`;
    }),
    "",
    "Commands:",
    "DEALS",
    "ADD DEAL",
    "Title: ...",
    "Destination: ...",
    "Salary: ...",
    "Fee: ...",
    "Requirements: ...",
    "Benefits: ...",
    "Notes: ...",
    "Or one line: ADD DEAL: Title | Destination | Salary | notes",
    "REMOVE DEAL: 3"
  ].join("\n");
}

function handleAdminDealCommand(db, instance, text) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();

  if (/^\s*(deals|list\s+deals|help\s+deals)\s*$/i.test(raw)) {
    return { ok: true, reply: formatDealsAdminList(listClientDeals(db, instance)) };
  }

  const removeMatch = raw.match(/^\s*(?:remove|delete)\s+deal\s*[:=-]?\s*#?(\d+)\s*$/i);
  if (removeMatch) {
    const removed = removeClientDeal(db, instance, removeMatch[1]);
    if (!removed) return { ok: false, reply: `No deal #${removeMatch[1]} found.` };
    return {
      ok: true,
      reply: `Removed deal #${removeMatch[1]}.\n\n${formatDealsAdminList(listClientDeals(db, instance))}`
    };
  }

  const addMatch = raw.match(/^\s*(?:add|new)\s+deal\s*[:=-]?\s*([\s\S]*)$/i);
  if (addMatch) {
    const fields = parseDealFields(addMatch[1]);
    if (!fields.title) {
      return {
        ok: false,
        reply:
          "Missing title. Example:\nADD DEAL\nTitle: Dubai Security Guard\nDestination: Dubai, UAE\nSalary: 1200-1600 AED\nFee: 20000 GHS after visa approval\nRequirements: Passport, photo, Ghana Card\nBenefits: Accommodation, transport, medical"
      };
    }
    const deal = addClientDeal(db, instance, fields);
    return {
      ok: true,
      reply: `Added deal #${deal.id}: ${deal.title}\n\n${formatDealsAdminList(listClientDeals(db, instance))}`
    };
  }

  const updateMatch = raw.match(/^\s*update\s+deal\s*[:=-]?\s*#?(\d+)\s+([\s\S]+)$/i);
  if (updateMatch) {
    const fields = parseDealFields(updateMatch[2]);
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => String(v || "").trim())
    );
    if (!Object.keys(patch).length) {
      return { ok: false, reply: "Nothing to update. Include Title/Destination/Salary/etc." };
    }
    const updated = updateClientDeal(db, instance, updateMatch[1], patch);
    if (!updated) return { ok: false, reply: `No deal #${updateMatch[1]} found.` };
    return {
      ok: true,
      reply: `Updated deal #${updated.id}: ${updated.title}\n\n${formatDealsAdminList(listClientDeals(db, instance))}`
    };
  }

  if (isAdminDealCommand(raw)) {
    return {
      ok: false,
      reply: formatDealsAdminList(listClientDeals(db, instance))
    };
  }
  return null;
}

function normalizePhoneFromJid(jid = "") {
  return String(jid).split("@")[0].replace(/\D/g, "");
}

function isLidJid(jid = "") {
  return String(jid).toLowerCase().endsWith("@lid");
}

function isPnJid(jid = "") {
  const value = String(jid).toLowerCase();
  return value.endsWith("@s.whatsapp.net") || value.endsWith("@c.us");
}

/**
 * WhatsApp now often delivers DMs on @lid while Evolution webhooks still expose the phone JID.
 * Outbound must prefer the LID chat or messages stay PENDING and never reach the handset.
 */
function resolveInboundPeer(payload = {}) {
  const data = payload?.data || {};
  const key = data.key || {};
  const remoteJid = String(key.remoteJid || payload?.sender || "").trim();
  const remoteJidAlt = String(key.remoteJidAlt || data.remoteJidAlt || "").trim();
  const senderPn = String(key.senderPn || data.senderPn || key.participantPn || "").trim();
  const senderLid = String(key.senderLid || data.senderLid || "").trim();

  const lidCandidate = [remoteJid, remoteJidAlt, senderLid].find((jid) => isLidJid(jid)) || "";
  const pnCandidate =
    [senderPn, remoteJidAlt, remoteJid, payload?.sender].find((jid) => isPnJid(jid) || /^\d{8,15}$/.test(String(jid || "").split("@")[0])) ||
    "";

  const phone = normalizePhoneFromJid(pnCandidate || (isLidJid(remoteJid) ? "" : remoteJid));
  const replyJid = lidCandidate || (phone ? `${phone}@s.whatsapp.net` : remoteJid);

  return {
    remoteJid,
    replyJid,
    phone,
    addressingMode: key.addressingMode || data.addressingMode || null,
    remoteJidAlt: remoteJidAlt || null,
    senderPn: senderPn || null,
    senderLid: senderLid || null
  };
}

const phoneToLidCache = new Map(); // `${instance}:${phone}` -> lid jid

async function fetchEvolutionContacts(evoApiUrl, apiKey, instance) {
  const response = await fetch(`${evoApiUrl}/chat/findContacts/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`findContacts failed ${response.status}: ${body}`);
  }
  const parsed = JSON.parse(body || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function fetchEvolutionChats(evoApiUrl, apiKey, instance) {
  const response = await fetch(`${evoApiUrl}/chat/findChats/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`findChats failed ${response.status}: ${body}`);
  }
  const parsed = JSON.parse(body || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

function cacheLid(instance, phone, lidJid) {
  if (!instance || !phone || !isLidJid(lidJid)) return;
  phoneToLidCache.set(`${instance}:${phone}`, lidJid);
}

/**
 * WhatsApp DMs often live on @lid while webhooks expose the phone JID.
 * Replying to the phone JID creates a ghost thread — prefer the LID chat.
 */
async function resolveReplyJid({ evoApiUrl, apiKey, instance, peer, pushName = "" }) {
  if (peer?.replyJid && isLidJid(peer.replyJid)) {
    cacheLid(instance, peer.phone, peer.replyJid);
    return peer.replyJid;
  }

  const phone = peer?.phone || normalizePhoneFromJid(peer?.remoteJid || "");
  const pnJid = phone ? `${phone}@s.whatsapp.net` : "";
  const cacheKey = `${instance}:${phone}`;
  if (phone && phoneToLidCache.has(cacheKey)) {
    return phoneToLidCache.get(cacheKey);
  }

  const nameHint = String(pushName || "").trim().toLowerCase();

  const tryResolve = async () => {
    const [contacts, chats] = await Promise.all([
      fetchEvolutionContacts(evoApiUrl, apiKey, instance).catch(() => []),
      fetchEvolutionChats(evoApiUrl, apiKey, instance).catch(() => [])
    ]);

    const pnContact =
      contacts.find((c) => String(c.remoteJid || "") === pnJid) ||
      contacts.find((c) => normalizePhoneFromJid(c.remoteJid) === phone && isPnJid(c.remoteJid));

    const lidFromContacts =
      contacts.find(
        (c) =>
          isLidJid(c.remoteJid) &&
          pnContact?.profilePicUrl &&
          c.profilePicUrl &&
          c.profilePicUrl === pnContact.profilePicUrl
      ) ||
      contacts.find(
        (c) =>
          isLidJid(c.remoteJid) &&
          ((pnContact?.pushName &&
            c.pushName &&
            String(c.pushName).trim().toLowerCase() === String(pnContact.pushName).trim().toLowerCase()) ||
            (nameHint && c.pushName && String(c.pushName).trim().toLowerCase() === nameHint))
      );

    if (lidFromContacts?.remoteJid) return lidFromContacts.remoteJid;

    const lidChats = chats.filter((c) => isLidJid(c.remoteJid));
    const byName = nameHint
      ? lidChats.filter((c) => String(c.pushName || "").trim().toLowerCase() === nameHint)
      : [];
    if (byName.length === 1) return byName[0].remoteJid;
    if (byName.length > 1) {
      return [...byName].sort(
        (a, b) => Number(b.unreadCount || 0) - Number(a.unreadCount || 0)
      )[0].remoteJid;
    }

    // Fresh LID chat often has null pushName but high unread right after inbound.
    if (String(peer?.addressingMode || "").toLowerCase() === "lid") {
      const hot = [...lidChats]
        .filter((c) => Number(c.unreadCount || 0) > 0)
        .sort((a, b) => Number(b.unreadCount || 0) - Number(a.unreadCount || 0));
      if (hot.length === 1) return hot[0].remoteJid;
    }
    return null;
  };

  try {
    let lid = await tryResolve();
    // Contacts/chats can lag a moment after first inbound on a fresh link.
    if (!lid && String(peer?.addressingMode || "").toLowerCase() === "lid") {
      await new Promise((r) => setTimeout(r, 800));
      lid = await tryResolve();
    }
    if (lid) {
      cacheLid(instance, phone, lid);
      return lid;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        lidResolveError: error.message,
        phone
      })
    );
  }

  return pnJid || peer?.replyJid || peer?.remoteJid || phone;
}

function sanitizeSessionPart(value = "unknown") {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

async function readConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
}

async function readHubEnv() {
  try {
    const raw = await readFile(HUB_ENV_PATH, "utf8");
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

/** Merge selected .env keys into process.env for Yango / Paystack / Gemini helpers. */
async function applyHubEnvToProcess() {
  const hubEnv = await readHubEnv();
  for (const key of Object.keys(hubEnv)) {
    const allow =
      key.startsWith("YANGO_") ||
      key.startsWith("PAYSTACK_") ||
      key.startsWith("GEMINI_") ||
      key.startsWith("GOOGLE_") ||
      key === "JAB_HUB_PUBLIC_URL" ||
      key === "JAB_HUB_GEMINI_MODEL";
    if (!allow) continue;
    if (hubEnv[key] !== undefined && hubEnv[key] !== "" && process.env[key] === undefined) {
      process.env[key] = hubEnv[key];
    }
  }
}

async function getEvolutionBootstrap() {
  const config = await readConfig();
  const skillEnv = config.skills?.entries?.["evolution-api-v2"]?.env || {};
  const hubEnv = await readHubEnv();
  const evoApiUrl = skillEnv.EVO_API_URL || hubEnv.SERVER_URL || "http://localhost:8080";
  const globalKey =
    skillEnv.EVO_GLOBAL_KEY ||
    config.env?.vars?.EVO_GLOBAL_KEY ||
    hubEnv.AUTHENTICATION_API_KEY;
  if (!globalKey) throw new Error("Missing Evolution global API key");
  return {
    config,
    evoApiUrl: evoApiUrl.replace(/\/$/, ""),
    globalKey,
    hookToken: config.hooks?.token
  };
}

function normalizeInstanceList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.value)) return payload.value;
  if (payload && typeof payload === "object" && payload.name) return [payload];
  return [];
}

async function fetchInstances(evoApiUrl, globalKey) {
  const response = await fetch(`${evoApiUrl}/instance/fetchInstances`, {
    headers: { apikey: globalKey }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`fetchInstances failed ${response.status}: ${body}`);
  return normalizeInstanceList(JSON.parse(body || "[]"));
}

async function resolveInstanceToken(instanceName) {
  const cached = instanceTokenCache.get(instanceName);
  if (cached) return cached;

  const { evoApiUrl, globalKey } = await getEvolutionBootstrap();
  const instances = await fetchInstances(evoApiUrl, globalKey);
  for (const item of instances) {
    if (!item?.name || !item?.token) continue;
    instanceTokenCache.set(item.name, item.token);
  }

  const token = instanceTokenCache.get(instanceName);
  if (!token) throw new Error(`No Evolution token found for instance "${instanceName}"`);
  return token;
}

async function ensureInstanceWebhook(instance, evoApiUrl, hookToken, { preferGlobal = false } = {}) {
  if (!instance?.name || !instance?.token) return { skipped: true };

  const enc = encodeURIComponent(instance.name);
  const findRes = await fetch(`${evoApiUrl}/webhook/find/${enc}`, {
    headers: { apikey: instance.token }
  });
  const current = findRes.ok ? await findRes.json() : null;
  const url = current?.url || current?.webhook?.url;
  const enabled = current?.enabled ?? current?.webhook?.enabled;

  // Global webhook already delivers every instance event. Keeping both causes double replies.
  if (preferGlobal) {
    if (!enabled) return { instance: instance.name, alreadyDisabled: true, reason: "global-webhook" };
    const response = await fetch(`${evoApiUrl}/webhook/set/${enc}`, {
      method: "POST",
      headers: {
        apikey: instance.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        webhook: {
          enabled: false,
          url: url || BRIDGE_URL,
          byEvents: false,
          base64: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
        }
      })
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`webhook/set ${instance.name} (disable) failed ${response.status}: ${body}`);
    }
    return { instance: instance.name, disabled: true, reason: "global-webhook" };
  }

  if (!hookToken) return { skipped: true };
  if (enabled && url === BRIDGE_URL) {
    return { instance: instance.name, alreadyWired: true };
  }

  const response = await fetch(`${evoApiUrl}/webhook/set/${enc}`, {
    method: "POST",
    headers: {
      apikey: instance.token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: BRIDGE_URL,
        headers: {
          Authorization: `Bearer ${hookToken}`,
          "Content-Type": "application/json"
        },
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
      }
    })
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`webhook/set ${instance.name} failed ${response.status}: ${body}`);
  }
  return { instance: instance.name, wired: true };
}

async function syncAllInstanceWebhooks() {
  if (syncInFlight) return { skipped: "busy" };
  syncInFlight = true;
  try {
    const { evoApiUrl, globalKey, hookToken } = await getEvolutionBootstrap();
    const hubEnv = await readHubEnv();
    const preferGlobal =
      String(hubEnv.WEBHOOK_GLOBAL_ENABLED || "").toLowerCase() === "true" &&
      String(hubEnv.WEBHOOK_GLOBAL_URL || "").replace(/\/$/, "") === BRIDGE_URL.replace(/\/$/, "");
    const instances = await fetchInstances(evoApiUrl, globalKey);
    const results = [];
    for (const instance of instances) {
      try {
        if (instance.token) instanceTokenCache.set(instance.name, instance.token);
        const integrationInfo = await getEvolutionInstanceIntegration(
          evoApiUrl,
          globalKey,
          instance.name
        );
        if (integrationInfo) instanceIntegrationCache.set(instance.name, integrationInfo);
        const store = hubStore();
        if (store && instance.name) {
          upsertClient(store.db, {
            instanceName: instance.name,
            displayName: instance.name,
            status: instance.connectionStatus || instance.status || null
          });
        }
        results.push(await ensureInstanceWebhook(instance, evoApiUrl, hookToken, { preferGlobal }));
      } catch (error) {
        results.push({ instance: instance.name, error: error.message });
      }
    }
    console.log(JSON.stringify({ at: new Date().toISOString(), sync: results, preferGlobal }));
    return results;
  } finally {
    syncInFlight = false;
  }
}

function presenceTarget(number) {
  const raw = String(number || "").trim();
  if (!raw) return raw;
  // LID chats need the full jid; phone chats use digits only on Evolution 2.3.x
  if (/@lid$/i.test(raw)) return raw;
  if (raw.includes("@")) return raw.split("@")[0].replace(/\D/g, "") || raw.split("@")[0];
  return raw.replace(/\D/g, "") || raw;
}

async function sendPresence({ evoApiUrl, apiKey, instance, number, presence = "composing", delay = 25000 }) {
  const url = `${evoApiUrl}/chat/sendPresence/${encodeURIComponent(instance)}`;
  const target = presenceTarget(number);
  const delayMs = Math.max(1000, Number(delay) || 25000);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ number: target, delay: delayMs, presence })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`sendPresence failed ${response.status}: ${body}`);
  }
}

function startTypingHeartbeat({ evoApiUrl, apiKey, instance, number, isAgency = false }) {
  const disabled = isAgency ? !agencyTypingEnabled() : !hubTypingEnabled();

  if (disabled) {
    return { stop: async () => {} };
  }

  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await sendPresence({
        evoApiUrl,
        apiKey,
        instance,
        number,
        presence: "composing",
        delay: 25000
      });
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), typingError: error.message }));
    }
  };

  // Show typing immediately, then refresh so WhatsApp keeps the official "typing..." indicator.
  tick();
  const timer = setInterval(tick, 4000);
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      try {
        await sendPresence({
          evoApiUrl,
          apiKey,
          instance,
          number,
          presence: "paused",
          delay: 500
        });
      } catch {
        // ignore pause failures
      }
    }
  };
}

function extractOpenClawText(parsed) {
  // OpenClaw --json / gateway shapes vary by version:
  // - { result: { payloads: [{ text }] } }
  // - { payloads: [{ text }] }
  // - OpenAI chat completions: { choices: [{ message: { content } }] }
  const payloads =
    parsed?.result?.payloads ||
    parsed?.payloads ||
    (Array.isArray(parsed?.result) ? parsed.result : null) ||
    [];
  const fromPayloads = Array.isArray(payloads)
    ? payloads.find((payload) => typeof payload?.text === "string")?.text
    : null;
  const fromChoices = parsed?.choices?.[0]?.message?.content;
  const text =
    fromPayloads ||
    (typeof fromChoices === "string" ? fromChoices : null) ||
    (typeof parsed?.result?.text === "string" ? parsed.result.text : null) ||
    (typeof parsed?.text === "string" ? parsed.text : null);
  return typeof text === "string" ? text.trim() : "";
}

async function resolveGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;
  if (process.env.JAB_HUB_OPENCLAW_TOKEN) return process.env.JAB_HUB_OPENCLAW_TOKEN;
  try {
    const cfg = await readConfig();
    return cfg?.gateway?.auth?.token || cfg?.hooks?.token || "";
  } catch {
    return "";
  }
}

async function resolveGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY.trim();
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY.trim();
  }
  try {
    const authPath = path.join(STATE_DIR, "agents", "main", "agent", "auth-profiles.json");
    const raw = (await readFile(authPath, "utf8")).replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    const google =
      parsed?.profiles?.["google:manual"] ||
      parsed?.profiles?.["google:default"] ||
      null;
    const token = google?.token || google?.key || "";
    return typeof token === "string" ? token.trim() : "";
  } catch {
    return "";
  }
}

let sessionHistoryChain = Promise.resolve();

async function readSessionHistory() {
  try {
    const raw = await readFile(SESSION_HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistSessionHistory(mutator) {
  sessionHistoryChain = sessionHistoryChain.then(async () => {
    const sessions = await readSessionHistory();
    await mutator(sessions);
    await mkdir(HUB_STATE_DIR, { recursive: true });
    await writeFile(SESSION_HISTORY_PATH, JSON.stringify(sessions), "utf8");
  });
  return sessionHistoryChain;
}

function splitSystemAndUserPrompt(prompt) {
  const text = String(prompt || "");
  const marker = "\nMessage: ";
  const idx = text.lastIndexOf(marker);
  if (idx >= 0) {
    return {
      system: text.slice(0, idx).trim(),
      user: text.slice(idx + marker.length).trim() || text
    };
  }
  const fromMarker = "\nFrom: ";
  const fromIdx = text.lastIndexOf(fromMarker);
  if (fromIdx >= 0) {
    return {
      system: text.slice(0, fromIdx).trim(),
      user: text.slice(fromIdx + 1).trim() || text
    };
  }
  return { system: "", user: text };
}

async function runGeminiAgent({ prompt, sessionKey, timeoutSec = 30 }) {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) throw new Error("Gemini API key missing (auth-profiles google:manual or GEMINI_API_KEY)");

  const { system, user } = splitSystemAndUserPrompt(prompt);
  const sessions = await readSessionHistory();
  const prior = Array.isArray(sessions[sessionKey]) ? sessions[sessionKey] : [];
  const contents = [];
  for (const turn of prior.slice(-SESSION_HISTORY_MAX)) {
    if (!turn?.text) continue;
    contents.push({
      role: turn.role === "model" ? "model" : "user",
      parts: [{ text: String(turn.text) }]
    });
  }
  contents.push({ role: "user", parts: [{ text: user }] });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5, timeoutSec) * 1000);
  try {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system
          ? { parts: [{ text: system }] }
          : undefined,
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512
        }
      }),
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 400)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Gemini returned non-JSON: ${body.slice(0, 400)}`);
    }
    const parts = parsed?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p) => p?.text || "").join("").trim()
      : "";
    if (!text) throw new Error("Gemini returned no text payload");

    await persistSessionHistory((store) => {
      const next = Array.isArray(store[sessionKey]) ? store[sessionKey].slice() : [];
      next.push({ role: "user", text: user, at: Date.now() });
      next.push({ role: "model", text, at: Date.now() });
      store[sessionKey] = next.slice(-SESSION_HISTORY_MAX);
    });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function runOpenClawAgentHttp({ prompt, sessionKey, timeoutSec = 120 }) {
  const token = await resolveGatewayToken();
  if (!token) throw new Error("OpenClaw gateway token missing (gateway.auth.token)");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5, timeoutSec) * 1000);
  try {
    const response = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-openclaw-agent-id": OPENCLAW_AGENT_ID,
        "x-openclaw-session-key": sessionKey,
        "x-openclaw-message-channel": "whatsapp"
      },
      body: JSON.stringify({
        model: `openclaw/${OPENCLAW_AGENT_ID}`,
        stream: false,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`OpenClaw HTTP ${response.status}: ${body.slice(0, 400)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      throw new Error(`OpenClaw HTTP returned non-JSON: ${body.slice(0, 400)}`);
    }
    const trimmed = extractOpenClawText(parsed);
    if (!trimmed) throw new Error("OpenClaw HTTP returned no text payload");
    return trimmed;
  } finally {
    clearTimeout(timer);
  }
}

function runOpenClawAgentCli({ prompt, sessionKey, timeoutSec = 120 }) {
  return new Promise(async (resolve, reject) => {
    const dir = path.join(tmpdir(), "jab-hub-openclaw-bridge");
    await mkdir(dir, { recursive: true });
    const promptFile = path.join(dir, `${randomUUID()}.txt`);
    await writeFile(promptFile, prompt, "utf8");

    const child = execFile(
      OPENCLAW_CLI,
      [
        "agent",
        "--agent",
        OPENCLAW_AGENT_ID,
        "--session-key",
        sessionKey,
        "--message-file",
        promptFile,
        "--thinking",
        "off",
        "--json",
        "--timeout",
        String(timeoutSec)
      ],
      { shell: process.platform === "win32", windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
      (error, stdout, stderr) => {
        if (error) {
          error.message = `${error.message}\n${stderr}`;
          reject(error);
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          const trimmed = extractOpenClawText(parsed);
          if (!trimmed) throw new Error("OpenClaw returned no text payload");
          resolve(trimmed);
        } catch (parseError) {
          parseError.message = `${parseError.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
          reject(parseError);
        }
      }
    );

    child.stdin?.end();
  });
}

async function runOpenClawAgent({ prompt, sessionKey, timeoutSec = 120 }) {
  const via = OPENCLAW_VIA;

  if (via === "cli") {
    return runOpenClawAgentCli({ prompt, sessionKey, timeoutSec });
  }

  if (via === "http") {
    try {
      return await runOpenClawAgentHttp({ prompt, sessionKey, timeoutSec });
    } catch (httpError) {
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          openclawHttpFallback: httpError.message,
          via: "cli"
        })
      );
      return runOpenClawAgentCli({ prompt, sessionKey, timeoutSec });
    }
  }

  // Default: gemini (fast). Fall back to OpenClaw HTTP, then CLI.
  try {
    return await runGeminiAgent({ prompt, sessionKey, timeoutSec });
  } catch (geminiError) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        geminiFallback: geminiError.message,
        via: "http"
      })
    );
    try {
      return await runOpenClawAgentHttp({ prompt, sessionKey, timeoutSec });
    } catch (httpError) {
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          openclawHttpFallback: httpError.message,
          via: "cli"
        })
      );
      return runOpenClawAgentCli({ prompt, sessionKey, timeoutSec });
    }
  }
}

async function resolveInstanceIntegration(evoApiUrl, globalKey, instance) {
  const name = String(instance || "").trim();
  if (!name) return null;
  if (instanceIntegrationCache.has(name)) return instanceIntegrationCache.get(name);
  const info = await getEvolutionInstanceIntegration(evoApiUrl, globalKey, name);
  instanceIntegrationCache.set(name, info);
  return info;
}

function stripWhatsAppMarkdown(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

async function sendEvolutionText({
  evoApiUrl,
  apiKey,
  instance,
  number,
  text,
  category = "reply",
  isAgency = false
}) {
  const body = isAgency ? stripWhatsAppMarkdown(text) : String(text || "");
  if (!body) return "";

  const { globalKey } = await getEvolutionBootstrap();
  const integration = await resolveInstanceIntegration(evoApiUrl, globalKey, instance);
  if (isCloudApiIntegration(integration)) {
    assertOutboundAllowed(instance, { category, isAgency });
    await throttleOutbound(instance, category);
    const to = presenceTarget(number);
    const creds = resolveMetaCloudCredentialsForInstance(instance);
    if (!creds.accessToken || !creds.phoneNumberId) {
      throw new Error(`meta_cloud_not_configured_for_instance:${instance}`);
    }
    await sendMetaCloudText({
      to,
      text: body,
      accessToken: creds.accessToken,
      phoneNumberId: creds.phoneNumberId
    });
    return JSON.stringify({ metaCloud: true, to, phoneNumberId: creds.phoneNumberId });
  }

  return guardedEvolutionSend({
    evoApiUrl,
    apiKey,
    instance,
    number,
    text: body,
    category,
    isAgency,
    linkPreview: false
  });
}

async function sendEvolutionMedia({
  evoApiUrl,
  apiKey,
  instance,
  number,
  filePath,
  caption = "",
  mimetype
}) {
  const bytes = await readFile(filePath);
  const media = bytes.toString("base64");
  const fileName = path.basename(filePath);
  const url = `${evoApiUrl}/message/sendMedia/${encodeURIComponent(instance)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      number,
      mediatype: "image",
      mimetype: mimetype || guessMimeFromPath(filePath),
      caption: caption || "",
      media,
      fileName
    })
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Evolution sendMedia failed ${response.status}: ${body}`);
  }
  return body;
}

function extractSendPhotoRefs(text) {
  const refs = [];
  const cleaned = String(text || "").replace(/\[SEND_PHOTO:\s*([^\]]+)\]/gi, (_, ref) => {
    refs.push(String(ref).trim());
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), refs };
}

function extractPaymentLinkRefs(text) {
  const refs = [];
  const cleaned = String(text || "").replace(/\[PAYMENT_LINK:\s*([^\]]*)\]/gi, (_, ref) => {
    refs.push(String(ref).trim());
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), refs };
}

async function resolvePaymentLinkPlaceholders(
  text,
  { store, instance, evoApiUrl, isAgency = false, prospectPhone = null, prospectName = null }
) {
  const { text: templated, refs } = extractPaymentLinkRefs(text);
  if (!refs.length || !store) return templated;
  let out = templated;
  const resolveToken = async (name) => resolveInstanceToken(name);
  for (const ref of refs) {
    try {
      const packageId = /^\d+$/.test(ref) ? Number(ref) : null;
      const topup = await initClientTopup(store.db, {
        instanceName: instance,
        packageId,
        publicBase: HUB_PUBLIC_URL,
        evoApiUrl,
        resolveToken,
        notifyWhatsApp: !isAgency,
        prospectPhone: isAgency ? prospectPhone : null,
        prospectName: isAgency ? prospectName : null,
        saleChannel: isAgency ? "agency" : null
      });
      const label = topup.label || topup.package?.name || "plan";
      out = `${out}${out ? "\n" : ""}Pay GHS ${Number(topup.amountGhs).toFixed(0)} (${label} · ${topup.points} credits):\n${topup.authorizationUrl}`.trim();
    } catch (error) {
      out = `${out}${out ? "\n" : ""}(Payment link unavailable: ${error.message})`.trim();
    }
  }
  return out;
}

async function maybeReconcileAgencyPayment({
  store,
  instance,
  number,
  pushName,
  inboundText,
  isAgencyChannel,
  evoApiUrl,
  apiKey
}) {
  if (!isAgencyChannel || !store || !paystackConfigured()) return null;
  if (!/(paid|payment|paystack|sent money|transfer|i'?ve paid|done paying|completed payment|just paid)/i.test(inboundText)) {
    return null;
  }
  const open = getLatestOpenPaymentForProspect(store.db, number);
  if (!open) return null;
  try {
    const verified = await paystackVerify(open.reference);
    if (verified.status !== "success") {
      return `I checked — payment isn't confirmed yet. If you just paid, wait a minute and say "paid" again.\nRef: ${open.reference}`;
    }
    const result = completePaystackPayment(store.db, open.reference, {
      paystackId: verified.id != null ? String(verified.id) : null
    });
    if (result.ok && !result.already) {
      await notifyPaymentSuccess(store.db, {
        instanceName: open.instance_name,
        points: open.points,
        balance: result.wallet?.balance_points,
        evoApiUrl,
        resolveToken: (name) => resolveInstanceToken(name),
        payment: result.payment || getPaystackPaymentByReference(store.db, open.reference),
        pendingCredit: Boolean(result.pendingCredit)
      });
    }
    if (result.pendingCredit) {
      return `Payment confirmed ✅ — GHS ${Number(open.amount_ghs).toFixed(0)} received. We're setting up your agent; credits activate once onboarding is complete.`;
    }
    if (result.already && open.status === "pending") {
      return `Payment confirmed ✅ — +${open.points} credits. Ref: ${open.reference}`;
    }
    if (result.already) {
      return `Yes — your payment was already confirmed ✅ (+${open.points} credits).`;
    }
    return `Payment confirmed ✅ — +${open.points} credits added. New balance: ${result.wallet?.balance_points ?? "—"}.`;
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), agencyReconcileError: error.message }));
    return null;
  }
}

function extractCustomerPayRefs(text) {
  const refs = [];
  const cleaned = String(text || "").replace(/\[CUSTOMER_PAY:\s*([^\]]+)\]/gi, (_, raw) => {
    refs.push(String(raw).trim());
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), refs };
}

function parseKvToken(raw) {
  const out = {};
  for (const part of String(raw || "").split(/[|;]/)) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return out;
}

async function resolveCustomerPayPlaceholders(text, { store, instance, number, client }) {
  const { text: templated, refs } = extractCustomerPayRefs(text);
  if (!refs.length) return templated;
  if (!paystackConfigured()) {
    return `${templated}${templated ? "\n" : ""}(Payment links need Paystack keys in Hub .env)`.trim();
  }
  let out = templated;
  for (const raw of refs) {
    try {
      const kv = parseKvToken(raw);
      const amount = Number(kv.amount || kv.ghs || raw);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid amount");
      const purpose = kv.purpose || kv.for || "Payment";
      ensureClientBillingEmail(store.db, instance, { client, phone: number });
      const email = resolvePaystackBillingEmail(store.db, {
        instanceName: instance,
        client,
        phone: number
      });
      const reference = makePaystackReference("cust");
      const init = await paystackInitialize({
        email,
        amountGhs: amount,
        reference,
        callbackUrl: `${HUB_PUBLIC_URL}/api/billing/customer-pay/callback`,
        metadata: { instance, phone: number, purpose, type: "customer_payment" }
      });
      if (store) {
        createCustomerPayment(store.db, {
          instanceName: instance,
          phone: number,
          amountGhs: amount,
          purpose,
          paystackUrl: init.authorization_url,
          reference
        });
      }
      out = `${out}${out ? "\n" : ""}Pay ${amount} GHS (${purpose}): ${init.authorization_url}`.trim();
    } catch (error) {
      out = `${out}${out ? "\n" : ""}(Customer payment link unavailable: ${error.message})`.trim();
    }
  }
  return out;
}

function extractBookingConfirmRefs(text) {
  const refs = [];
  const cleaned = String(text || "").replace(/\[BOOKING_CONFIRM:\s*([^\]]+)\]/gi, (_, raw) => {
    refs.push(String(raw).trim());
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), refs };
}

function resolveBookingConfirmPlaceholders(text, { store, instance, number, contactId }) {
  const { text: templated, refs } = extractBookingConfirmRefs(text);
  if (!refs.length || !store) return templated;
  let out = templated;
  for (const raw of refs) {
    try {
      const kv = parseKvToken(raw);
      const whenRaw = kv.when || kv.at || kv.starts || "";
      const startsAt = Date.parse(whenRaw);
      if (!Number.isFinite(startsAt)) throw new Error("invalid when (use YYYY-MM-DDTHH:mm)");
      const booking = createBooking(store.db, {
        instanceName: instance,
        phone: number,
        contactId,
        customerName: kv.name || "",
        serviceName: kv.service || kv.for || "Appointment",
        startsAt,
        notes: kv.notes || ""
      });
      const whenLabel = new Date(startsAt).toLocaleString("en-GB", { timeZone: "Africa/Accra" });
      out = `${out}${out ? "\n" : ""}Booked: ${booking.service_name} on ${whenLabel}. We'll remind you before then.`.trim();
    } catch (error) {
      out = `${out}${out ? "\n" : ""}(Booking not saved: ${error.message})`.trim();
    }
  }
  return out;
}

function debitAiUsage(store, instance, { hasImage = false, hasText = false, hasAudio = false }) {
  if (!store) return;
  ensureWallet(store.db, instance);
  if (hasText) {
    const cost = pointsForRate(store.db, "ai_text");
    if (cost > 0) {
      applyWalletDelta(store.db, {
        instanceName: instance,
        direction: "debit",
        amount: cost,
        reason: "ai_text",
        ref: `ai:${instance}:${Date.now()}`
      });
    }
  }
  if (hasImage) {
    const cost = pointsForRate(store.db, rateKeyForAiUsage({ hasImage: true }));
    if (cost > 0) {
      applyWalletDelta(store.db, {
        instanceName: instance,
        direction: "debit",
        amount: cost,
        reason: "ai_image",
        ref: `ai-image:${instance}:${Date.now()}`
      });
    }
  }
  if (hasAudio) {
    const cost = pointsForRate(store.db, rateKeyForAiUsage({ hasAudio: true }));
    if (cost > 0) {
      applyWalletDelta(store.db, {
        instanceName: instance,
        direction: "debit",
        amount: cost,
        reason: "ai_audio",
        ref: `ai-audio:${instance}:${Date.now()}`
      });
    }
  }
}


function extractYangoFeeQueries(text) {
  const queries = [];
  const cleaned = String(text || "").replace(/\[YANGO_FEE:\s*([^\]]+)\]/gi, (_, q) => {
    const token = `__YANGO_FEE_${queries.length}__`;
    queries.push(String(q).trim());
    return token;
  });
  return { text: cleaned, queries };
}

async function resolveYangoFeePlaceholders(text, client) {
  const { text: templated, queries } = extractYangoFeeQueries(text);
  if (!queries.length) return templated;
  await applyHubEnvToProcess();
  let out = templated;
  for (let i = 0; i < queries.length; i += 1) {
    const quote = await estimateYangoDeliveryFee({
      shopLat: client?.shop_lat,
      shopLng: client?.shop_lng,
      shopAddress: client?.shop_address,
      buyerQuery: queries[i]
    });
    const phrase = formatDeliveryFeeForChat(quote);
    out = out.replace(`__YANGO_FEE_${i}__`, phrase);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

async function sendProductPhotos({ store, instance, waInstance = null, evoApiUrl, apiKey, number, refs }) {
  const sendOn = waInstance || instance;
  const uploadsDir = store.paths.uploadsDir;
  const sent = [];
  const seen = new Set();
  for (const ref of refs) {
    const key = String(ref).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const product = findProductForPhoto(store.db, instance, ref);
    if (!product) {
      sent.push({ ref, error: "not-found" });
      continue;
    }
    const images = (product.images || []).filter(Boolean).slice(0, 4);
    if (!images.length) {
      sent.push({ ref, productId: product.id, error: "no-images" });
      continue;
    }
    for (let i = 0; i < images.length; i += 1) {
      const abs = path.isAbsolute(images[i]) ? images[i] : path.join(uploadsDir, images[i]);
      try {
        await sendEvolutionMedia({
          evoApiUrl,
          apiKey,
          instance: sendOn,
          number,
          filePath: abs,
          caption: i === 0 ? `${product.name}${product.sku ? ` (${product.sku})` : ""}` : ""
        });
        sent.push({ ref, productId: product.id, image: images[i], ok: true });
      } catch (error) {
        sent.push({ ref, productId: product.id, image: images[i], error: error.message });
      }
    }
  }
  return sent;
}

function maybeAutoPhotoRefs({ store, instance, inboundText, existingRefs }) {
  if (existingRefs.length || !customerWantsPhoto(inboundText)) return existingRefs;
  const lower = String(inboundText || "").toLowerCase();
  const products = listProducts(store.db, instance, { activeOnly: true });
  const named = products.find(
    (p) => p.images?.length && String(p.name || "").length > 2 && lower.includes(String(p.name).toLowerCase())
  );
  if (named) return [String(named.id)];
  const bySku = products.find(
    (p) => p.images?.length && p.sku && lower.includes(String(p.sku).toLowerCase())
  );
  if (bySku) return [String(bySku.id)];
  return existingRefs;
}

async function sendFollowUp(lead) {
  const { instance, number, pushName } = lead;
  const store = hubStore();
  const agencyName = store ? resolveAgencyInstanceName(store.db) : null;
  const isAgency = agencyName && instance === agencyName;
  if (isAgency && !agencyAutoFollowupsEnabled()) {
    return { instance, number, skipped: "agency_followup_disabled" };
  }

  const { evoApiUrl } = await getEvolutionBootstrap();
  const apiKey = await resolveInstanceToken(instance);
  const sessionKey = `hook:evo:${sanitizeSessionPart(instance)}:${sanitizeSessionPart(number)}`;
  const bookingUrl = String(process.env.JAB_HUB_BOOKING_URL || "").trim();

  const prompt = isAgency
    ? buildAgencyFollowUpPrompt({ pushName, quietHours: FOLLOWUP_HOURS, bookingUrl })
    : [
        "Reply as the client's WhatsApp sales assistant.",
        `The client (${pushName}) has gone quiet for about ${FOLLOWUP_HOURS} hours.`,
        "Write ONE short, friendly WhatsApp check-in that continues from where the chat left off.",
        "Rules: 1-2 short sentences max. No tools. No markdown. No preamble. Don't re-introduce yourself."
      ].join("\n");

  const typing = startTypingHeartbeat({ evoApiUrl, apiKey, instance, number, isAgency });
  try {
    const rawReply = await runOpenClawAgent({
      prompt,
      sessionKey,
      timeoutSec: isAgency ? 45 : 30
    });
    await typing.stop();
    const { text: afterHandoff } = stripHandoffMarker(rawReply);
    const reply = String(afterHandoff || rawReply || "").trim();
    await sendEvolutionText({
      evoApiUrl,
      apiKey,
      instance,
      number,
      text: reply,
      category: "proactive",
      isAgency
    });
    await recordOutbound({ instance, number, followUp: true });
    return { instance, number, reply, agency: Boolean(isAgency) };
  } catch (error) {
    await typing.stop();
    await persistLeads((leads) => {
      const entry = leads[leadKey(instance, number)];
      if (entry) entry.followUpError = error.message;
    });
    throw error;
  }
}

/** Send one AI check-in per lead that has been quiet >= FOLLOWUP_HOURS. */
async function runFollowUpSweep() {
  if (followUpInFlight) return { skipped: "busy" };
  followUpInFlight = true;
  try {
    const now = Date.now();
    const leads = await readLeads();
    const due = Object.values(leads).filter(
      (lead) =>
        lead &&
        lead.instance &&
        lead.number &&
        !lead.followUpSent &&
        typeof lead.followUpAt === "number" &&
        now >= lead.followUpAt
    );
    const store = hubStore();
    const results = [];
    // Serialize sends: one OpenClaw run at a time to avoid OOM on this host.
    for (const lead of due) {
      if (store && isAgencyInstance(store.db, lead.instance) && !agencyAutoFollowupsEnabled()) {
        results.push({ instance: lead.instance, number: lead.number, skipped: "agency_followup_disabled" });
        continue;
      }
      if (store && isContactHumanOwned(store.db, lead.instance, lead.number)) {
        results.push({ instance: lead.instance, number: lead.number, skipped: "human-owned" });
        continue;
      }
      try {
        results.push({ ...(await sendFollowUp(lead)), sent: true });
      } catch (error) {
        results.push({ instance: lead.instance, number: lead.number, error: error.message });
      }
    }
    if (results.length) {
      console.log(JSON.stringify({ at: new Date().toISOString(), followUps: results }));
    }
    return results;
  } finally {
    followUpInFlight = false;
  }
}

function detectKeywordHandoff(text, keywordsCsv) {
  const lower = String(text || "").toLowerCase();
  const keywords = String(keywordsCsv || DEFAULT_HANDOFF_KEYWORDS)
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  return keywords.find((k) => lower.includes(k)) || null;
}

function stripHandoffMarker(reply) {
  const raw = String(reply || "");
  const has = /\[HANDOFF\]/i.test(raw);
  const cleaned = raw.replace(/\[HANDOFF\]/gi, "").trim();
  return { text: cleaned, aiHandoff: has };
}

const HANDOFF_BRIEFING_LINE =
  /^\s*(Customer:|Intent:|Discussed so far:|What AI already said\/offered:|Open questions\s*\/\s*next step:|Suggested first reply:)/i;

function looksLikeHandoffBriefing(text) {
  const lines = String(text || "").split("\n");
  const hits = lines.filter((line) => HANDOFF_BRIEFING_LINE.test(line)).length;
  return hits >= 2;
}

function stripInternalBriefingLines(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !HANDOFF_BRIEFING_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Customer-facing reply only — internal briefing goes to connected ops numbers separately. */
function customerHandoffReply(reply, { isAgency = false } = {}) {
  const stripped = stripInternalBriefingLines(reply);
  if (!stripped || looksLikeHandoffBriefing(reply)) {
    return isAgency
      ? "Thanks — I'm connecting you with someone from our team. You'll hear back here shortly."
      : "Thanks — I'm connecting you with a team member who will continue this chat shortly.";
  }
  if (stripped.length > 420) {
    return isAgency
      ? "Thanks — I'm connecting you with someone from our team. You'll hear back here shortly."
      : "Thanks — I'm connecting you with a team member who will continue this chat shortly.";
  }
  return stripped;
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function resolveHandoffOpsPhones(db, instanceName, customerPhone) {
  const customerDigits = normalizePhoneDigits(customerPhone);
  const fromClient = getClientAdminPhones(db, instanceName);
  const envFallback = String(process.env.JAB_AGENCY_OPS_PHONE || process.env.JAB_HUB_ADMIN_PHONE || "")
    .split(/[,;\s]+/)
    .map(normalizePhoneDigits)
    .filter(Boolean);
  const merged = [...new Set([...fromClient, ...envFallback])];
  return merged.filter((phone) => {
    if (!phone) return false;
    if (!customerDigits) return true;
    return phone !== customerDigits && !customerDigits.endsWith(phone) && !phone.endsWith(customerDigits);
  });
}

/** Build a handoff briefing from the same OpenClaw session so the human can continue. */
async function buildHandoffBriefing({ sessionKey, pushName, number, inboundText, aiReply }) {
  const prompt = [
    "You are writing an INTERNAL handoff briefing for a human sales agent.",
    "They will continue this WhatsApp chat. Use the prior conversation in this session.",
    "Output plain text only. No markdown. No [HANDOFF]. No tools.",
    "Format exactly like this:",
    "Customer: ...",
    "Intent: ...",
    "Discussed so far: ...",
    "What AI already said/offered: ...",
    "Open questions / next step: ...",
    "Suggested first reply: ...",
    "Keep each line short (1 sentence).",
    `Customer name: ${pushName}`,
    `Customer phone: ${number}`,
    `Latest customer message: ${inboundText}`,
    aiReply ? `Latest AI reply just sent: ${aiReply}` : "No AI reply was sent yet."
  ].join("\n");

  try {
    const briefing = await runOpenClawAgent({ prompt, sessionKey });
    return String(briefing || "").replace(/\[HANDOFF\]/gi, "").trim().slice(0, 3500);
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), briefingError: error.message }));
    return [
      `Customer: ${pushName} (${number})`,
      `Latest message: ${inboundText}`,
      aiReply ? `AI last said: ${aiReply}` : null,
      "Open questions / next step: Continue from the customer's latest message."
    ]
      .filter(Boolean)
      .join("\n");
  }
}

async function sendConnectedOpsHandoffAlert({
  db,
  evoApiUrl,
  apiKey,
  instance,
  customerPhone,
  customerName,
  summary,
  reason,
  lastCustomerMessage,
  isAgency = false
}) {
  const phones = resolveHandoffOpsPhones(db, instance, customerPhone);
  if (!phones.length) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        handoffOpsAlertSkipped: "no_ops_phones",
        instance
      })
    );
    return { sent: 0, skipped: "no_ops_phones" };
  }

  const briefing = String(summary || "").trim();
  const shortBrief =
    briefing.length > 900 ? `${briefing.slice(0, 880).trim()}…\n(Full briefing in Hub)` : briefing;
  const business = getClient(db, instance);
  const businessName = business?.display_name || instance;
  const businessPhone = business?.contact_phone || business?.whatsapp_order_number || null;
  const header = isAgency
    ? "Handoff on JAB agency WhatsApp (internal — do not forward to customer):"
    : `Handoff on ${businessName} (internal):`;
  const text = [
    header,
    ...(isAgency
      ? formatContactAlertLines({ name: customerName, phone: customerPhone, label: "Client" })
      : [
          ...(businessName || businessPhone
            ? [
                businessPhone
                  ? `Business: ${businessName} · WhatsApp ${formatDisplayPhone(businessPhone)}`
                  : `Business: ${businessName}`
              ]
            : []),
          ...formatContactAlertLines({ name: customerName, phone: customerPhone, label: "Customer" })
        ]),
    reason ? `Reason: ${reason}` : null,
    shortBrief ? `\nChat summary:\n${shortBrief}` : null,
    lastCustomerMessage ? `\nLast customer message: ${lastCustomerMessage}` : null,
    `\nHub: ${HUB_PUBLIC_URL}`
  ]
    .filter(Boolean)
    .join("\n");

  let sent = 0;
  for (const phone of phones) {
    try {
      await sendEvolutionText({
        evoApiUrl,
        apiKey,
        instance,
        number: phone,
        text,
        category: "ops",
        isAgency
      });
      sent += 1;
    } catch (error) {
      console.error(
        JSON.stringify({ at: new Date().toISOString(), handoffOpsAlertError: error.message, phone })
      );
    }
  }
  return { sent, phones };
}

async function refreshAgencyProspectScore({
  store,
  instance,
  contact,
  inboundText,
  evoApiUrl,
  apiKey
}) {
  if (!store?.db || !contact?.id) return null;
  const messages = listConversationMessages(store.db, instance, contact.phone, { limit: 40 });
  const { score, summary } = scoreAgencyProspect({
    messages,
    inboundText,
    pushName: contact.push_name,
    existingScore: contact.qualification_score
  });
  const updated = updateContactQualification(store.db, contact.id, { score, summary });
  try {
    await maybeNotifyAgencyScoreThreshold({
      db: store.db,
      evoApiUrl,
      resolveToken: async () => apiKey,
      instanceName: instance,
      contact: updated || contact,
      publicBase: HUB_PUBLIC_URL
    });
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), agencyScoreNotifyError: error.message }));
  }
  return updated;
}

async function refreshClientProspectScore({
  store,
  instance,
  contact,
  inboundText,
  evoApiUrl,
  apiKey
}) {
  if (!store?.db || !contact?.id) return null;
  const messages = listConversationMessages(store.db, instance, contact.phone, { limit: 40 });
  const { score, summary } = scoreClientProspect({
    messages,
    inboundText,
    pushName: contact.push_name,
    existingScore: contact.qualification_score
  });
  const updated = updateContactQualification(store.db, contact.id, { score, summary });
  try {
    await maybeNotifyClientScoreThreshold({
      db: store.db,
      evoApiUrl,
      resolveToken: async () => apiKey,
      instanceName: instance,
      contact: updated || contact,
      publicBase: HUB_PUBLIC_URL
    });
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), clientScoreNotifyError: error.message }));
  }
  return updated;
}

async function sendAgentWhatsAppAlert({ db, evoApiUrl, apiKey, instance, agent, contact, lead, summary }) {
  const briefing = String(summary || lead?.summary || "").trim();
  // Keep WhatsApp alert readable; full briefing is in Hub.
  const shortBrief =
    briefing.length > 900 ? `${briefing.slice(0, 880).trim()}…\n(Full briefing in Hub)` : briefing;

  const business = db ? getClient(db, instance) : null;
  const businessName = business?.display_name || instance;
  const businessPhone = business?.contact_phone || business?.whatsapp_order_number || null;

  const text = [
    `New lead assigned to you (${agent.name}).`,
    businessPhone
      ? `Client: ${businessName} · WhatsApp ${formatDisplayPhone(businessPhone)}`
      : `Client: ${businessName}`,
    ...formatContactAlertLines({
      name: contact.push_name,
      phone: contact.phone,
      label: "Customer"
    }),
    shortBrief ? `\nChat summary:\n${shortBrief}` : null,
    lead?.last_customer_message ? `\nLast customer message: ${lead.last_customer_message}` : null,
    `\nContinue in Hub: ${HUB_PUBLIC_URL}/agent.html`
  ]
    .filter(Boolean)
    .join("\n");

  await sendEvolutionText({
    evoApiUrl,
    apiKey,
    instance,
    number: agent.phone,
    text,
    category: "ops",
    isAgency: false
  });
}

async function runHandoffForContact({
  store,
  instance,
  contact,
  reason,
  summary,
  lastCustomerMessage,
  evoApiUrl,
  apiKey,
  isAgency = false
}) {
  const result = processHandoff(store.db, {
    instanceName: instance,
    contactId: contact.id,
    reason,
    summary,
    lastCustomerMessage
  });

  // Always refresh briefing on the lead when we have a better summary.
  if (summary && result.lead?.id) {
    updateLeadSummary(store.db, result.lead.id, summary);
    result.lead = { ...result.lead, summary };
  }

  // Internal summary → connected ops/admin numbers only (never the customer chat).
  try {
    if (isAgency) {
      const settings = getAgencySettings(store.db);
      const mode = String(settings?.agency_notify_mode || "digest").toLowerCase();
      if (mode !== "off") {
        const fresh = getContact(store.db, contact.id) || contact;
        if (mode === "handoff_full") {
          await sendAgencyHandoffBriefing({
            db: store.db,
            evoApiUrl,
            resolveToken: async () => apiKey,
            instanceName: instance,
            pushName: fresh.push_name,
            phone: fresh.phone,
            summary,
            reason,
            lastCustomerMessage,
            publicBase: HUB_PUBLIC_URL,
            score: fresh.qualification_score
          });
        } else {
          const digestSummary = digestFromHandoffBriefing(summary, {
            pushName: fresh.push_name,
            score: fresh.qualification_score,
            fallback: fresh.qualification_summary
          });
          await sendAgencyLeadDigest({
            db: store.db,
            evoApiUrl,
            resolveToken: async () => apiKey,
            instanceName: instance,
            pushName: fresh.push_name,
            phone: fresh.phone,
            score: fresh.qualification_score,
            summary: digestSummary,
            event: "Handoff — review in Hub",
            publicBase: HUB_PUBLIC_URL,
            excludePhone: fresh.phone
          });
        }
      }
    } else {
      const clientRow = getClient(store.db, instance);
      const mode = String(clientRow?.client_notify_mode || "digest").toLowerCase();
      if (mode !== "off") {
        const fresh = getContact(store.db, contact.id) || contact;
        if (mode === "handoff_full") {
          await sendClientHandoffBriefing({
            db: store.db,
            evoApiUrl,
            resolveToken: async () => apiKey,
            instanceName: instance,
            pushName: fresh.push_name,
            phone: fresh.phone,
            summary,
            reason,
            lastCustomerMessage,
            publicBase: HUB_PUBLIC_URL,
            score: fresh.qualification_score
          });
        } else {
          const digestSummary = digestFromHandoffBriefing(summary, {
            pushName: fresh.push_name,
            score: fresh.qualification_score,
            fallback: fresh.qualification_summary
          });
          await sendClientLeadDigest({
            db: store.db,
            evoApiUrl,
            resolveToken: async () => apiKey,
            instanceName: instance,
            pushName: fresh.push_name,
            phone: fresh.phone,
            score: fresh.qualification_score,
            summary: digestSummary,
            event: "Handoff — review in Hub",
            publicBase: HUB_PUBLIC_URL,
            excludePhone: fresh.phone
          });
        }
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), opsHandoffAlertError: error.message }));
  }

  // Client store: also ping assigned sales agent when auto-assigned.
  if (!isAgency && result.needsAlert && result.agent) {
    try {
      await sendAgentWhatsAppAlert({
        db: store.db,
        evoApiUrl,
        apiKey,
        instance,
        agent: result.agent,
        contact,
        lead: result.lead,
        summary
      });
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), agentAlertError: error.message }));
    }
  }

  return result;
}

/** Handle Meta Cloud API webhook directly (bypass Evolution inbound). */
async function handleMetaWebhook(payload) {
  const configuredPnId = resolveMetaPhoneNumberId();
  const store = hubStore();
  const agencyInstance =
    String(process.env.JAB_AGENCY_INSTANCE || "").trim() ||
    (store ? resolveAgencyInstanceName(store.db) : "") ||
    "JAB Agent Number";

  const messages = listMetaWebhookInboundMessages(payload);
  if (!messages.length) return { skipped: "no_text_messages" };

  const results = [];
  for (const inbound of messages) {
    const routedInstance = resolveInstanceForMetaPhoneNumberId(inbound.phoneNumberId, agencyInstance);
    if (
      inbound.phoneNumberId &&
      !routedInstance &&
      configuredPnId &&
      String(inbound.phoneNumberId) !== String(configuredPnId)
    ) {
      results.push({ skipped: "wrong_phone_number_id", got: inbound.phoneNumberId });
      continue;
    }
    const targetInstance = routedInstance || agencyInstance;
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        metaWebhookInbound: {
          from: inbound.from,
          instance: targetInstance,
          phoneNumberId: inbound.phoneNumberId,
          text: String(inbound.text).slice(0, 120)
        }
      })
    );
    const synthetic = {
      event: "messages.upsert",
      instance: targetInstance,
      data: {
        key: {
          fromMe: false,
          remoteJid: `${inbound.from}@s.whatsapp.net`,
          id: inbound.messageId || `meta-${Date.now()}`
        },
        pushName: inbound.displayName || "WhatsApp contact",
        message: { conversation: inbound.text }
      }
    };
    results.push(await handleEvolutionPayload(synthetic));
  }
  return results;
}

async function handleEvolutionPayload(payload) {
  const event = String(payload?.event || "").toUpperCase().replace(".", "_");

  if (event === "CONNECTION_UPDATE") {
    // Non-blocking so inbound replies are never delayed by sync.
    syncAllInstanceWebhooks().catch((error) => {
      console.error(JSON.stringify({ at: new Date().toISOString(), syncError: error.message }));
    });
    return { synced: "queued", event };
  }

  if (event !== "MESSAGES_UPSERT") return { skipped: "unsupported-event", event };

  const data = payload?.data || {};
  const key = data.key || {};
  if (key.remoteJid === "status@broadcast") return { skipped: "outbound-or-status" };

  const peer = resolveInboundPeer(payload);
  const number = peer.phone;
  if (!number) return { skipped: "missing-text-or-number" };

  const { evoApiUrl } = await getEvolutionBootstrap();
  const instance = String(payload.instance || "").trim();
  if (!instance) throw new Error("Webhook payload missing instance name");

  const apiKeyEarly = await resolveInstanceToken(instance);
  const storeEarly = hubStore();
  const resolved = await resolveInboundText({
    evoApiUrl,
    apiKey: apiKeyEarly,
    instance,
    data,
    store: storeEarly
  });
  const inboundText = resolved.text;
  if (!inboundText) return { skipped: "missing-text-or-number" };
  // Location pins become text like "Shared location: lat,lng" via readMessageText.

  // Owner/admin can update live deals by messaging this WhatsApp (including fromMe / Notes to self).
  if (isAdminDealCommand(inboundText)) {
    const store = hubStore();
    if (store) {
      let ownerPhone = "";
      try {
        const { globalKey } = await getEvolutionBootstrap();
        const instances = await fetchInstances(evoApiUrl, globalKey);
        const match = instances.find((i) => i.name === instance);
        ownerPhone = normalizePhoneFromJid(match?.ownerJid || match?.owner || "");
      } catch {
        /* ignore */
      }
      const adminOk =
        isClientAdminPhone(store.db, instance, number) ||
        (ownerPhone &&
          (number === ownerPhone || number.endsWith(ownerPhone) || ownerPhone.endsWith(number))) ||
        Boolean(key.fromMe); // fromMe on this linked instance = the phone owner
      if (adminOk) {
        const messageId = key.id || data.messageId || payload.messageId;
        if (!claimInboundMessage(instance, messageId)) {
          return { skipped: "duplicate-message", instance, messageId, number };
        }
        const result = handleAdminDealCommand(store.db, instance, inboundText);
        if (result) {
          const apiKey = await resolveInstanceToken(instance);
          const replyTarget = key.fromMe
            ? peer.replyJid || (ownerPhone ? `${ownerPhone}@s.whatsapp.net` : `${number}@s.whatsapp.net`)
            : await resolveReplyJid({
                evoApiUrl,
                apiKey,
                instance,
                peer,
                pushName: data.pushName || ""
              });
          await sendEvolutionText({
            evoApiUrl,
            apiKey,
            instance,
            number: replyTarget,
            text: result.reply
          });
          console.log(
            JSON.stringify({
              at: new Date().toISOString(),
              adminDealCommand: true,
              instance,
              number,
              fromMe: Boolean(key.fromMe),
              ok: result.ok
            })
          );
          return { admin: true, instance, number, ok: result.ok };
        }
      }
    }
  }

  if (key.fromMe) return { skipped: "outbound-or-status" };

  const messageId = key.id || data.messageId || payload.messageId;
  if (!claimInboundMessage(instance, messageId)) {
    return { skipped: "duplicate-message", instance, messageId, number };
  }

  const apiKey = await resolveInstanceToken(instance);
  const replyJid = await resolveReplyJid({
    evoApiUrl,
    apiKey,
    instance,
    peer,
    pushName: data.pushName || payload.pushName || ""
  });
  const pushName = data.pushName || payload.pushName || "WhatsApp contact";
  const store = hubStore();

  // Dedicated UAE Real Estate WhatsApp instance — full concierge (listings, alerts, viewings).
  if (store && isReWhatsAppInstance(instance)) {
    try {
      const reResult = await handleReWhatsAppInbound({
        db: store.db,
        instance,
        number,
        replyJid,
        inboundText,
        pushName,
        evoApiUrl,
        apiKey,
        sendText: sendEvolutionText
      });
      await recordOutbound({ instance, number });
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          reWhatsApp: true,
          instance,
          number,
          sessionId: reResult.sessionId,
          listings: reResult.listings
        })
      );
      return { ...reResult, instance, number, replyJid };
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), reWhatsAppError: error.message }));
      try {
        await sendEvolutionText({
          evoApiUrl,
          apiKey,
          instance,
          number: replyJid,
          text: "Sorry — property search hit a snag. Try again in a moment.",
          isAgency: true
        });
      } catch {
        /* ignore */
      }
      return { sent: false, reChat: true, error: error.message, instance, number };
    }
  }

  const isPhysicalAgency = store ? isAgencyInstance(store.db, instance) : false;
  let effectiveInstance = instance;
  let platformWelcomeText = null;

  if (isPhysicalAgency && store) {
    const route = resolvePlatformRoute(store.db, {
      agencyInstance: instance,
      customerPhone: number,
      inboundText
    });
    if (route.action === "menu" && route.menuText) {
      if (!allowAgencyFastReply(number)) {
        return { skipped: "agency-inbound-cooldown", instance, number };
      }
      try {
        await sendEvolutionText({
          evoApiUrl,
          apiKey,
          instance,
          number: replyJid,
          text: route.menuText,
          category: "reply",
          isAgency: true
        });
        await recordOutbound({ instance, number });
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), platformMenuError: error.message }));
        return { sent: false, error: "platform_menu_failed", instance, number };
      }
      return { sent: true, number, replyJid, instance, platformMenu: true };
    }
    if (route.action === "tenant" && route.tenantInstance) {
      const activeTenants = listPlatformTenants(store.db, { agencyInstanceName: instance });
      if (activeTenants.some((t) => t.instance_name === route.tenantInstance)) {
        effectiveInstance = route.tenantInstance;
        platformWelcomeText = route.newlyBound ? route.welcomeText : null;
      }
    }
  }

  const isAgencySalesFlow = isPhysicalAgency && effectiveInstance === instance;
  const sessionKey =
    isPhysicalAgency && effectiveInstance !== instance
      ? `hook:evo:pt:${sanitizeSessionPart(effectiveInstance)}:${sanitizeSessionPart(number)}`
      : `hook:evo:${sanitizeSessionPart(effectiveInstance)}:${sanitizeSessionPart(number)}`;
  const startedAt = Date.now();
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      inboundPeer: {
        number,
        remoteJid: peer.remoteJid,
        replyJid,
        addressingMode: peer.addressingMode,
        remoteJidAlt: peer.remoteJidAlt,
        senderLid: peer.senderLid,
        effectiveInstance,
        isAgencySalesFlow,
        platformTenant: effectiveInstance !== instance ? effectiveInstance : null
      }
    })
  );

  // Track lead state so quiet clients can be followed up after FOLLOWUP_HOURS.
  await recordInbound({ instance: effectiveInstance, number, pushName, text: inboundText });

  if (store) {
    try {
      const contact = upsertContact(store.db, {
        instanceName: effectiveInstance,
        phone: number,
        pushName,
        lastInboundAt: Date.now(),
        lastInboundText: inboundText
      });
      addConversationMessage(store.db, {
        instanceName: effectiveInstance,
        phone: number,
        contactId: contact?.id || null,
        direction: "in",
        role: "customer",
        body: inboundText,
        meta: resolved.fromVoice ? { voice: true } : {}
      });
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), inboxLogInError: error.message }));
    }
  }

  // Proactive marketing: link inbound replies on agency instance back to marketing leads.
  if (store) {
    try {
      const agencyInstance = resolveAgencyInstanceName(store.db);
      if (instance === agencyInstance) {
        const mktLead = getMarketingLeadByPhone(store.db, instance, number);
        if (mktLead && ["sent", "approved", "replied"].includes(mktLead.status)) {
          markMarketingLeadReplied(store.db, mktLead.id);
          cancelFollowUpsForPhone(store.db, instance, number, "replied");
          const optOut = /\b(stop|unsubscribe|opt\s*out|don't\s*message|do\s*not\s*message|remove\s*me)\b/i.test(
            inboundText
          );
          if (optOut) {
            const contact = getContactByPhone(store.db, instance, number);
            if (contact) {
              updateContact(store.db, contact.id, { optedOut: 1 });
            }
            cancelFollowUpsForPhone(store.db, instance, number, "opt_out");
            addMarketingEvent(store.db, {
              leadId: mktLead.id,
              eventType: "opt_out",
              detail: inboundText.slice(0, 300)
            });
          }
          // Best-effort Telegram notify for the operator who approved the lead.
          const tgToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
          if (tgToken && mktLead.telegram_chat_id) {
            fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: mktLead.telegram_chat_id,
                text: [
                  `💬 Reply on marketing lead #${mktLead.id}`,
                  `Business: ${mktLead.business_name || "—"}`,
                  `From: ${pushName} (+${number})`,
                  "",
                  String(inboundText).slice(0, 500)
                ].join("\n"),
                disable_web_page_preview: true
              })
            }).catch(() => {});
          }
        }
      }
    } catch (error) {
      console.error(
        JSON.stringify({ at: new Date().toISOString(), marketingReplyHook: error.message })
      );
    }
  }

  if (store && isContactHumanOwned(store.db, effectiveInstance, number)) {
    const contact = getContactByPhone(store.db, effectiveInstance, number);
    if (contact) {
      const open = getOpenLeadForContact(store.db, contact.id);
      if (open) appendLeadMessage(store.db, open.id, inboundText);
    }
    return {
      skipped: "human-owned",
      instance: effectiveInstance,
      waInstance: instance,
      number,
      note: "AI paused — sales agent owns this chat"
    };
  }

  if (platformWelcomeText) {
    const trimmed = String(inboundText || "").trim();
    const selectionOnly =
      /^([1-9]|ref:[a-z0-9-]+|#[a-z0-9-]+)$/i.test(trimmed) ||
      /^hi\s+(ref:)?[a-z0-9-][a-z0-9-]*$/i.test(trimmed);
    if (selectionOnly) {
      try {
        await sendEvolutionText({
          evoApiUrl,
          apiKey,
          instance,
          number: replyJid,
          text: platformWelcomeText,
          category: "reply",
          isAgency: isPhysicalAgency
        });
        await recordOutbound({ instance: effectiveInstance, number });
        addConversationMessage(store.db, {
          instanceName: effectiveInstance,
          phone: number,
          direction: "out",
          role: "assistant",
          body: platformWelcomeText
        });
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), platformWelcomeError: error.message }));
        return { sent: false, error: "platform_welcome_failed", instance, effectiveInstance, number };
      }
      return { sent: true, number, replyJid, instance, effectiveInstance, platformWelcome: true };
    }
  }

  // Agency line: property queries → RE concierge when JAB_RE_WA_ON_AGENCY=1 (before JAB sales OpenClaw).
  if (
    store &&
    isAgencySalesFlow &&
    isReWhatsAppOnAgencyEnabled() &&
    shouldRouteInboundToRealEstate(inboundText)
  ) {
    try {
      const reResult = await handleReWhatsAppInbound({
        db: store.db,
        instance,
        number,
        replyJid,
        inboundText,
        pushName,
        evoApiUrl,
        apiKey,
        sendText: sendEvolutionText,
        reOnAgency: true
      });
      await recordOutbound({ instance, number });
      return { ...reResult, instance, number, replyJid, reOnAgency: true };
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), reOnAgencyError: error.message }));
    }
  }

  const client = store ? getClient(store.db, effectiveInstance) : null;
  const keywordHit = detectKeywordHandoff(inboundText, client?.handoff_keywords);
  const agencyInstanceResolved = store ? resolveAgencyInstanceName(store.db) : null;
  const bookingUrl = String(process.env.JAB_HUB_BOOKING_URL || "").trim();

  if (isAgencySalesFlow && store) {
    const reconciled = await maybeReconcileAgencyPayment({
      store,
      instance,
      number,
      pushName,
      inboundText,
      isAgencyChannel: isAgencySalesFlow,
      evoApiUrl,
      apiKey
    });
    if (reconciled) {
      try {
        await sendEvolutionText({
          evoApiUrl,
          apiKey,
          instance,
          number: replyJid,
          text: reconciled,
          category: "reply",
          isAgency: true
        });
        await recordOutbound({ instance, number });
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), reconcileReplyError: error.message }));
      }
      return { sent: true, number, replyJid, instance, reply: reconciled, reconciled: true };
    }
  }

  // Points gate: client / platform tenants need AI text balance. JAB agency sales flow is exempt.
  if (store && !isAgencySalesFlow) {
    const textCost = pointsForRate(store.db, "ai_text");
    const wallet = ensureWallet(store.db, effectiveInstance);
    if (textCost > 0 && (wallet.balance_points || 0) < textCost) {
      let topupUrl = null;
      try {
        const topup = await initClientTopup(store.db, {
          instanceName: effectiveInstance,
          publicBase: HUB_PUBLIC_URL,
          evoApiUrl,
          resolveToken: resolveInstanceToken,
          notifyWhatsApp: true
        });
        topupUrl = topup.authorizationUrl;
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), topupError: error.message }));
      }
      const paused =
        "Thanks for messaging — our AI assistant is paused while this business tops up messaging credits." +
        (topupUrl ? ` Owner top-up: ${topupUrl}` : "");
      try {
        await sendEvolutionText({
          evoApiUrl,
          apiKey,
          instance,
          number: replyJid,
          text: paused,
          category: "reply",
          isAgency: isPhysicalAgency
        });
      } catch {
        /* ignore */
      }
      if (agencyInstanceResolved && client?.contact_phone) {
        try {
          await sendAgencyText({
            db: store.db,
            evoApiUrl,
            resolveToken: resolveInstanceToken,
            agencyInstance: agencyInstanceResolved,
            toPhone: client.contact_phone,
            text: [
              `AI paused for ${client.display_name || effectiveInstance} — insufficient points (balance ${wallet.balance_points}).`,
              topupUrl ? `Top up: ${topupUrl}` : "Configure Paystack / packages in Hub Finance."
            ].join("\n")
          });
        } catch (error) {
          console.error(JSON.stringify({ at: new Date().toISOString(), agencyPauseNotify: error.message }));
        }
      }
      return { skipped: "insufficient_points", instance: effectiveInstance, waInstance: instance, number, balance: wallet.balance_points };
    }
  }

  const typing = startTypingHeartbeat({ evoApiUrl, apiKey, instance, number: replyJid, isAgency: isPhysicalAgency });

  let prompt;
  if (isAgencySalesFlow) {
    const packagesText = store ? formatPackagesForAgent(store.db) : "";
    prompt = buildAgencyInboundPrompt({ pushName, number, inboundText, bookingUrl, packagesText });
  } else {
    const customPersona = String(client?.system_prompt || "").trim();
    const dealsBoard = store ? formatDealsForAgent(store.db, effectiveInstance) : "";
    const catalog = store ? formatCatalogForAgent(store.db, effectiveInstance) : "";
    const useRecruitmentMode = Boolean(customPersona || dealsBoard);
    const storeSalesRules =
      !useRecruitmentMode && catalog
        ? [
            "Store/COD sales mode:",
            "- This WhatsApp thread already has prior turns in your session memory. Continue from where you left off — do not restart with a fresh greeting if you already greeted or discussed a product.",
            "- Use ONLY the catalog below for product names, prices, currency, and stock. Do not invent products, prices, discounts, or payment methods.",
            "- If a product is out of stock, say so and suggest an in-stock alternative from the catalog.",
            "- When the customer asks for a photo/picture/image of a product that has photos>0, include the exact token [SEND_PHOTO:id] using that product's id from the catalog (customers must not see this token). You may still write a short sentence about the product.",
            "- For delivery fee: ask for the buyer's area/landmark or WhatsApp location pin, then include [YANGO_FEE:their location text or lat,lng] in your reply. The system replaces that token with the Yango fee — do not invent a fee number yourself.",
            "- Help the customer choose, then confirm product, quantity, product total, and Yango delivery fee (via [YANGO_FEE:...]), plus delivery address.",
            "- Payment method is Cash on Delivery / payment on delivery only unless the catalog explicitly says otherwise.",
            "- Before handoff, ask for final confirmation (for example: Reply YES to confirm).",
            "- When the customer confirms the order, send a short order confirmation with product, quantity, product total, delivery fee, COD/payment-on-delivery, and say a delivery agent will contact them shortly.",
            "- After that confirmed-order message, end your reply with the exact token [HANDOFF].",
            "- Also use [HANDOFF] if the customer directly asks for a human after ordering.",
            "- If the order was already confirmed earlier in this chat and they ask a follow-up (fee, time, address change, photo), answer that follow-up — do not re-sell from scratch.",
            "- Do not hand off just because the customer is browsing or asking product questions; try to close the sale first."
          ].join("\n")
        : null;
    const recruitmentRules = useRecruitmentMode
      ? [
          "Natural WhatsApp chat mode (recruitment):",
          "- Chat like a real person texting. Short. Human. No scripts, no menus, no numbered questions, no formal summaries.",
          "- Ask at most ONE follow-up question per reply. Never interview them with a list.",
          "- Use ONLY CURRENT LIVE DEALS below. Do not invent destinations, salaries, fees, visas, or job titles.",
          "- If they ask what's available, mention 2–4 relevant options casually — not the full catalogue unless they insist.",
          "- Talk money/fees the way a colleague would: rough figures from the deals list, then say office can confirm. Never promise visa/job/salary/departure.",
          "- Ready to apply/pay/speak to someone → brief reply + [HANDOFF]. Don't ask for passport/ID photos in chat.",
          "- Forbidden phrasing: 'How can I assist', 'I'd be happy to help', 'As an AI', 'Here are your options', 'Please provide the following'."
        ].join("\n")
      : null;
    const knowledge = store ? formatKnowledgeForAgent(store.db, effectiveInstance) : "";
    const agentType = String(client?.agent_type || "store");
    const clientBookingUrl = String(client?.booking_url || bookingUrl || "").trim();
    const serviceChatRules =
      agentType === "pa" || agentType === "customer_service"
        ? [
            agentType === "pa"
              ? "Personal assistant mode: help the owner with scheduling, reminders, and triage like a sharp PA texting on WhatsApp."
              : "Customer service mode: resolve customer issues warmly and clearly — like a front-desk agent, not a script bot.",
            "- Chat naturally. Short bubbles. Mirror their tone.",
            "- Ask at most ONE clarifying question when needed.",
            "- Use the knowledge base for facts. Do not invent policies, prices, or promises.",
            "- Use [HANDOFF] when they need a human decision or escalation.",
            "- Forbidden: 'How can I assist you today', 'As an AI', long numbered menus."
          ].join("\n")
        : null;
    const bookingRules =
      agentType === "booking"
        ? [
            "Booking mode:",
            "- Help them pick a service and time. Confirm name + datetime before finalizing.",
            "- Chat naturally — no rigid scripts or interview lists.",
            clientBookingUrl ? `- Public booking link if helpful: ${clientBookingUrl}` : null,
            "- When a booking is confirmed, include exactly: [BOOKING_CONFIRM:service=...;when=YYYY-MM-DDTHH:mm;name=...]",
            "- For deposits, include [CUSTOMER_PAY:amount=50;purpose=booking deposit] (GHS).",
            "- Use [HANDOFF] if they need a human to change/cancel."
          ]
            .filter(Boolean)
            .join("\n")
        : null;
    prompt = [
      effectiveInstance !== instance
        ? `You are the WhatsApp assistant for ${client?.display_name || effectiveInstance} on the shared JAB platform line. Speak as this business only — do not mention JAB Digital Hub unless the customer asks about the platform.`
        : null,
      customPersona ||
        (agentType === "pa"
          ? "Reply as this client's WhatsApp personal assistant."
          : agentType === "customer_service"
            ? "Reply as this client's WhatsApp customer service agent."
            : agentType === "booking"
              ? "Reply as this client's WhatsApp booking assistant."
              : "Reply as the client's WhatsApp sales assistant."),
      "CRITICAL: Prior messages in this same WhatsApp chat are already in your session. Continue that conversation — never act like a new chat.",
      "Do not re-introduce yourself. Do not ask 'how can I help you today' if you already know what they want from earlier turns.",
      useRecruitmentMode
        ? "Write ONLY the WhatsApp message a human agent would type. No markdown. No preamble. Allowed hidden tokens only when needed: [HANDOFF], [SEND_PHOTO:id], [PAYMENT_LINK:], [BOOKING_CONFIRM:...], [CUSTOMER_PAY:...]."
        : "Output ONLY the WhatsApp reply text (plus allowed tokens [SEND_PHOTO:id], [YANGO_FEE:location], [PAYMENT_LINK:packageId], [CUSTOMER_PAY:amount=..;purpose=..], [BOOKING_CONFIRM:...], [HANDOFF] when needed).",
      "If the business owner asks to buy/top up messaging points, include [PAYMENT_LINK:] or [PAYMENT_LINK:packageId].",
      "For customer deposits/fees (not agency points), use [CUSTOMER_PAY:amount=GHS;purpose=...].",
      useRecruitmentMode
        ? "Style: 1–3 short WhatsApp lines. Sound human. No bullet lists unless they explicitly ask for a list."
        : "Rules: keep replies concise and human. No tools. No markdown. No preamble.",
      "General handoff rule: if the customer clearly asks for a human, end your reply with the exact token [HANDOFF] (customers should not notice this token).",
      "On handoff, send the customer ONLY a short human line (1–2 sentences). NEVER include internal briefing lines like Customer:/Intent:/Discussed so far: in the WhatsApp reply — those go to the team separately.",
      "If a knowledge base is provided below, use it for facts. Do not invent policies or prices outside it/catalog/deals.",
      "These features (knowledge, bookings, payment links, handoff) apply ONLY to this WhatsApp instance — never mix another client's data.",
      recruitmentRules,
      storeSalesRules,
      serviceChatRules,
      bookingRules,
      knowledge || null,
      dealsBoard || null,
      !useRecruitmentMode ? catalog || null : null,
      `From: ${pushName} (${number})`,
      `Message: ${inboundText}`
    ]
      .filter(Boolean)
      .join("\n");
  }

  try {
    const rawReply = await runOpenClawAgent({
      prompt,
      sessionKey,
      timeoutSec: isAgencySalesFlow ? 45 : 30
    });
    const { text: afterHandoff, aiHandoff } = stripHandoffMarker(rawReply);
    let working = afterHandoff;
    working = await resolveYangoFeePlaceholders(working, client);
    working = await resolvePaymentLinkPlaceholders(working, {
      store,
      instance: effectiveInstance,
      evoApiUrl,
      isAgency: isAgencySalesFlow,
      prospectPhone: number,
      prospectName: pushName
    });
    working = await resolveCustomerPayPlaceholders(working, {
      store,
      instance: effectiveInstance,
      number,
      client
    });
    const contactRow = store ? getContactByPhone(store.db, effectiveInstance, number) : null;
    working = resolveBookingConfirmPlaceholders(working, {
      store,
      instance: effectiveInstance,
      number,
      contactId: contactRow?.id || null
    });
    let { text: reply, refs: photoRefs } = extractSendPhotoRefs(working);
    if (store && !isAgencySalesFlow) {
      photoRefs = maybeAutoPhotoRefs({
        store,
        instance: effectiveInstance,
        inboundText,
        existingRefs: photoRefs
      });
    } else if (isAgencySalesFlow) {
      photoRefs = [];
    }
    const willHandoff = Boolean((keywordHit || aiHandoff) && store);
    if (willHandoff) {
      reply = customerHandoffReply(reply, { isAgency: isAgencySalesFlow });
    }
    if (platformWelcomeText && reply) {
      reply = `${platformWelcomeText}\n\n${reply}`;
    }
    await typing.stop();

    let photosSent = [];
    const walletAfter = store && !isAgencySalesFlow ? ensureWallet(store.db, effectiveInstance) : null;
    const imageCost = store && !isAgencySalesFlow ? pointsForRate(store.db, "ai_image") : 0;
    const textCostNow = store && !isAgencySalesFlow ? pointsForRate(store.db, "ai_text") : 0;
    const needForPhotos =
      imageCost + (reply ? textCostNow : 0);
    const canAffordImages =
      !store ||
      isAgencySalesFlow ||
      !photoRefs.length ||
      imageCost <= 0 ||
      (walletAfter.balance_points || 0) >= needForPhotos;

    if (store && !isAgencySalesFlow && photoRefs.length && canAffordImages) {
      photosSent = await sendProductPhotos({
        store,
        instance: effectiveInstance,
        waInstance: instance,
        evoApiUrl,
        apiKey,
        number: replyJid,
        refs: photoRefs
      });
    } else if (photoRefs.length && !canAffordImages) {
      reply = reply
        ? `${reply}\n(Photos skipped — messaging credits low.)`
        : "Photos skipped — messaging credits low.";
    }

    if (reply) {
      await sendEvolutionText({
        evoApiUrl,
        apiKey,
        instance,
        number: replyJid,
        text: reply,
        category: "reply",
        isAgency: isPhysicalAgency
      });
      await recordOutbound({ instance: effectiveInstance, number });
      if (store) {
        try {
          addConversationMessage(store.db, {
            instanceName: effectiveInstance,
            phone: number,
            contactId: contactRow?.id || null,
            direction: "out",
            role: "assistant",
            body: reply
          });
        } catch {
          /* ignore */
        }
      }
    } else if (photosSent.some((p) => p.ok)) {
      await recordOutbound({ instance: effectiveInstance, number });
    }

    if (store && !isAgencySalesFlow && (reply || photosSent.some((p) => p.ok))) {
      try {
        debitAiUsage(store, effectiveInstance, {
          hasText: Boolean(reply),
          hasImage: photosSent.some((p) => p.ok)
        });
        maybeNotifyLowBalance(store.db, {
          instanceName: effectiveInstance,
          evoApiUrl,
          resolveToken: resolveInstanceToken,
          publicBase: HUB_PUBLIC_URL
        }).catch(() => {});
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), debitError: error.message }));
      }
    }

    if (store && isAgencySalesFlow && contactRow) {
      try {
        await refreshAgencyProspectScore({
          store,
          instance: effectiveInstance,
          contact: contactRow,
          inboundText,
          evoApiUrl,
          apiKey
        });
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), agencyScoreError: error.message }));
      }
    }

    if (store && !isAgencySalesFlow && contactRow) {
      try {
        await refreshClientProspectScore({
          store,
          instance: effectiveInstance,
          contact: contactRow,
          inboundText,
          evoApiUrl,
          apiKey
        });
      } catch (error) {
        console.error(JSON.stringify({ at: new Date().toISOString(), clientScoreError: error.message }));
      }
    }

    let handoff = null;
    if (willHandoff) {
      const contact = getContactByPhone(store.db, effectiveInstance, number);
      if (contact) {
        const briefing = await buildHandoffBriefing({
          sessionKey,
          pushName,
          number,
          inboundText,
          aiReply: reply
        });
        handoff = await runHandoffForContact({
          store,
          instance: effectiveInstance,
          contact,
          reason: keywordHit ? `keyword:${keywordHit}` : "ai",
          summary: briefing,
          lastCustomerMessage: inboundText,
          evoApiUrl,
          apiKey,
          isAgency: isAgencySalesFlow
        });
      }
    }

    return {
      sent: Boolean(reply) || photosSent.some((p) => p.ok),
      number,
      replyJid,
      instance: effectiveInstance,
      waInstance: instance,
      platformTenant: effectiveInstance !== instance ? effectiveInstance : null,
      reply,
      photos: photosSent,
      latencyMs: Date.now() - startedAt,
      handoff: handoff
        ? {
            mode: handoff.mode,
            leadId: handoff.lead?.id,
            agentId: handoff.agent?.id || null,
            noAgents: Boolean(handoff.noAgents),
            alreadyOpen: Boolean(handoff.alreadyOpen)
          }
        : null
    };
  } catch (error) {
    await typing.stop();
    throw error;
  }
}

function readRawBody(req, maxBytes = 262144) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        req.destroy(new Error("Body too large"));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readJsonBody(req) {
  return readRawBody(req).then((body) => (body.length ? JSON.parse(body.toString("utf8")) : {}));
}

function isAuthorized(req, hookToken, globalKey, payload = null) {
  const auth = req.headers.authorization || "";
  if (hookToken && auth === `Bearer ${hookToken}`) return true;

  const apiKeyHeader = req.headers.apikey || req.headers["x-api-key"] || "";
  if (globalKey && apiKeyHeader === globalKey) return true;

  const bodyKey = String(payload?.apikey || payload?.apiKey || "").trim();
  if (globalKey && bodyKey === globalKey) return true;

  if (isProductionBridge() && process.env.JAB_BRIDGE_TRUST_LOCAL !== "1") {
    return false;
  }

  const remote = req.socket?.remoteAddress || "";
  return (
    remote === "127.0.0.1" ||
    remote === "::1" ||
    remote === "::ffff:127.0.0.1" ||
    remote.startsWith("172.") ||
    remote.startsWith("::ffff:172.")
  );
}

function resolveBridgeMetaVerifyToken() {
  const token = resolveMetaWebhookVerifyToken();
  if (token) return token;
  if (isProductionBridge()) return "";
  return "evolution";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    const meta = await checkMetaToken().catch((error) => ({ ok: false, error: error.message }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "jab-hub-bridge",
        uptimeSec: Math.round(process.uptime()),
        meta: meta.ok
          ? { ok: true, phone: meta.phone, quality: meta.quality }
          : { ok: false, error: meta.error, code: meta.code || null }
      })
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sync") {
    try {
      const { hookToken, globalKey } = await getEvolutionBootstrap();
      if (!isAuthorized(req, hookToken, globalKey)) {
        res.writeHead(401).end("unauthorized");
        return;
      }
      const result = await syncAllInstanceWebhooks();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (url.pathname === "/webhook/meta") {
    const verifyToken = resolveBridgeMetaVerifyToken();

    if (req.method === "GET") {
      if (!verifyToken) {
        res.writeHead(503).end("verify token not configured");
        return;
      }
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === verifyToken && challenge) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(challenge);
        return;
      }
      res.writeHead(403).end("forbidden");
      return;
    }

    if (req.method === "POST") {
      try {
        const rawBody = await readRawBody(req);
        const appSecret = String(process.env.META_APP_SECRET || process.env.META_WABA_APP_SECRET || "")
          .replace(/^\uFEFF/, "")
          .trim();
        const requireSignature =
          appSecret &&
          String(process.env.JAB_META_DIRECT_WEBHOOK || "").trim() === "1";
        if (requireSignature) {
          const signature = req.headers["x-hub-signature-256"];
          if (!verifyMetaWebhookSignature(rawBody, signature)) {
            console.error(
              JSON.stringify({
                at: new Date().toISOString(),
                metaWebhookRejected: "invalid_signature",
                hasSignature: Boolean(signature),
                hint: "Route Meta webhooks to Evolution :8080 or set matching META_APP_SECRET + JAB_META_DIRECT_WEBHOOK=1"
              })
            );
            res.writeHead(401).end("invalid signature");
            return;
          }
        } else if (appSecret && isProductionBridge()) {
          const signature = req.headers["x-hub-signature-256"];
          if (signature && !verifyMetaWebhookSignature(rawBody, signature)) {
            console.error(
              JSON.stringify({
                at: new Date().toISOString(),
                metaWebhookWarning: "signature_mismatch",
                note: "Processed anyway — primary path is Evolution :8080/webhook/meta"
              })
            );
          }
        } else if (isProductionBridge()) {
          console.error(
            JSON.stringify({
              at: new Date().toISOString(),
              metaWebhookWarning: "META_APP_SECRET unset — webhook POST signature not verified"
            })
          );
        }
        const payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        handleMetaWebhook(payload)
          .then((result) =>
            console.log(JSON.stringify({ at: new Date().toISOString(), metaWebhook: result }))
          )
          .catch((error) =>
            console.error(JSON.stringify({ at: new Date().toISOString(), metaWebhookError: error.message }))
          );
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }

    res.writeHead(405).end("method not allowed");
    return;
  }

  if (req.method !== "POST" || url.pathname !== "/evolution") {
    res.writeHead(404).end("not found");
    return;
  }

  try {
    const { hookToken, globalKey } = await getEvolutionBootstrap();
    const rawBody = await readRawBody(req);
    const payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
    if (!isAuthorized(req, hookToken, globalKey, payload)) {
      res.writeHead(401).end("unauthorized");
      return;
    }

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, accepted: true }));

    handleEvolutionPayload(payload)
      .then((result) => console.log(JSON.stringify({ at: new Date().toISOString(), result })))
      .catch((error) => console.error(JSON.stringify({ at: new Date().toISOString(), error: error.message })));
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

async function importLeadsIntoHub() {
  const store = hubStore();
  if (!store) return { skipped: true };
  const leads = await readLeads();
  let count = 0;
  for (const lead of Object.values(leads)) {
    if (!lead?.instance || !lead?.number) continue;
    upsertClient(store.db, { instanceName: lead.instance });
    upsertContact(store.db, {
      instanceName: lead.instance,
      phone: lead.number,
      pushName: lead.pushName || null,
      lastInboundAt: lead.lastInboundAt || null,
      lastOutboundAt: lead.lastOutboundAt || null,
      lastInboundText: lead.lastInboundText || null
    });
    count += 1;
  }
  return { imported: count };
}

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`JAB Hub Evolution/OpenClaw bridge listening on http://0.0.0.0:${PORT}/evolution`);
  console.log(`Auto-sync every ${SYNC_MS}ms for new Evolution instances`);
  try {
    await applyHubEnvToProcess();
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), hubEnvError: error.message }));
  }
  try {
    await syncAllInstanceWebhooks();
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), startupSyncError: error.message }));
  }
  try {
    const imported = await importLeadsIntoHub();
    console.log(JSON.stringify({ at: new Date().toISOString(), hubContactImport: imported }));
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), hubContactImportError: error.message }));
  }
  setInterval(() => {
    syncAllInstanceWebhooks().catch((error) => {
      console.error(JSON.stringify({ at: new Date().toISOString(), syncError: error.message }));
    });
  }, SYNC_MS);

  console.log(`Follow-up sweep every ${FOLLOWUP_TICK_MS}ms for clients quiet >= ${FOLLOWUP_HOURS}h`);
  console.log(
    JSON.stringify({
      waGuard: {
        agencyOutboundPaused: isAgencyOutboundPaused(),
        agencyFollowups: agencyAutoFollowupsEnabled(),
        agencyTyping: agencyTypingEnabled(),
        hubTyping: hubTypingEnabled(),
        telegramOps: telegramOpsConfigured(),
        metaDirect: metaDirectConfigured()
      }
    })
  );
  try {
    const { evoApiUrl, globalKey } = await getEvolutionBootstrap();
    const store = hubStore();
    const agency = store ? resolveAgencyInstanceName(store.db) : null;
    if (agency && evoApiUrl && globalKey) {
      const apiKey = await resolveInstanceToken(agency);
      const meta = await getEvolutionInstanceIntegration(evoApiUrl, apiKey, agency);
      if (meta) {
        console.log(JSON.stringify({ agencyWhatsApp: meta }));
      }
    }
  } catch {
    /* ignore startup meta probe */
  }

  const META_HEALTH_MS = Number(process.env.JAB_META_HEALTH_MS || 900_000);
  setInterval(() => {
    checkMetaToken()
      .then((meta) => {
        if (!meta.ok) {
          console.error(JSON.stringify({ at: new Date().toISOString(), metaTokenUnhealthy: meta }));
        }
      })
      .catch((error) => {
        console.error(JSON.stringify({ at: new Date().toISOString(), metaHealthCheckError: error.message }));
      });
  }, META_HEALTH_MS);

  setInterval(() => {
    runFollowUpSweep().catch((error) => {
      console.error(JSON.stringify({ at: new Date().toISOString(), followUpSweepError: error.message }));
    });
  }, FOLLOWUP_TICK_MS);

  setInterval(() => {
    processAgentFeatureJobs().catch((error) => {
      console.error(JSON.stringify({ at: new Date().toISOString(), featureJobsError: error.message }));
    });
  }, Math.max(30_000, Number(process.env.JAB_HUB_FEATURE_JOBS_MS || 60_000)));
});

async function processAgentFeatureJobs() {
  const store = hubStore();
  if (!store) return;
  ensureOwnerDigestJobs(store.db);
  const jobs = claimDueFollowUpJobs(store.db, {
    limit: 5,
    kinds: ["booking_reminder", "owner_digest"]
  });
  if (!jobs.length) return;
  const { evoApiUrl } = await getEvolutionBootstrap();
  for (const job of jobs) {
    try {
      if (job.kind === "booking_reminder") {
        const text = `Reminder: you have an upcoming booking. Reply here if you need to reschedule.`;
        const apiKey = await resolveInstanceToken(job.instance_name);
        await sendEvolutionText({
          evoApiUrl,
          apiKey,
          instance: job.instance_name,
          number: job.phone,
          text
        });
        completeFollowUpJob(store.db, job.id, { status: "done" });
        continue;
      }
      if (job.kind === "owner_digest") {
        const text = buildOwnerDigestText(store.db, job.instance_name);
        const apiKey = await resolveInstanceToken(job.instance_name);
        await sendEvolutionText({
          evoApiUrl,
          apiKey,
          instance: job.instance_name,
          number: job.phone,
          text
        });
        completeFollowUpJob(store.db, job.id, { status: "done" });
        continue;
      }
      completeFollowUpJob(store.db, job.id, { status: "cancelled", error: "unsupported_kind" });
    } catch (error) {
      completeFollowUpJob(store.db, job.id, { status: "failed", error: error.message });
    }
  }
}
