#!/usr/bin/env bash
# Smoke-check that 24/7 stack is up on this VPS.
# Usage: bash deploy/verify.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

env_val() {
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true
}

API_KEY="$(env_val AUTHENTICATION_API_KEY)"
PUBLIC="$(env_val SERVER_URL)"
HUB="$(env_val JAB_HUB_PUBLIC_URL)"
[[ -n "$PUBLIC" ]] || PUBLIC="http://127.0.0.1:8080"
[[ -n "$HUB" ]] || HUB="http://127.0.0.1:3000"
N8N_PORT="$(env_val N8N_PORT)"
N8N_USER="$(env_val N8N_BASIC_AUTH_USER)"
N8N_PASS="$(env_val N8N_BASIC_AUTH_PASSWORD)"
[[ -n "$N8N_PORT" ]] || N8N_PORT="5678"
[[ -n "$N8N_USER" ]] || N8N_USER="admin"
N8N_URL="http://127.0.0.1:${N8N_PORT}"

ok=0
fail=0
check() {
  local name="$1"
  shift
  if "$@"; then
    echo "OK   $name"
    ok=$((ok + 1))
  else
    echo "FAIL $name"
    fail=$((fail + 1))
  fi
}

echo "=== JAB Hub verify ==="
check "docker evolution api running" bash -c 'docker ps --format "{{.Names}}" | grep -q jabhub_evolution_api'
check "evolution HTTP :8080" bash -c "curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080 | grep -Eq '200|201|301|302|401|404'"
check "bridge /health" bash -c "curl -fsS http://127.0.0.1:8787/health | grep -q ok"
check "bridge port listening" bash -c 'ss -lnt | grep -q ":8787"'
check "hub :3000" bash -c "curl -fsS -o /dev/null '$HUB/login' || curl -fsS -o /dev/null 'http://127.0.0.1:3000/login'"
check "n8n container running" bash -c 'docker ps --format "{{.Names}}" | grep -q jabhub_n8n'
if [[ -n "$N8N_PASS" ]]; then
  check "n8n :${N8N_PORT}" bash -c "curl -fsS -u '${N8N_USER}:${N8N_PASS}' -o /dev/null '$N8N_URL/'"
else
  check "n8n :${N8N_PORT}" bash -c "curl -fsS -o /dev/null '$N8N_URL/' || curl -fsS -o /dev/null -w '%{http_code}' '$N8N_URL/' | grep -Eq '200|401'"
fi
check "systemd jab-hub-bridge" systemctl is-active --quiet jab-hub-bridge
check "systemd jab-hub-dashboard" systemctl is-active --quiet jab-hub-dashboard
check "systemd jab-openclaw-gateway" systemctl is-active --quiet jab-openclaw-gateway || true

if [[ -n "$API_KEY" ]]; then
  check "evolution fetchInstances" bash -c "curl -fsS -H 'apikey: $API_KEY' http://127.0.0.1:8080/instance/fetchInstances >/dev/null"
fi

echo ""
echo "Public URLs:"
echo "  Evolution Manager: $PUBLIC/manager"
echo "  Agency Hub:        $HUB"
echo "  n8n:               $N8N_URL"
echo ""
echo "Manual WhatsApp test:"
echo "  1. Ensure an instance is open (connectionState = open)"
echo "  2. Message the business WhatsApp from your phone"
echo "  3. journalctl -u jab-hub-bridge -f   # should show accepted + sent"
echo ""
echo "Result: $ok ok, $fail failed"
[[ "$fail" -eq 0 ]]
