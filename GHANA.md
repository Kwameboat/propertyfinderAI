# FIE AI (Ghana)

Ghana housing PWA on the same Dar Concierge engine. **Does not replace the live UAE product.** Default market stays `AE`. Brand: **FIE AI** — your AI real estate agent in Ghana.

## Standalone on Vercel (preferred public app)

FIE AI also ships as a **standalone PWA** under [`apps/fie-ai`](apps/fie-ai/README.md):

- Root Directory in Vercel: `apps/fie-ai`
- PWA at `/` (not `/gh`)
- Serverless API for chat / browse / viewing
- Set `JAB_FIE_STANDALONE=1` + `JAB_RE_MARKET=GH`
- **Supabase** is the listing store (`SUPABASE_URL` + service role key)
- **Vercel Cron** `/api/cron/scrape` every 2h scrapes Ghana Property Centre / Meqasa into Supabase
- **Jiji (free):** browser `JIJI_CF_CLEARANCE` on Vercel, or GitHub Actions + FlareSolverr (`.github/workflows/fie-ghana-scrape.yml`) — see `apps/fie-ai/JIJI.md`
- Evolution WhatsApp still Contabo-side

The Contabo dual-hub layout below remains valid for VPS testing.

## Contabo / shared host (`/gh`)

Public path: `/gh` on the same HTTPS host as Dar Concierge (`https://wa.jabdigitalhub.com/gh`).
Cloudflare Tunnel routes `/gh*` to Hub `:3001` so the PWA is a secure context (install + microphone). Dar Concierge stays at `https://wa.jabdigitalhub.com/rent`.

## Turn it on

```bash
# .env (Ghana Hub)
JAB_RE_MARKET=GH
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...
JAB_RE_WA_INSTANCE=fie-ghana-wa
JAB_RE_WA_PHONE=23324xxxxxxx

# local test without Paystack
JAB_RE_GH_DEV_PAY=1

cp .env.example .env
node scripts/seed-ghana-listings.mjs
cd apps/hub && npm start
# open http://127.0.0.1:3000/gh
```

Scrape Ghana portals into the listing store (SQLite + Supabase when configured). Each run collects **rent and sale**:

```bash
node scripts/scrape-ghana-listings.mjs --sources=meqasa,jiji,ghanapropertycentre
```

n8n on the VPS (`:5678`) now runs **FIE AI Ghana** workflows against Hub `:3001` with `types: ["rent","sale"]`. Dar Concierge UAE scrape workflows are deactivated. Hourly UAE systemd scrape timers stay disabled.

Live Ghana inventory: Ghana Property Centre HTML/JSON-LD is the main public source (for-rent and for-sale). **Jiji** is scraped through FlareSolverr (`FLARESOLVERR_URL=http://127.0.0.1:8191`) because jiji.com.gh Cloudflare-blocks datacenter IPs. Meqasa is still attempted each run.

```bash
docker compose -f deploy/flaresolverr/docker-compose.yml up -d
# dashboard: /admin/re → Scrape Jiji
```

Landlords and agents can also publish from the PWA: tap **List your property** on `/gh` (also in the menu and Profile). Direct listings use source `fie_direct` and show in Explore Rent/Buy alongside portal rows.

## Chat (FIE AI agent)

Ghana chat (`/gh`) answers as a professional Ghanaian agent:

