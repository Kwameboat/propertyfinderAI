# FIE AI (Ghana)

Ghana housing PWA on the same Dar Concierge engine. **Does not replace the live UAE product.** Default market stays `AE`. Brand: **FIE AI** — your AI real estate agent in Ghana.

Public path: `/gh` on the same HTTPS host as Dar Concierge (`https://wa.jabdigitalhub.com/gh`).
Cloudflare Tunnel routes `/gh*` to Hub `:3001` so the PWA is a secure context (install + microphone). Dar Concierge stays at `https://wa.jabdigitalhub.com/rent`.

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

## Live test (Contabo)

FIE AI runs as a **second** Hub on the same VPS. Dar Concierge on `:3000` is untouched.

| App | URL |
|-----|-----|
| FIE AI PWA | https://wa.jabdigitalhub.com/gh |
| Agent PIN confirm | https://wa.jabdigitalhub.com/gh/agent |
| FIE listing dashboard | http://169.58.81.179:3001/admin/re |
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
