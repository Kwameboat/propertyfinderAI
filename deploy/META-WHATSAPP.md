# Meta WhatsApp Cloud API — Agency Number Setup

Connect **JAB Agent Number** to Meta’s official WhatsApp Business Platform (not Baileys) to avoid session bans.

## Prerequisites

1. [Meta Business Manager](https://business.facebook.com/)
2. WhatsApp Business Account (WABA)
3. Phone number (+233…) verified with Meta
4. Evolution API running on VPS (`http://127.0.0.1:8080`)

## Recommended architecture

| Layer | Role |
|--------|------|
| **Meta Cloud API** | Customer-facing agency WhatsApp (prospects message you) |
| **Hub Inbox** | Full AI + human conversation |
| **Telegram** | Ops alerts (handoff, hot lead, payment) — **not WhatsApp loops** |
| **Client instances** | Each tenant’s own WABA when onboarded (same pattern) |

## Step 1 — Meta Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com/) → Create app → Business
2. Add product **WhatsApp**
3. Note:
   - **Phone number ID**
   - **WhatsApp Business Account ID**
   - **Permanent access token** (System User recommended for production)

## Step 2 — HTTPS webhook (Meta requires public HTTPS)

Meta rejects `http://IP:8080`. Use **Cloudflare Tunnel** on the VPS (recommended for JAB Hub):

```bash
# One-time (uses local cloudflared auth + VPS SSH password)
node deploy/setup-cloudflare-wa-tunnel.cjs
```

This creates tunnel `wa-meta-webhook`, routes **`wa.jabdigitalhub.com`** → Evolution `:8080`, and runs `cloudflared` on the VPS 24/7.

**Meta dashboard → Configure Webhooks:**

| Field | Value |
|--------|--------|
| Callback URL | `https://wa.jabdigitalhub.com/webhook/meta` |
| Verify token | `evolution` |
| Client certificate | **OFF** |

`evolution` must match `WA_BUSINESS_TOKEN_WEBHOOK` in `/opt/jab-hub/.env`.

Verify from anywhere:

```bash
curl "https://wa.jabdigitalhub.com/webhook/meta?hub.mode=subscribe&hub.verify_token=evolution&hub.challenge=12345"
# Expected: 12345
```

## Step 3 — Connect via Evolution API (fastest for JAB Hub)

1. Open Evolution Manager: `http://YOUR_VPS:8080/manager`
2. Create instance **JAB Agent Number** with integration **WhatsApp Business** (Cloud API), not Baileys
3. Paste Meta token + phone number ID when prompted
4. Evolution receives Meta webhooks at `/webhook/meta`; bridge webhook stays `http://127.0.0.1:8787/evolution`

5. In Hub Finance → set agency instance to **JAB Agent Number**

## Step 4 — Server `.env`

```env
# Agency instance (must match Evolution + Hub Finance)
JAB_AGENCY_INSTANCE=JAB Agent Number
JAB_MARKETING_INSTANCE=JAB Agent Number

# Meta Cloud API (required before: node deploy/connect-meta-cloud-agency.cjs)
META_WABA_ACCESS_TOKEN=
META_WABA_PHONE_NUMBER_ID=
META_WABA_VERIFY_TOKEN=

# Ops: WhatsApp summary to connected numbers + Telegram
JAB_AGENCY_OPS_CHANNEL=both
JAB_AGENCY_DIGEST_HUB_URL=0
TELEGRAM_BOT_TOKEN=
TELEGRAM_OPS_CHAT_IDS=

# Ban-risk guards (inbound prospect replies still work)
JAB_AGENCY_OUTBOUND_PAUSE=1
JAB_MARKETING_DRY_RUN=1
JAB_AGENCY_FOLLOWUP=off
JAB_AGENCY_TYPING=off
```

Then run:
```bash
node deploy/connect-meta-cloud-agency.cjs
node deploy/apply-agency-whatsapp-summary.cjs
```

## Step 5 — Safe go-live

1. Wait 24–72h after a Baileys 403 ban before reconnecting
2. Remove old Baileys linked devices on the phone (WhatsApp → Linked devices)
3. Connect Cloud API only
4. Keep `JAB_AGENCY_OUTBOUND_PAUSE=1` — reply **inbound only** first week
5. Test: prospect sends “pricing?” → AI replies → connected number gets **WhatsApp summary** (score + text, no Hub link) + optional Telegram
6. No cold marketing until Meta **message templates** are approved

## Meta rules (Cloud API)

| Action | Requirement |
|--------|-------------|
| Customer messages first | Free-form session replies (24h window) ✅ |
| You message first | Approved **template** required |
| Ops internal alerts | Use **Telegram** (this repo default) |
| Payment links | OK in active session when user asked |

## Verify connection

```bash
node deploy/check-agency-wa.cjs
```

Look for `"integration":"WHATSAPP-BUSINESS"` and `"connectionStatus":"open"`.

Bridge startup logs:

```json
{"agencyWhatsApp":{"integration":"WHATSAPP-BUSINESS","connectionStatus":"open","isCloudApi":true}}
```

## Client SaaS tenants

Each onboarded client can use WhatsApp in two ways:

### A) Platform tenant (no WABA)

For clients who **cannot get WABA** — route through the **agency Meta line**:

- Hub → **Team** → enable **Platform tenant on agency line**
- Share the generated **wa.me link** in ads (includes `ref:shop-slug`)
- Customer messages agency number → menu or auto-route → AI as that shop
- Owner gets digest alerts; full chat in Hub Inbox under that client instance
- Customer can reply **JAB** anytime for agency sales/onboarding
- Customer can reply **menu** to switch shop

### B) Dedicated line (Cloud API recommended)

- Customer messages the **client business number** on their own WABA
- See owner alerts in Team tab

| Setting | Default | Purpose |
|---------|---------|---------|
| `platform_whatsapp_enabled` | off | Route shop via agency line (no WABA) |
| `platform_slug` | auto | Used in wa.me `ref:slug` and menu matching |
| `client_notify_mode` | `digest` | Owner summary on handoff / hot lead |
| `client_score_notify_threshold` | `60` | One-time hot-lead alert |
| `owner_notify_phone` | contact phone | Where summaries are sent |

Env: `JAB_AGENCY_WA_PHONE=233542345393` for wa.me link generation in Hub.

See `README.md` — “Baileys for pilots; Cloud API for production.”

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 403 / Connection Failure on Baileys | Do not re-pair Baileys; migrate to Cloud API |
| Ops not getting alerts | Set `TELEGRAM_OPS_CHAT_IDS`; Finance → Ops channel = Telegram |
| AI not replying | Check bridge + Evolution webhook; instance must be `open` |
| Template send fails | Use session replies for inbound-only phase |