- Live asking prices and counts from FIE inventory (Ghana Property Centre, Jiji, Meqasa, direct listings)
- Ghana knowledge: property types, Accra/Kumasi/Tema areas, Rent Act advance cap, ECG / Ghana Water, viewing PIN
- If someone cannot pay 1–2 years advance, FIE names **real** rent-to-monthly partners with official links: [NRAS](https://www.nras.gov.gh/), [Rent Masters](https://www.rent-masters.com/), [Renmo](https://listings.renmo.homes/), [ArchieRent](https://archielands.com/ArchieRent/index.php), [RENTBRiG](https://www.rentbrig.com/)
- Voice notes: tap the mic on `/gh` (or send a WhatsApp voice note). FIE transcribes Twi, Fante, Ewe, Ga, Dagbani, Hausa, Ghanaian Pidgin, and Ghanaian English, then replies in the same language.

UAE `/rent` chat is unchanged (`JAB_RE_MARKET` unset).

## Money

| Step | Amount | Split |
|------|--------|--------|
| Client pays to book viewing | GH₵100 | 50 platform (now), 50 held for listing agent |
| Agent sends PIN (+ MoMo) to platform WhatsApp | — | Held 50 marked ready to payout |
| Client takes the room | 10% of agreed rent | 50% platform / 50% listing agent |

PIN redeem: open `/gh/agent` or:

```bash
curl -X POST http://127.0.0.1:3000/api/rent/viewing/redeem-pin \
  -H "Content-Type: application/json" \
  -d '{"pin":"123456","momo":"0241234567"}'
```

Record a close (agency login):

```http
POST /api/admin/re/deals
{ "viewingId": "...", "agreedAmountGhs": 1800 }
```

## Duplicate listings

Listings get a `cluster_id` from city + area + type + beds + price band (and geo if present). Chat shows one card plus “also listed by N other agents.” Booking is always on **one offer / one agent**. Demo seed includes three East Legon self-contains (Meqasa, Jiji, Ghana Property Centre) at nearby prices so they cluster.

Agency dashboard: **Viewings** tab at `/admin/re` — PIN status, MoMo, and record a 10% close.

## UAE

Leave `JAB_RE_MARKET` unset on the UAE VPS.

## WhatsApp (FIE chat number)

Ghanaians will message WhatsApp before they open the PWA. FIE needs its **own +233 number** — do not scan the UAE `dar-concierge-wa` or **JAB Agent Number** lines.

How it is wired on this VPS:

1. Evolution already runs at `:8080`. The global webhook goes to `jab-hub-bridge` (`:8787`).
2. Create a **new** Evolution instance named `fie-ghana-wa` (Baileys QR is the fast path).
3. On the phone that will be FIE: WhatsApp → Linked devices → Link a device → scan the QR.
4. Ghana Hub (`/opt/keyfinder-ghana/.env`) must have `JAB_RE_WA_INSTANCE=fie-ghana-wa`.
5. UAE Hub / bridge (`/opt/jab-hub/.env`) must have:
   - `JAB_RE_WA_INSTANCE=dar-concierge-wa` (unchanged)
   - `JAB_RE_GH_WA_INSTANCE=fie-ghana-wa`
   - `JAB_RE_GH_HUB_URL=http://127.0.0.1:3001`
6. Set `JAB_RE_WA_PHONE=233…` on the Ghana Hub so `/gh` shows **Chat on WhatsApp**.
7. Restart **only** `keyfinder-ghana` and `jab-hub-bridge`. Do not restart the UAE dashboard.

```bash
cd /opt/keyfinder-ghana
sudo -u jabhub bash deploy/create-instance.sh fie-ghana-wa
# Then open Evolution Manager → fie-ghana-wa → scan QR
# https://wa.jabdigitalhub.com/manager
# (login = AUTHENTICATION_API_KEY from .env)

# After the instance shows "open":
# Ghana .env
JAB_RE_WA_INSTANCE=fie-ghana-wa
JAB_RE_WA_PHONE=23324xxxxxxx

# UAE / bridge .env  (do not change JAB_RE_WA_INSTANCE)
JAB_RE_GH_WA_INSTANCE=fie-ghana-wa
JAB_RE_GH_HUB_URL=http://127.0.0.1:3001

sudo systemctl restart keyfinder-ghana jab-hub-bridge
journalctl -u jab-hub-bridge -f   # send "self-contain East Legon" to the Ghana number
```

Do **not** run `deploy/get-qr.sh dar-concierge-wa` — that logs out the live UAE concierge number.

Official Meta Cloud API (harder, more ban-resistant) is in `deploy/META-WHATSAPP.md`. Same instance name `fie-ghana-wa`, integration **WhatsApp Business** instead of Baileys.

Inbound path: WhatsApp → Evolution → `jab-hub-bridge` → `http://127.0.0.1:3001/api/rent/whatsapp/inbound` → FIE listings (not Dar Concierge).

## Live test (Contabo)

FIE AI runs as a **second** Hub on the same VPS. Dar Concierge on `:3000` is untouched.

| App | URL |
|-----|-----|
| FIE AI PWA | https://wa.jabdigitalhub.com/gh |
| Agency login | https://wa.jabdigitalhub.com/gh/login |
| FIE listing dashboard | https://wa.jabdigitalhub.com/gh/admin/re |
| Agent PIN confirm | https://wa.jabdigitalhub.com/gh/agent |
| Dar Concierge (UAE, unchanged) | https://wa.jabdigitalhub.com/rent |

Installed home-screen FIE AI checks for a new service worker on open, focus, and refresh, then reloads once — same as a native app update. Re-adding the icon is not required.

HTTP `http://169.58.81.179:3001/gh` redirects to the HTTPS PWA.

Cloudflare Tunnel (`/etc/cloudflared/config.yml`) must list this rule **first** (before `/sw.js` and `/api/rent`), otherwise those regexes steal `/gh/sw.js` and `/gh/api/*`:

```yaml
  - hostname: wa.jabdigitalhub.com
    path: ^/gh
    service: http://127.0.0.1:3001
```

Test viewing uses demo pay (`JAB_RE_GH_DEV_PAY=1`) so PIN appears in chat. Give that PIN to `/gh/agent` with a MoMo number.
