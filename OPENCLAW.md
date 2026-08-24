# JAB Hub — OpenClaw + Evolution (local lab)

## Active wiring (auto for every instance)

| Piece | Value |
|---|---|
| Evolution instance example | `jab-whatsapp` |
| Bridge | `http://host.docker.internal:8787/evolution` |
| OpenClaw gateway | `http://127.0.0.1:18789` |
| Global webhook | enabled in `.env` (`WEBHOOK_GLOBAL_*`) |

Any new Evolution instance (Manager UI or API) is wired to OpenClaw by:

1. **Global webhook** in Evolution `.env` → posts all `MESSAGES_UPSERT` / `CONNECTION_UPDATE` to the bridge
2. **Bridge auto-sync** every 30s → keeps per-instance webhooks **disabled** when global is on (avoids double replies), and dedupes by WhatsApp message id
3. **Multi-instance replies** → bridge resolves each instance token from Evolution `fetchInstances`

## Flow

```text
Any WhatsApp number on any Evolution instance
  -> Evolution (global + per-instance webhook)
  -> http://host.docker.internal:8787/evolution
  -> Bridge resolves instance token
  -> OpenClaw agent writes reply text (+ optional [SEND_PHOTO:id] / [YANGO_FEE:location])
  -> Bridge sends product images via Evolution sendMedia when requested
  -> Bridge replaces [YANGO_FEE:…] with a Yango quote (shop → buyer)
  -> Evolution sendText on that same instance
```

### Product photos + Yango delivery

- Catalog products can include photos (manage link / Hub). When a customer asks for a picture, the agent emits `[SEND_PHOTO:id]` and the bridge sends those images on WhatsApp.
- Set each client’s **shop address** (Onboard or client manage → Shop location). The agent asks for the buyer’s area or WhatsApp location pin, then emits `[YANGO_FEE:…]`.
- With `YANGO_CLID` + `YANGO_APIKEY` in `.env`, quotes use the official Yango route/price API. Without keys, a distance-based GHS estimate is used (tunable via `YANGO_FALLBACK_*`).

### Finance (Paystack points)

- Hub → **Finance** tab: point packages (GHS → points), AI/campaign burn rates, agency WhatsApp instance, wallets, Paystack payments.
- Set `PAYSTACK_SECRET_KEY` + `PAYSTACK_PUBLIC_KEY` in `.env`. Register webhook `{JAB_HUB_PUBLIC_URL}/api/billing/paystack/webhook`.
- Pick your **agency** Evolution instance (Facebook ads / ops number) for payment + low-balance WhatsApp notices to each client’s `contact_phone`. That same instance uses the **agency growth prompt** (diagnose → qualify → book via OpenClaw **appointment-manager** → Paystack), not the store/COD catalog prompt. Optional: set `JAB_HUB_BOOKING_URL` as a fallback booking link.
- Bridge deducts points per AI text/image reply; campaigns deduct per recipient part. Empty wallet pauses AI and can send a Paystack top-up link (`[PAYMENT_LINK:]`). The agency ads instance is **unlimited AI by default** (exempt from the points gate/debit). System default instance: `jab-whatsapp` (or `JAB_AGENCY_INSTANCE` / `JAB_MARKETING_INSTANCE` / Finance setting).

## Memory + follow-ups

- **Chat memory** persists per contact via the OpenClaw session key `hook:evo:{instance}:{phone}`, so the agent remembers where each chat left off.
- **Lead state** is stored at `~\.openclaw\jab-hub\leads.json` (created by the bridge). Each lead tracks `lastInboundAt`, `lastOutboundAt`, `followUpAt`, and `followUpSent`.
- **24h follow-ups**: if a client goes quiet for `JAB_HUB_FOLLOWUP_HOURS` (default 24) after their last message, the bridge sweep (every `JAB_HUB_FOLLOWUP_TICK_MS`, default 5 min) generates one short AI check-in on the same session and sends it via Evolution. A new inbound message resets the timer and re-arms one more follow-up.
- The **bridge must stay running** for follow-ups to fire.

## Agency Hub (contacts + campaigns)

