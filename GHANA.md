# KeyFinder Ghana

Ghana housing PWA on the same Dar Concierge engine. **Does not replace the live UAE product.** Default market stays `AE`.

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

Scrape Meqasa (best-effort):

```bash
node scripts/scrape-ghana-listings.mjs --sources=seed,meqasa
```

## Money

| Step | Amount | Split |
|------|--------|--------|
| Client pays to book viewing | GH₵100 | 50 platform (now), 50 held for listing agent |
| Agent sends PIN (+ MoMo) to platform WhatsApp | — | Held 50 marked ready to payout |
| Client takes the room | 10% of agreed rent | 50% platform / 50% listing agent |

PIN redeem:

```bash
curl -X POST http://127.0.0.1:3000/api/rent/viewing/redeem-pin \
  -H "x-ingest-token: $JAB_RE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"PIN 123456 momo 0241234567"}'
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

Ghana runs as a **second** Hub on the same VPS. Dar Concierge on `:3000` is untouched.

| App | URL |
|-----|-----|
| KeyFinder Ghana PWA | http://169.58.81.179:3001/gh |
| Agent PIN confirm | http://169.58.81.179:3001/gh/agent |
| Ghana listing dashboard | http://169.58.81.179:3001/admin/re |
| Dar Concierge (UAE, unchanged) | http://169.58.81.179:3000/rent |

Test viewing uses demo pay (`JAB_RE_GH_DEV_PAY=1`) so PIN appears in chat. Give that PIN to `/gh/agent` with a MoMo number.
