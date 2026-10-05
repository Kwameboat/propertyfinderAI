# FIE AI (standalone)

Ghana housing AI agent as a **standalone PWA** for **Vercel**, with **Supabase** inventory and **portal scrapers**.

## Architecture

```
Browser PWA (/)
  → /api/rent/*  (chat, browse, viewing)
  → reads listings from Supabase

Vercel Cron (every 2h)
  → /api/cron/scrape
  → one tick: source × city × rent|sale
  → Ghana Property Centre / Meqasa HTML
  → upsert into Supabase `listings`
```

Jiji needs FlareSolverr, so it is **off by default** on Vercel. Enable with `FLARESOLVERR_URL` pointing at a reachable solver, or scrape Jiji from Contabo into the same Supabase project.

## Supabase setup

1. Create a Supabase project.
2. Paste **[`supabase/GHANA_FIE_SETUP.sql`](../../supabase/GHANA_FIE_SETUP.sql)** into the SQL editor (one shot), **or** run migrations `001` → `002_listing_availability` → `004_ghana_cluster`.
3. Copy **Project URL** + **service role key** into Vercel env.
4. First fill (from your machine or CI):

```bash
cd apps/fie-ai
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
npm run bootstrap          # live GPC Accra rent → Supabase
npm run scrape             # cron-style tick
npm run verify:strict      # fail if env incomplete
```

## Vercel env

| Variable | Required | Purpose |
|----------|----------|---------|
| `JAB_RE_MARKET=GH` | yes | Ghana market |
| `JAB_FIE_STANDALONE=1` | yes | Root PWA paths |
| `GEMINI_API_KEY` | yes | Chat / voice |
| `SUPABASE_URL` | yes | Listing store |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Scrape upserts + reads |
| `JAB_RE_INGEST_TOKEN` | yes | Manual scrape auth |
| `CRON_SECRET` | recommended | Vercel Cron auth |
| `PAYSTACK_*` | optional | Viewing fee |

Root Directory: `apps/fie-ai`.

## Scrape API

```bash
# One cron tick (recommended on Vercel)
curl -X POST https://YOUR_APP.vercel.app/api/cron/scrape \
  -H "Authorization: Bearer $CRON_SECRET"

# Explicit source
curl -X POST https://YOUR_APP.vercel.app/api/rent/ingest/scrape \
  -H "X-Ingest-Token: $JAB_RE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"ghanapropertycentre","emirates":["Accra"],"types":["rent"],"maxPages":1}'

# Push pre-scraped rows
curl -X POST https://YOUR_APP.vercel.app/api/rent/ingest \
  -H "X-Ingest-Token: $JAB_RE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"batch","listings":[...]}'
```

Local CLI (same path):

```bash
cd apps/fie-ai
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
node scripts/scrape-to-supabase.mjs          # one tick
node scripts/scrape-to-supabase.mjs --all    # all safe sources
node scripts/scrape-to-supabase.mjs --source=ghanapropertycentre --city=Accra --type=rent
```

## Local app

```bash
cd apps/fie-ai
cp .env.example .env   # GEMINI + Supabase
npm install
npm run dev
# http://127.0.0.1:3010
```

Without Supabase, Explore falls back to SQLite demo seed. With Supabase configured, browse/chat use live portal inventory.

## Routes

| Path | Role |
|------|------|
| `/` | Consumer PWA |
| `/agent` | Listing-agent PIN + MoMo |
| `/thanks` | Paystack return |
| `/api/rent/*` | Chat, browse, lead, viewing |
| `/api/rent/ingest/*` | Scrape / batch ingest |
| `/api/cron/scrape` | Vercel Cron tick |
| `/api/health` | Liveness + inventory counts |
