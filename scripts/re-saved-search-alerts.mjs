#!/usr/bin/env node
/**
 * Send WhatsApp alerts for saved property searches (new listing matches).
 * Usage: node scripts/re-saved-search-alerts.mjs [--dry-run] [--since-hours=24]
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { openHubDb } from "../packages/hub-db/index.mjs";
import { runSavedSearchAlerts, formatAlertWhatsApp } from "../packages/real-estate/saved-search.mjs";
import { resolveReWhatsAppSendInstance } from "../packages/real-estate/re-wa.mjs";
import { isGhanaMarket } from "../packages/real-estate/market.mjs";
import { sendMetaCloudText, metaDirectConfigured } from "../packages/meta-cloud.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

async function sendWhatsAppAlert(toPhone, text) {
  const instance = resolveReWhatsAppSendInstance("");
  const evoUrl = String(process.env.EVOLUTION_API_URL || process.env.JAB_EVOLUTION_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const apiKey = String(process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || "").trim();

  if (metaDirectConfigured() && !isGhanaMarket()) {
    await sendMetaCloudText({ to: toPhone, text });
    return { via: "meta" };
  }

  if (!apiKey) throw new Error("Set META_WABA_* or EVOLUTION_API_KEY for alert delivery");

  const digits = String(toPhone).replace(/\D/g, "");
  const url = `${evoUrl}/message/sendText/${encodeURIComponent(instance)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number: digits, text: String(text).slice(0, 4096) })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution send failed ${res.status}: ${body.slice(0, 200)}`);
  }
  return { via: "evolution", instance };
}

loadEnv();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sinceArg = args.find((a) => a.startsWith("--since-hours="));
const sinceHours = sinceArg ? Number(sinceArg.split("=")[1]) : 24;

const { db, close } = openHubDb();
try {
  const alerts = await runSavedSearchAlerts(db, { sinceHours, maxPerUser: 5 });
  console.log(JSON.stringify({ ok: true, alerts: alerts.length, dryRun, sinceHours }, null, 2));

  for (const alert of alerts) {
    const text = formatAlertWhatsApp(alert);
    if (dryRun) {
      console.log(`\n--- DRY RUN → +${alert.userPhone} ---\n${text}\n`);
      continue;
    }
    try {
      const sent = await sendWhatsAppAlert(alert.userPhone, text);
      console.log(JSON.stringify({ sent: true, phone: alert.userPhone, label: alert.label, ...sent }));
    } catch (error) {
      console.error(JSON.stringify({ sent: false, phone: alert.userPhone, error: error.message }));
    }
  }
} finally {
  close?.();
}
