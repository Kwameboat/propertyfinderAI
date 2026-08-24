/**
 * Meta WhatsApp Cloud API helpers + Evolution instance integration detection.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function metaDirectConfigured() {
  return Boolean(
    String(process.env.META_WABA_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || "").trim() &&
      String(process.env.META_WABA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim()
  );
}

export function metaWebhookVerifyToken() {
  return String(process.env.META_WABA_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "").trim();
}

export function resolveMetaWebhookVerifyToken() {
  return String(
    process.env.WA_BUSINESS_TOKEN_WEBHOOK ||
      process.env.META_WABA_VERIFY_TOKEN ||
      metaWebhookVerifyToken() ||
      ""
  ).trim();
}

export function resolveMetaAppSecret() {
  return String(process.env.META_APP_SECRET || process.env.META_WABA_APP_SECRET || "")
    .replace(/^\uFEFF/, "")
    .trim();
}

/** Verify Meta webhook POST signature (X-Hub-Signature-256). Requires META_APP_SECRET. */
export function verifyMetaWebhookSignature(rawBody, signatureHeader) {
  const secret = resolveMetaAppSecret();
  if (!secret || !signatureHeader) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signatureHeader));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function resolveMetaAccessToken() {
  return String(process.env.META_WABA_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
}

export function resolveMetaPhoneNumberId() {
  return String(process.env.META_WABA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
}

/** Cloud API credentials for a specific Evolution instance (Dar vs agency). */
export function resolveMetaCloudCredentialsForInstance(instanceName) {
  const name = String(instanceName || "").trim();
  const reInst = String(process.env.JAB_RE_WA_INSTANCE || "").trim();
  if (reInst && name === reInst) {
    return {
      accessToken: String(process.env.JAB_RE_META_ACCESS_TOKEN || "").trim(),
      phoneNumberId: String(process.env.JAB_RE_META_PHONE_NUMBER_ID || "").trim()
    };
  }
  return {
    accessToken: resolveMetaAccessToken(),
    phoneNumberId: resolveMetaPhoneNumberId()
  };
}

export function resolveInstanceForMetaPhoneNumberId(phoneNumberId, fallbackAgency = "") {
  const pnid = String(phoneNumberId || "").trim();
  const rePn = String(process.env.JAB_RE_META_PHONE_NUMBER_ID || "").trim();
  const reInst = String(process.env.JAB_RE_WA_INSTANCE || "").trim();
  if (pnid && rePn && reInst && pnid === rePn) return reInst;
  const agencyPn = resolveMetaPhoneNumberId();
  if (pnid && agencyPn && pnid === agencyPn) return fallbackAgency;
  if (!pnid) return fallbackAgency;
  return "";
}

/** Fetch Evolution instance row and return integration type (WHATSAPP-BAILEYS vs WHATSAPP-BUSINESS). */
export async function getEvolutionInstanceIntegration(evoApiUrl, apiKey, instanceName) {
  if (!evoApiUrl || !apiKey || !instanceName) return null;
  try {
    const response = await fetch(`${evoApiUrl}/instance/fetchInstances`, {
      headers: { apikey: apiKey }
    });
    if (!response.ok) return null;
    const rows = await response.json();
    const row = (Array.isArray(rows) ? rows : []).find(
      (r) => String(r.name || "") === String(instanceName)
    );
    if (!row) return null;
    return {
      name: row.name,
      integration: String(row.integration || "WHATSAPP-BAILEYS"),
      connectionStatus: row.connectionStatus || row.state || "unknown",
      isCloudApi: String(row.integration || "").toUpperCase().includes("BUSINESS"),
      number: row.number || row.ownerJid || null
    };
  } catch {
    return null;
  }
}

export function isCloudApiIntegration(integrationInfo) {
  if (!integrationInfo) return metaDirectConfigured();
  return Boolean(integrationInfo.isCloudApi);
}

/** Send text via Meta Graph API (direct — optional bypass of Evolution). */
export async function sendMetaCloudText({ to, text, phoneNumberId, accessToken }) {
  const token = accessToken || resolveMetaAccessToken();
  const pnid = phoneNumberId || resolveMetaPhoneNumberId();
  const digits = String(to || "").replace(/\D/g, "");
  if (!token || !pnid || !digits) {
    throw new Error("meta_cloud_not_configured");
  }
  const response = await fetch(`https://graph.facebook.com/v21.0/${pnid}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits,
      type: "text",
      text: { body: String(text || "").slice(0, 4096) }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`meta_send_failed ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

/** Parse Meta webhook inbound (messages entry). Returns normalized inbound or null. */
export function parseMetaWebhookInbound(payload) {
  const list = listMetaWebhookInboundMessages(payload);
  return list[0] || null;
}

/** All inbound text messages from a Meta webhook POST body. */
export function listMetaWebhookInboundMessages(payload) {
  const out = [];
  if (payload?.object !== "whatsapp_business_account") return out;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const value = change.value || {};
      for (const msg of value.messages || []) {
        if (msg.type !== "text") continue;
        const from = String(msg.from || "").replace(/\D/g, "");
        const text = msg.text?.body || "";
        if (!from || !text) continue;
        out.push({
          from,
          text,
          messageId: msg.id,
          phoneNumberId: value.metadata?.phone_number_id,
          displayName: value.contacts?.[0]?.profile?.name || ""
        });
      }
    }
  }
  return out;
}
