# n8n — UAE Real Estate multi-source scrape

Scheduled ingest: **Bayut · Property Finder · Dubizzle · Emaar · Damac** → **Supabase** → Hub `/rent` chat reads Supabase only.

**Default: $0 mode** — HTML scrapers + Gemini RAG. See **`deploy/ZERO-COST-MODE.md`**.

## Prerequisites ($0 mode)

1. Supabase migration applied (`supabase/migrations/001_real_estate.sql`)
2. Hub `.env`:

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
JAB_RE_INGEST_TOKEN=generate-a-long-random-string
JAB_RE_ZERO_COST_MODE=1
JAB_RE_STALE_HOURS=96
JAB_RE_SCRAPE_DELAY_MS=3000
GEMINI_API_KEY=your_free_google_ai_studio_key
JAB_RE_OPENCLAW_VIA=gemini
```

3. n8n running: `docker compose up -d n8n`

### Optional paid upgrade (Apify)

Only if `JAB_RE_ZERO_COST_MODE=0`:

```env
APIFY_API_TOKEN=apify_api_xxxxxxxx
```

## Hub ingest API (called by n8n)

All routes require header: `X-Ingest-Token: YOUR_JAB_RE_INGEST_TOKEN`

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| POST | `/api/rent/ingest/scrape` | `{ "source": "bayut" }` | **$0 HTML** scraper → Supabase (default) |
| POST | `/api/rent/ingest/apify` | `{ "source": "bayut" }` | Apify (disabled when `JAB_RE_ZERO_COST_MODE=1`) |
| POST | `/api/rent/ingest/scrape-all` | `{ "sources": ["bayut","propertyfinder"] }` | Run all sources sequentially + stale cleanup |
| POST | `/api/rent/ingest` | `{ "source": "apify", "listings": [...] }` | Batch upsert from Apify/Puppeteer JSON |

**Sources:** `bayut`, `propertyfinder`, `dubizzle`, `emaar`, `damac`, `bayut_api`, `propertyfinder_api`

From n8n (Docker network):

```
http://host.docker.internal:3000/api/rent/ingest/scrape
```

## Import workflow

1. Open n8n → **Workflows** → **Import from file**
2. Choose `deploy/n8n/re-listings-multi-source.json`
3. Edit each **HTTP Request** node → set `X-Ingest-Token` header to your token
4. Activate workflow

The workflow runs **every 24 hours**. All branches use **HTML scrapers** (`/api/rent/ingest/scrape`) — no Apify cost.

Deploy $0 mode: `node deploy/deploy-re-zero-mode.cjs`

## Manual Apify test

```bash
node scripts/re-apify-ingest.mjs --source=bayut
node scripts/re-apify-ingest.mjs --source=propertyfinder
```

Or curl:

```bash
curl -X POST http://127.0.0.1:3000/api/rent/ingest/apify \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: YOUR_TOKEN" \
  -d '{"source":"bayut","emirates":["Dubai"],"maxPages":1,"maxResults":25}'
```

## Manual test (HTML scrapers, no n8n)

```bash
# One source
node scripts/re-n8n-ingest.mjs --source=propertyfinder

# All default sources + stale cleanup
node scripts/re-n8n-ingest.mjs --all
```

Or via curl:

```bash
curl -X POST http://127.0.0.1:3000/api/rent/ingest/scrape \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: YOUR_TOKEN" \
  -d '{"source":"bayut"}'
```

## Apify / Puppeteer (optional upgrade)

When HTML scrapers hit captcha, replace a branch with:

1. **Apify** — Run actor → **Set** node map fields → POST `/api/rent/ingest`
2. **Puppeteer** — Code node or external service → same ingest endpoint

Listing shape (minimum):

```json
{
  "source": "bayut",
  "external_id": "12345",
  "source_url": "https://www.bayut.com/...",
  "transaction_type": "rent",
  "emirate": "Dubai",
  "community": "Dubai Marina",
  "beds": 2,
  "price_aed": 120000,
  "images": ["https://..."],
  "agent_phone": "+971..."
}
```

## Disable old VPS cron

After n8n is stable, disable the systemd timer:

```bash
sudo systemctl disable --now jab-re-scrape.timer
```

## Monitoring

- Hub: `GET /api/rent/status` — counts by source, `store: "supabase"`
- Supabase: `scrape_runs` table — per-source run logs
- n8n: execution history per branch

## Architecture

```
n8n Schedule (6h)
  ├─ POST ingest/scrape { source: bayut }
  ├─ POST ingest/scrape { source: propertyfinder }
  ├─ POST ingest/scrape { source: dubizzle }
  ├─ POST ingest/scrape { source: emaar }
  └─ POST ingest/scrape { source: damac }
           │
           ▼
      Supabase listings
           │
           ▼
   /rent chat (OpenClaw/Gemini) — read only
```
