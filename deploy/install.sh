#!/usr/bin/env bash
# JAB Hub 24/7 VPS installer (Ubuntu 22.04 / 24.04)
# Run as root:  sudo bash deploy/install.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${JAB_HUB_APP_DIR:-/opt/jab-hub}"
DATA_DIR="${JAB_HUB_DATA_DIR:-/var/lib/jab-hub}"
APP_USER="${JAB_HUB_USER:-jabhub}"
VPS_IP="${VPS_IP:-}"

log() { echo "[jab-hub-install] $*"; }
die() { echo "[jab-hub-install] ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo bash deploy/install.sh)"

if [[ -z "$VPS_IP" ]]; then
  VPS_IP="$(curl -4 -fsS --max-time 5 ifconfig.me 2>/dev/null || true)"
fi
[[ -n "$VPS_IP" ]] || die "Could not detect public IP. Re-run with: VPS_IP=x.x.x.x sudo -E bash deploy/install.sh"
log "Using public IP: $VPS_IP"

export DEBIAN_FRONTEND=noninteractive
log "Installing base packages…"
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw openssl git rsync

# Docker
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker…"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi

# Node 22
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  log "Installing Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
log "Node $(node -v) / npm $(npm -v)"

# App user
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Creating user $APP_USER…"
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi
usermod -aG docker "$APP_USER" || true

# Sync app into /opt/jab-hub
log "Installing app to $APP_DIR…"
mkdir -p "$APP_DIR" "$DATA_DIR"
if [[ "$REPO_ROOT" != "$APP_DIR" ]]; then
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.env' \
    "$REPO_ROOT"/ "$APP_DIR"/
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

# .env
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Creating .env from production example…"
  cp "$APP_DIR/deploy/.env.production.example" "$ENV_FILE"
  API_KEY="$(openssl rand -hex 32)"
  DB_PASS="$(openssl rand -hex 24)"
  HUB_PASS="$(openssl rand -hex 16)"
  N8N_PASS="$(openssl rand -hex 16)"
  N8N_KEY="$(openssl rand -hex 32)"
  sed -i "s|YOUR_VPS_IP|$VPS_IP|g" "$ENV_FILE"
  sed -i "s|CHANGE_ME_TO_A_LONG_RANDOM_KEY|$API_KEY|g" "$ENV_FILE"
  sed -i "s|CHANGE_ME_DB_PASSWORD|$DB_PASS|g" "$ENV_FILE"
  sed -i "s|CHANGE_ME_HUB_PASSWORD|$HUB_PASS|g" "$ENV_FILE"
  sed -i "s|CHANGE_ME_N8N_PASSWORD|$N8N_PASS|g" "$ENV_FILE"
  sed -i "s|CHANGE_ME_N8N_ENCRYPTION_KEY|$N8N_KEY|g" "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "Wrote secrets to $ENV_FILE (Hub password printed once below)"
  echo "======== SAVE THESE ========"
  echo "VPS_IP=$VPS_IP"
  echo "AUTHENTICATION_API_KEY=$API_KEY"
  echo "HUB_ADMIN_PASSWORD=$HUB_PASS"
  echo "N8N_BASIC_AUTH_USER=admin"
  echo "N8N_BASIC_AUTH_PASSWORD=$N8N_PASS"
  echo "Evolution Manager: http://$VPS_IP:8080/manager"
  echo "Agency Hub:        http://$VPS_IP:3000"
  echo "n8n:               http://$VPS_IP:5678"
  echo "============================"
else
  log ".env already exists — leaving it unchanged"
fi

# Hub npm deps
log "Installing Hub npm dependencies…"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/apps/hub' && npm install --omit=dev"

# OpenClaw CLI (per-user prefix so systemd PATH is predictable)
log "Installing OpenClaw CLI for $APP_USER…"
sudo -u "$APP_USER" bash -lc '
  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global"
  npm install -g openclaw@latest
' || log "WARN: openclaw global install failed — install manually as $APP_USER"

# Firewall
log "Configuring UFW…"
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 8080/tcp >/dev/null 2>&1 || true
ufw allow 3000/tcp >/dev/null 2>&1 || true
ufw allow 5678/tcp >/dev/null 2>&1 || true
# Bridge only needs host access from Docker; keep closed from internet if possible
# ufw allow 8787/tcp  # intentionally NOT opened publicly
ufw --force enable >/dev/null 2>&1 || true

# systemd units
log "Installing systemd units…"
cp "$APP_DIR/deploy/jab-hub-bridge.service" /etc/systemd/system/
cp "$APP_DIR/deploy/jab-hub-dashboard.service" /etc/systemd/system/
cp "$APP_DIR/deploy/jab-openclaw-gateway.service" /etc/systemd/system/

OPENCLAW_BIN="$(sudo -u "$APP_USER" bash -lc 'export PATH="$HOME/.npm-global/bin:$PATH"; command -v openclaw' || true)"
if [[ -z "$OPENCLAW_BIN" && -x "/home/$APP_USER/.npm-global/bin/openclaw" ]]; then
  OPENCLAW_BIN="/home/$APP_USER/.npm-global/bin/openclaw"
fi
if [[ -n "$OPENCLAW_BIN" ]]; then
  sed -i "s|^ExecStart=.*openclaw gateway|ExecStart=$OPENCLAW_BIN gateway|" /etc/systemd/system/jab-openclaw-gateway.service
  sed -i "s|^Environment=OPENCLAW_CLI=.*|Environment=OPENCLAW_CLI=$OPENCLAW_BIN|" /etc/systemd/system/jab-hub-bridge.service
fi

systemctl daemon-reload

# Evolution
log "Starting Evolution (Docker)…"
cd "$APP_DIR"
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d

# Services
log "Enabling Hub + bridge + OpenClaw gateway…"
systemctl enable jab-openclaw-gateway.service jab-hub-dashboard.service jab-hub-bridge.service
systemctl restart jab-hub-dashboard.service
systemctl restart jab-hub-bridge.service
systemctl restart jab-openclaw-gateway.service || log "WARN: openclaw gateway failed — copy ~/.openclaw from your PC then: systemctl restart jab-openclaw-gateway"

sleep 2
systemctl --no-pager --full status jab-hub-dashboard.service || true
systemctl --no-pager --full status jab-hub-bridge.service || true

chmod +x "$APP_DIR"/deploy/*.sh

log "Done."
log "Next:"
log "  1. Copy OpenClaw config/keys to /home/$APP_USER/.openclaw/ (see deploy/DEPLOY.md)"
log "  2. systemctl restart jab-openclaw-gateway jab-hub-bridge"
log "  3. bash $APP_DIR/deploy/create-instance.sh jab-whatsapp"
log "  4. Scan QR, then bash $APP_DIR/deploy/verify.sh"
log "  5. Full guide: $APP_DIR/deploy/DEPLOY.md"
