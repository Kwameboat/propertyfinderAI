# Deploy JAB Hub 24/7 on a VPS

Your cPanel shared hosting **cannot** run this stack. Use a small Linux VPS and its **public IP**. You can later point a subdomain DNS A-record from cPanel at that IP.

## What runs 24/7

| Piece | Port | Process |
|---|---|---|
| Evolution API (+ Manager) | `8080` | Docker Compose |
| Agency Hub | `3000` | systemd `jab-hub-dashboard` |
| n8n (automation) | `5678` | Docker Compose |
| OpenClaw bridge | `8787` (localhost / Docker host only) | systemd `jab-hub-bridge` |
| Proactive marketing (Telegram) | (outbound Telegram + WhatsApp via Evolution) | systemd `jab-hub-marketing` |
| OpenClaw gateway | (local) | systemd `jab-openclaw-gateway` |

Flow:

```text
WhatsApp → Evolution → bridge :8787 → openclaw agent → Evolution sendText/sendMedia
```

## 1. Create a VPS (DigitalOcean)

1. Log in at [DigitalOcean](https://cloud.digitalocean.com/).
2. **Create → Droplets**.
3. Choose:
   - **Region**: closest to you (e.g. London / Frankfurt / NYC)
   - **Image**: Ubuntu 24.04 LTS
   - **Size**: Basic, **Regular**, at least **2 GB RAM / 1 vCPU** ($12/mo plan). Prefer **4 GB** if you will run several WhatsApp numbers.
   - **Auth**: SSH key (recommended) or password
4. Create the Droplet and copy its **public IPv4**.

Continue below with that IP.

## 2. Copy the project to the VPS

On the Droplet (recommended — clone from GitHub):

```bash
ssh root@YOUR_DROPLET_IP
git clone https://github.com/Kwameboat/jab-hub.git
cd jab-hub
sudo VPS_IP=YOUR_DROPLET_IP bash deploy/install.sh
```

If the repo is private, use a [GitHub personal access token](https://github.com/settings/tokens) or SSH deploy key when cloning.

From your Windows PC, print ready-made scp commands instead:

```powershell
cd C:\Users\DELL\jab-hub
.\deploy\pack-for-vps.ps1 -VpsIp YOUR_DROPLET_IP -SshUser root
```

## 3. Run the installer

```bash
ssh USER@VPS_IP
cd ~/jab-hub
sudo VPS_IP=YOUR_VPS_IP bash deploy/install.sh
```

The installer:

- Installs Docker, Node 22, UFW rules (`22`, `8080`, `3000`, `5678`)
- Creates system user `jabhub`
- Copies the app to `/opt/jab-hub`
- Creates `/opt/jab-hub/.env` with strong secrets (printed once)
- Starts Evolution with [`docker-compose.prod.yml`](docker-compose.prod.yml) (Linux `host-gateway`)
- Enables systemd services for Hub, bridge, and OpenClaw gateway

**Save** the printed `AUTHENTICATION_API_KEY` and `HUB_ADMIN_PASSWORD`.

## 4. Copy OpenClaw config (model keys)

The bridge needs your OpenClaw workspace + provider keys on the VPS.

On Windows (PowerShell):

```powershell
scp -r $env:USERPROFILE\.openclaw jabhub@VPS_IP:/home/jabhub/.openclaw
```

Then on the VPS:

```bash
sudo chown -R jabhub:jabhub /home/jabhub/.openclaw
sudo systemctl restart jab-openclaw-gateway jab-hub-bridge
sudo systemctl status jab-openclaw-gateway jab-hub-bridge --no-pager
```

Do **not** commit `openclaw.json` or API keys into git.

## 5. Create WhatsApp instance + scan QR

Local WhatsApp sessions do **not** move cleanly — re-pair on the VPS.

```bash
cd /opt/jab-hub
sudo -u jabhub bash deploy/create-instance.sh jab-whatsapp
sudo -u jabhub bash deploy/get-qr.sh jab-whatsapp
```

Copy the PNG to your PC and scan it:

```powershell
scp USER@VPS_IP:/tmp/jab-whatsapp-qr.png .\qr.png
# open qr.png → WhatsApp → Linked devices → Link a device
```

Or open Evolution Manager: `http://YOUR_VPS_IP:8080/manager` (login with `AUTHENTICATION_API_KEY`).

## 6. Verify

```bash
cd /opt/jab-hub
bash deploy/verify.sh
```

Then send a WhatsApp message to the linked number and watch:

```bash
journalctl -u jab-hub-bridge -f
```

You should see an accepted webhook and a sent reply.

Hub UI: `http://YOUR_VPS_IP:3000` (password = `HUB_ADMIN_PASSWORD`).

n8n: `http://YOUR_VPS_IP:5678` (login = `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` from `.env`). See [deploy/N8N.md](N8N.md).

## 7. Leave the Windows lab off

Once replies work on the VPS:

- Stop Docker / bridge / Hub on your PC (avoid double webhooks / double replies).
- The VPS keeps Evolution + systemd services up across reboots (`restart: unless-stopped` / `Restart=always`).

## Useful commands

```bash
# Status
docker compose -f /opt/jab-hub/docker-compose.yml -f /opt/jab-hub/deploy/docker-compose.prod.yml ps
systemctl status jab-hub-bridge jab-hub-dashboard jab-openclaw-gateway

# Logs
journalctl -u jab-hub-bridge -f
journalctl -u jab-hub-dashboard -f
docker logs -f jabhub_evolution_api
docker logs -f jabhub_n8n --tail 100

# Start or update n8n only (from your PC, with VPS_PASSWORD set)
node deploy/deploy-n8n.cjs

# Restart after .env or OpenClaw changes
sudo systemctl restart jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard
cd /opt/jab-hub && docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d
```

## Data locations

| Data | Path |
|---|---|
| Hub DB + uploads | `/var/lib/jab-hub` |
| App + `.env` | `/opt/jab-hub` |
| OpenClaw sessions / keys | `/home/jabhub/.openclaw` |
| Evolution instances | Docker volume `evolution_instances` |

Back up those paths (or snapshot the VPS) weekly.

## Optional: subdomain from cPanel DNS

When IP works, in cPanel → Zone Editor:

1. Add `A` record: `agents.yourdomain.com` → `YOUR_VPS_IP`
2. Later add Caddy/Nginx TLS on the VPS and set `JAB_HUB_PUBLIC_URL=https://agents.yourdomain.com`

Not required for 24/7 operation.

## Security checklist

- [ ] Changed all `CHANGE_ME_*` secrets (installer does this for new `.env`)
- [ ] Hub password is not the lab default
- [ ] Port `8787` is **not** open on the public internet (UFW leaves it closed)
- [ ] SSH uses keys; disable password auth when comfortable
- [ ] Only trusted people know Evolution Manager API key
- [ ] `TELEGRAM_APPROVER_IDS` only includes operator user ids; keep `JAB_MARKETING_DRY_RUN=1` until ready
- [ ] Telegram bot token is never committed or pasted into Hub UI

## Proactive marketing (optional)

1. Create a bot with `@BotFather` and set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_APPROVER_IDS` in `.env`
2. Keep `JAB_MARKETING_DRY_RUN=1` while testing approvals
3. Optional: `BRAVE_SEARCH_API_KEY` for `/discover`
4. Install systemd unit:

```bash
sudo tee /etc/systemd/system/jab-hub-marketing.service >/dev/null <<'EOF'
[Unit]
Description=JAB Hub proactive marketing agent
After=network.target

[Service]
Type=simple
User=jabhub
WorkingDirectory=/opt/jab-hub
EnvironmentFile=/opt/jab-hub/.env
ExecStart=/usr/bin/node /opt/jab-hub/scripts/proactive-marketing-agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now jab-hub-marketing
```

See [OPENCLAW.md](../OPENCLAW.md) for Telegram commands.

## Agency social media agent (optional)

Separate Telegram bot (cannot share long-poll with marketing).

1. `sudo apt-get install -y ffmpeg`
2. Create bot with `@BotFather` → set `TELEGRAM_SOCIAL_BOT_TOKEN` + `TELEGRAM_SOCIAL_APPROVER_IDS`
3. Set `JAB_HUB_PUBLIC_URL=http://YOUR_VPS_IP:3000` and optionally `JAB_SOCIAL_PUBLIC_MEDIA_BASE=http://YOUR_VPS_IP:3000/media/social` (needed for Instagram)
4. Keep `JAB_SOCIAL_DRY_RUN=1` until tokens are connected in Hub → Social
5. Paste platform tokens in Hub Social tab (or `.env`)
6. Install systemd:

```bash
sudo tee /etc/systemd/system/jab-hub-social.service >/dev/null <<'EOF'
[Unit]
Description=JAB Hub social media agent
After=network.target

[Service]
Type=simple
User=jabhub
WorkingDirectory=/opt/jab-hub
EnvironmentFile=/opt/jab-hub/.env
ExecStart=/usr/bin/node /opt/jab-hub/scripts/proactive-social-agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now jab-hub-social
```

Telegram: describe a post naturally, or `/draft …` → Approve card → posts to connected platforms.

## Personal PA agent (optional)

Your private 24/7 Telegram assistant — chat, web search, document RAG (sermons/notes), memory, reminders, preaching companion, daily brief.

1. Create a **new** bot with `@BotFather` (do not reuse marketing/social tokens)
2. Message the bot `/start` once — it shows your Telegram user id
3. On the VPS `.env` set:
   - `TELEGRAM_PA_BOT_TOKEN=…`
   - `TELEGRAM_PA_OWNER_IDS=<your numeric id>`
   - `GEMINI_API_KEY=…` (already used by Hub)
   - Optional: `BRAVE_SEARCH_API_KEY` for better web search (DuckDuckGo works without a key)
4. Deploy from your machine (password via env or `deploy/.vps-password` — never commit):

```powershell
# One-time: save VPS password locally (gitignored)
# Set-Content deploy/.vps-password -NoNewline 'your-password'

node deploy/deploy-pa.cjs
$env:TELEGRAM_PA_BOT_TOKEN = 'your-new-bot-token'
node deploy/set-pa-token.cjs
node deploy/check-pa-bot.cjs
```

5. Or install systemd manually:

```bash
sudo tee /etc/systemd/system/jab-hub-pa.service >/dev/null <<'EOF'
[Unit]
Description=JAB Hub personal PA agent
After=network.target

[Service]
Type=simple
User=jabhub
WorkingDirectory=/opt/jab-hub
EnvironmentFile=/opt/jab-hub/.env
ExecStart=/usr/bin/node /opt/jab-hub/scripts/proactive-pa-agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now jab-hub-pa
```

**Telegram usage:** chat naturally · `remember …` · `remind me in 20 minutes …` · send PDF/TXT/MD · `/mode preach|news|topics` · `/tasks` · `/brief`

### Off-laptop Cursor worker

To let the PA hand coding work to Cursor even when your laptop is off:

1. Create a Cursor API key from your Cursor dashboard
2. Put it on the VPS:

```powershell
$env:CURSOR_API_KEY = 'cursor_...'
node deploy/set-pa-cursor-key.cjs
node deploy/check-pa-bot.cjs
```

3. Then in Telegram say things like:
   - `Use Cursor to fix the bug in the PA news search and report back here`
   - `Ask Cursor to work on jab-hub and improve the onboarding form`
   - `What is Cursor doing?`
   - `Status of cursor job 3`

The PA launches a Cursor **cloud agent** against `https://github.com/Kwameboat/jab-hub.git` on `master`, polls it in the background, and reports results/branch/PR back into Telegram.

## Cutover helper

```bash
bash /opt/jab-hub/deploy/cutover-checklist.sh
```
