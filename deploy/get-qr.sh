#!/usr/bin/env bash
# Fetch WhatsApp QR for an Evolution instance and save as PNG.
# Usage: bash deploy/get-qr.sh [instance-name]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
INSTANCE="${1:-jab-whatsapp}"
INSTANCE="$(echo "$INSTANCE" | xargs)"
OUT="${QR_OUT:-/tmp/${INSTANCE}-qr.png}"

env_val() {
  grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r'
}

API_KEY="$(env_val AUTHENTICATION_API_KEY)"
[[ -n "$API_KEY" ]] || { echo "AUTHENTICATION_API_KEY missing in .env"; exit 1; }
EVO="${SERVER_URL_OVERRIDE:-http://127.0.0.1:8080}"
PUBLIC="$(env_val SERVER_URL)"

echo "Requesting connect/QR for $INSTANCE…"

# Log out old number so a new phone can pair (same instance name).
curl -fsS -X DELETE -H "apikey: $API_KEY" "$EVO/instance/logout/${INSTANCE}" >/dev/null 2>&1 || true
sleep 2
curl -fsS -X PUT -H "apikey: $API_KEY" "$EVO/instance/restart/${INSTANCE}" >/dev/null 2>&1 \
  || curl -fsS -X POST -H "apikey: $API_KEY" "$EVO/instance/restart/${INSTANCE}" >/dev/null 2>&1 \
  || true
sleep 2

curl -fsS -H "apikey: $API_KEY" "$EVO/instance/connect/${INSTANCE}" \
  > "/tmp/${INSTANCE}-connect.json"

node <<NODE
const fs = require("fs");
const raw = fs.readFileSync("/tmp/${INSTANCE}-connect.json", "utf8");
const data = JSON.parse(raw);
const found = [];
function walk(o) {
  if (!o) return;
  if (typeof o === "string" && o.length > 80) {
    if (/^data:image\\//.test(o) || (/^[A-Za-z0-9+/=\\s]+$/.test(o) && o.replace(/\\s/g, "").length > 200)) {
      found.push(o.replace(/\\s/g, ""));
    }
    return;
  }
  if (Array.isArray(o)) return o.forEach(walk);
  if (typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      if (/base64|qrcode|qr/i.test(k) && typeof v === "string") found.unshift(v);
      else walk(v);
    }
  }
}
walk(data);
if (!found.length) {
  console.error("No QR in connect response.");
  console.error("Open Evolution Manager:", "${PUBLIC}" + "/manager");
  process.exit(1);
}
let b = found[0];
if (b.startsWith("data:image")) b = b.split(",")[1];
fs.writeFileSync("${OUT}", Buffer.from(b, "base64"));
console.log("QR saved:", "${OUT}");
console.log("Copy to your PC:  scp USER@VPS:" + "${OUT}" + " ./qr.png");
console.log("Phone: WhatsApp → Linked devices → Link a device");
NODE