| Piece | Value |
|---|---|
| UI | http://127.0.0.1:3000 |
| n8n (automation) | http://127.0.0.1:5678 — see [deploy/N8N.md](deploy/N8N.md) |
| Auth | `HUB_ADMIN_PASSWORD` in `.env`; change it from Hub **Settings** |
| DB | `~\.openclaw\jab-hub\hub.db` |
| Uploads | `~\.openclaw\jab-hub\uploads\` |

```powershell
cd C:\Users\DELL\jab-hub\apps\hub
npm start
```

- Each Evolution **instance** is a client. Contacts and campaigns are always filtered by `instance_name` — client A never sees client B’s list.
- Bridge upserts contacts on every inbound WhatsApp message.
- Campaigns: compose text + image + PDF → select that client’s contacts → Start. Worker throttles Evolution `sendText` / `sendMedia` (default 4s between recipients). Opted-out contacts are skipped.
- Keep delay high and lists small on Baileys; mass broadcast can trigger WhatsApp bans.
- **Sales teams**: Hub → **Team** tab — set `auto` vs `manual` distribution, add agents (login + personal WhatsApp). Agents use `/agent-login`. Handoff via keywords or AI `[HANDOFF]`; auto assigns randomly, manual queues for agency assign. Agent replies from Hub on the client business WA; personal WA gets the alert only.

## Start services

```powershell
cd C:\Users\DELL\jab-hub
docker compose up -d
node .\scripts\evolution-openclaw-bridge.mjs
# separate terminal:
cd apps\hub; npm start
# optional — proactive marketing (Telegram approvals):
node .\scripts\proactive-marketing-agent.mjs
```

Keep the bridge process running.

For **24/7** on a VPS (not localhost / not cPanel), see [deploy/DEPLOY.md](deploy/DEPLOY.md).

## Proactive Marketing Agent (Telegram)

Outbound discovery for Ghana SMBs that advertise a WhatsApp CTA. **First WhatsApp message always requires Telegram approval.**

### BotFather setup

1. In Telegram, open `@BotFather` → `/newbot` → copy the token into `.env` as `TELEGRAM_BOT_TOKEN=…`
2. Message your new bot once (`/start`)
3. Get your numeric user id (the bot replies with it if you are not yet authorized, or use `@userinfobot`)
4. Set `TELEGRAM_APPROVER_IDS=123456789` (comma-separated for multiple operators)
5. Keep `JAB_MARKETING_DRY_RUN=1` until you are ready for live sends
6. Optional: set `BRAVE_SEARCH_API_KEY` for scheduled `/discover` public-web search
7. Start: `node scripts/proactive-marketing-agent.mjs`

### Commands

| Command | Action |
|---|---|
| `/status` | Queue + daily send stats |
| `/discover` | Run Brave public-web discovery and queue cards |
| `/queue` | Re-post pending approval cards |
| `/lead <url>` | Ingest a public Facebook/Instagram/web/Ad Library URL |
| `/pause` `/resume` | Scheduled discovery |
| `/dryrun on\|off` | Toggle live sends for this process |

Each card shows research + exact draft with **Approve**, **Regenerate**, **Skip**, **Block**.
Approved conversations continue on `jab-whatsapp` using the existing JAB agency growth prompt. One unanswered follow-up may fire after `JAB_MARKETING_FOLLOWUP_HOURS` (default 48h), then stop. Opt-out keywords cancel further jobs.

### Tests

```powershell
node --test tests\marketing.test.mjs
```

## Personal PA Agent (Telegram)

Your private 24/7 assistant: ChatGPT-style chat, live web/current affairs, document RAG (upload sermons/notes), long-term memory, task reminders, preaching companion, optional morning brief.

### BotFather setup

1. `/newbot` with `@BotFather` → `TELEGRAM_PA_BOT_TOKEN` (separate from marketing/social bots)
2. Message the bot `/start` → copy your numeric id into `TELEGRAM_PA_OWNER_IDS`
3. `GEMINI_API_KEY` in `.env` (same as Hub)
4. Optional: `BRAVE_SEARCH_API_KEY` for richer web search
5. Start locally: `node scripts/proactive-pa-agent.mjs`
6. VPS: see [deploy/DEPLOY.md](deploy/DEPLOY.md) → **Personal PA agent**

### Commands

| Command | Action |
|---|---|
| `/mode pa\|preach\|news\|topics` | Switch assistant mode |
| `/tasks` | List open reminders/tasks |
| `/done <id>` | Complete a task |
| `/memories` | Saved facts |
| `/docs` | Uploaded documents |
| `/brief` | Morning brief now |
| `/status` | Stats + config |

Natural language: `remember …`, `remind me in 30 minutes …`, send PDF/TXT/MD for RAG.

If `CURSOR_API_KEY` is configured on the VPS, you can also say:
- `Use Cursor to fix this bug in jab-hub and report back here`
- `Ask Cursor to work on the repo while my laptop is off`
- `What is Cursor doing?`

## UAE Real Estate Concierge (PWA)

Consumer app for anything UAE property — news, FAQs, rent/buy/off-plan search, move-in guides, lead handoff to listing agents.

| Piece | Value |
|---|---|
| PWA | http://127.0.0.1:3000/rent |
| API | `POST /api/rent/chat` |
| Seed data | `node scripts/seed-uae-real-estate.mjs` |
| Lead ops (Telegram) | `node scripts/proactive-re-leads-bot.mjs` |
| Docs | [REAL-ESTATE.md](REAL-ESTATE.md) |

Requires `GEMINI_API_KEY` in `.env`. Optional: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for cloud listing mirror.

## Add a new client number

```powershell
# Preferred (API, hardened QR)
.\scripts\create-instance.ps1 -InstanceName "client-acme" -OpenQr

# Or create in Manager UI, then either wait ~30s for auto-sync, or run:
.\scripts\sync-instances.ps1
.\scripts\get-qr.ps1 -InstanceName "client-acme"
```

No need to manually edit OpenClaw `EVO_INSTANCE` / `EVO_API_KEY` for each client — the bridge picks the right instance token automatically.

## Manual sync / health

```powershell
.\scripts\sync-instances.ps1
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod -Method POST http://127.0.0.1:8787/sync
```

## Test

1. Bridge running on `8787`
2. Instance `connectionState` is `open`
3. WhatsApp the connected number
4. Expect one AI reply from the same number

## Files

- Bridge: `scripts/evolution-openclaw-bridge.mjs`
- Proactive marketing (Telegram): `scripts/proactive-marketing-agent.mjs`
- Personal PA (Telegram): `scripts/proactive-pa-agent.mjs`
- Agency social (Telegram): `scripts/proactive-social-agent.mjs`
- Agency Hub: `apps/hub` (UI + campaign worker)
- Shared DB: `packages/hub-db`
- Create instance: `scripts/create-instance.ps1`
- Fetch QR: `scripts/get-qr.ps1`
- Sync all webhooks: `scripts/sync-instances.ps1`
- OpenClaw config: `~\.openclaw\openclaw.json`
- Agent instructions: OpenClaw UI → Agents → Core Files → `AGENTS`
