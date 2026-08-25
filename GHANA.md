# FIE AI (Ghana)

Ghana housing PWA on the same Dar Concierge engine. **Does not replace the live UAE product.** Default market stays `AE`. Brand: **FIE AI** — your AI real estate agent in Ghana.

Public path: `/gh` (same app as `/rent`, branded from `/api/rent/config`).
Give Ghana its own domain later (`JAB_HUB_PUBLIC_URL=https://your-ghana-domain`).

## Turn it on

```bash
# .env
JAB_RE_MARKET=GH
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...
JAB_RE_WA_INSTANCE=your-evolution-instance

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

## Live test (Contabo)

FIE AI runs as a **second** Hub on the same VPS. Dar Concierge on `:3000` is untouched.

| App | URL |
|-----|-----|
| FIE AI PWA | http://169.58.81.179:3001/gh |
| Agent PIN confirm | http://169.58.81.179:3001/gh/agent |
| FIE listing dashboard | http://169.58.81.179:3001/admin/re |
| Dar Concierge (UAE, unchanged) | http://169.58.81.179:3000/rent |

Test viewing uses demo pay (`JAB_RE_GH_DEV_PAY=1`) so PIN appears in chat. Give that PIN to `/gh/agent` with a MoMo number.
