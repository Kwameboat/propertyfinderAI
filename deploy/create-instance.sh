#!/usr/bin/env bash
# Create a Baileys WhatsApp instance on local Evolution (VPS).
# Usage: bash deploy/create-instance.sh [instance-name]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
INSTANCE="${1:-jab-whatsapp}"
INSTANCE="$(echo "$INSTANCE" | xargs)"

env_val() {
  grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r'
}

API_KEY="$(env_val AUTHENTICATION_API_KEY)"
[[ -n "$API_KEY" ]] || { echo "AUTHENTICATION_API_KEY missing in .env"; exit 1; }

EVO="${SERVER_URL_OVERRIDE:-http://127.0.0.1:8080}"

echo "Checking existing instances…"
if curl -fsS -H "apikey: $API_KEY" "$EVO/instance/fetchInstances" | grep -q "\"name\":\"$INSTANCE\""; then
  echo "Instance '$INSTANCE' already exists."
  echo "Get QR: bash deploy/get-qr.sh $INSTANCE"
  exit 0
fi

echo "Creating instance '$INSTANCE'…"
curl -fsS -X POST "$EVO/instance/create" \
  -H "apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"$INSTANCE\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}" \
  | tee /tmp/jab-hub-last-instance.json

echo ""
echo "Created. Fetch QR with: bash deploy/get-qr.sh $INSTANCE"
echo "Global webhook should already point at the bridge (WEBHOOK_GLOBAL_* in .env)."
