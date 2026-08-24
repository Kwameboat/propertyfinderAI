#!/usr/bin/env node
/**
 * Keeps WhatsApp agency automation alive:
 * - checks bridge, public webhook, Meta token
 * - restarts cloudflared + bridge when webhook/bridge fail
 * - Telegram alert (cooldown) when manual action needed
 *
 * Run via systemd timer every 2 minutes on VPS.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runPipelineHealthCheck,
  maybeAlertOps,
  checkBridgeHealth,
  checkPublicWebhook,
  checkMetaToken
} from "../packages/pipeline-health.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Load .env when run manually
try {
  const { readFileSync } = await import("node:fs");
  const envPath = path.join(REPO_ROOT, ".env");
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {
  /* systemd EnvironmentFile */
}

async function systemctl(action, unit) {
  try {
    await execFileAsync("systemctl", [action, unit], { timeout: 30_000 });
    return true;
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), systemctlError: error.message, action, unit }));
    return false;
  }
}

async function repairTunnelAndBridge() {
  const actions = [];
  actions.push(await systemctl("restart", "cloudflared") ? "cloudflared_restarted" : "cloudflared_restart_failed");
  await new Promise((r) => setTimeout(r, 5000));
  actions.push(await systemctl("restart", "jab-hub-bridge") ? "bridge_restarted" : "bridge_restart_failed");
  await new Promise((r) => setTimeout(r, 4000));
  return actions;
}

async function main() {
  let health = await runPipelineHealthCheck({ alert: true });
  let repaired = [];

  if (!health.bridge.ok) {
    repaired.push(await systemctl("restart", "jab-hub-bridge") ? "bridge_restarted" : "bridge_restart_failed");
    await new Promise((r) => setTimeout(r, 4000));
    health = await runPipelineHealthCheck({ alert: false });
  }

  if (!health.webhook.ok) {
    repaired.push(...(await repairTunnelAndBridge()));
    health = await runPipelineHealthCheck({ alert: false });
    if (!health.webhook.ok || !health.bridge.ok) {
      await maybeAlertOps(
        "repair_failed",
        "🚨 JAB WhatsApp auto-repair failed\nBridge or webhook still down after restart.\nCheck: journalctl -u jab-hub-bridge -u cloudflared -n 40"
      );
    }
  }

  if (!health.meta.ok) {
    await maybeAlertOps(
      "meta_token",
      `🚨 Meta WhatsApp token invalid\n${health.meta.error || "unknown"}\nUpdate META_WABA_ACCESS_TOKEN in /opt/jab-hub/.env and restart jab-hub-bridge.`
    );
  }

  if (health.ok) {
    console.log(JSON.stringify({ at: health.at, pipelineWatchdog: "healthy", repaired }));
  } else {
    console.error(JSON.stringify({ at: health.at, pipelineWatchdog: "unhealthy", health, repaired }));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ at: new Date().toISOString(), pipelineWatchdogError: error.message }));
  process.exit(1);
});
