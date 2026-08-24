#!/usr/bin/env node
/**
 * Fail fast before bridge starts — prevents crash-loops from partial deploys.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

process.chdir(REPO_ROOT);

const modules = [
  "../packages/meta-cloud.mjs",
  "../packages/platform-router.mjs",
  "../packages/platform-slug.mjs",
  "../packages/hub-db/index.mjs",
  "../packages/client-notify.mjs",
  "../packages/whatsapp-guard.mjs",
  "../packages/pipeline-health.mjs"
];

const requiredExports = {
  "../packages/meta-cloud.mjs": [
    "resolveMetaWebhookVerifyToken",
    "verifyMetaWebhookSignature",
    "sendMetaCloudText",
    "listMetaWebhookInboundMessages"
  ]
};

let failed = false;
for (const rel of modules) {
  const spec = new URL(rel, import.meta.url).href;
  try {
    const mod = await import(spec);
    for (const name of requiredExports[rel] || []) {
      if (typeof mod[name] !== "function") {
        console.error(`PREFLIGHT FAIL: ${rel} missing export ${name}`);
        failed = true;
      }
    }
  } catch (error) {
    console.error(`PREFLIGHT FAIL: cannot import ${rel}: ${error.message}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(JSON.stringify({ at: new Date().toISOString(), bridgePreflight: "ok" }));
