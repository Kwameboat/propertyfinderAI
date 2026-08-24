/**
 * WhatsApp pipeline health checks — bridge, webhook tunnel, Meta token.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveMetaAccessToken, resolveMetaPhoneNumberId } from "./meta-cloud.mjs";
import { sendTelegramOpsMessage, telegramOpsConfigured } from "./telegram-notify.mjs";

const DEFAULT_WEBHOOK_HOST = "https://wa.jabdigitalhub.com/webhook/meta";
const STATE_DIR = process.env.JAB_HUB_DATA_DIR || path.join(process.env.HOME || "", ".openclaw", "jab-hub");
const STATE_PATH = path.join(STATE_DIR, "pipeline-watchdog-state.json");
const ALERT_COOLDOWN_MS = Number(process.env.JAB_PIPELINE_ALERT_COOLDOWN_MS || 900_000);

export function resolveWebhookVerifyToken() {
  return String(
    process.env.WA_BUSINESS_TOKEN_WEBHOOK ||
      process.env.META_WABA_VERIFY_TOKEN ||
      process.env.WHATSAPP_VERIFY_TOKEN ||
      "evolution"
  ).trim();
}

export function resolvePublicWebhookUrl() {
  const base = String(process.env.JAB_META_WEBHOOK_URL || DEFAULT_WEBHOOK_HOST).replace(/\/$/, "");
  return base;
}

export async function checkBridgeHealth(bridgeUrl = "http://127.0.0.1:8787/health") {
  try {
    const response = await fetch(bridgeUrl, { signal: AbortSignal.timeout(8000) });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body?.ok !== false, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

export async function checkPublicWebhook({
  url = resolvePublicWebhookUrl(),
  verifyToken = resolveWebhookVerifyToken()
} = {}) {
  const challenge = `health-${Date.now()}`;
  const probe = `${url}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${encodeURIComponent(challenge)}`;
  try {
    const response = await fetch(probe, { signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    return {
      ok: response.status === 200 && text.trim() === challenge,
      status: response.status,
      body: text.slice(0, 120)
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

export async function checkMetaToken({
  token = resolveMetaAccessToken(),
  phoneNumberId = resolveMetaPhoneNumberId()
} = {}) {
  if (!token || !phoneNumberId) {
    return { ok: false, error: "meta_not_configured" };
  }
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) {
      return {
        ok: false,
        status: response.status,
        error: body?.error?.message || `HTTP ${response.status}`,
        code: body?.error?.code
      };
    }
    return {
      ok: true,
      status: response.status,
      phone: body.display_phone_number,
      quality: body.quality_rating
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function readAlertState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { alerts: {} };
  }
}

async function writeAlertState(state) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function maybeAlertOps(key, message) {
  if (!telegramOpsConfigured()) return { sent: 0, skipped: "telegram_not_configured" };
  const state = await readAlertState();
  const now = Date.now();
  const last = Number(state.alerts?.[key] || 0);
  if (now - last < ALERT_COOLDOWN_MS) return { sent: 0, skipped: "cooldown", key };
  state.alerts = state.alerts || {};
  state.alerts[key] = now;
  await writeAlertState(state);
  try {
    return await sendTelegramOpsMessage(message);
  } catch (error) {
    return { sent: 0, error: error.message };
  }
}

export async function runPipelineHealthCheck({
  bridgeUrl = "http://127.0.0.1:8787/health",
  webhookUrl = resolvePublicWebhookUrl(),
  verifyToken = resolveWebhookVerifyToken(),
  alert = true
} = {}) {
  const [bridge, webhook, meta] = await Promise.all([
    checkBridgeHealth(bridgeUrl),
    checkPublicWebhook({ url: webhookUrl, verifyToken }),
    checkMetaToken()
  ]);

  const result = {
    at: new Date().toISOString(),
    bridge,
    webhook,
    meta,
    ok: bridge.ok && webhook.ok && meta.ok
  };

  if (alert && !result.ok) {
    const lines = ["🚨 JAB WhatsApp pipeline unhealthy"];
    if (!bridge.ok) lines.push(`• Bridge: ${bridge.error || bridge.status || "down"}`);
    if (!webhook.ok) lines.push(`• Public webhook: HTTP ${webhook.status || 0} ${webhook.error || webhook.body || ""}`.trim());
    if (!meta.ok) lines.push(`• Meta token: ${meta.error || "invalid"} (refresh META_WABA_ACCESS_TOKEN)`);
    lines.push("", "Watchdog will attempt auto-repair for bridge/tunnel.");
    result.alert = await maybeAlertOps("pipeline_unhealthy", lines.join("\n"));
  }

  return result;
}
