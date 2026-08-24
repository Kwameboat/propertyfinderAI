# $0 mode — UAE Real Estate ingest

**HTML scrapers + Gemini RAG + Supabase.** No Apify, no RapidAPI.

## Env (VPS `/opt/jab-hub/.env`)

```env
JAB_RE_ZERO_COST_MODE=1
JAB_RE_STALE_HOURS=96
JAB_RE_SCRAPE_DELAY_MS=3000
GEMINI_API_KEY=your_free_google_ai_studio_key
JAB_RE_OPENCLAW_VIA=gemini
# Do NOT set APIFY_API_TOKEN or RAPIDAPI_KEY
```

## n8n

Import `deploy/n8n/re-listings-multi-source.json` — runs **every 24 hours**:

- HTML Bayut, Property Finder, Dubizzle, Emaar, Damac → Supabase
- Mark stale listings (96h)

## Deploy

```bash
node deploy/deploy-re-zero-mode.cjs
```

## Manual ingest

```bash
node scripts/re-n8n-ingest.mjs --all
node scripts/re-n8n-ingest.mjs --source=emaar
```

## RAG layers (all free)

| Layer | Source |
|-------|--------|
| Listing cards | Supabase (HTML scrape) |
| Market/trends | Gemini + Google Search (`gemini-rag.mjs`) |
| FAQs | Seeded knowledge base |
| News | Web search (`web.mjs`) |

## Verify

```bash
curl http://YOUR_VPS:3000/api/rent/status
```

Expect `"mode": { "zeroCost": true, ... }` and `"apify": false`.

## Upgrade path

Set `JAB_RE_ZERO_COST_MODE=0` and add `APIFY_API_TOKEN` to enable Apify ingest.
