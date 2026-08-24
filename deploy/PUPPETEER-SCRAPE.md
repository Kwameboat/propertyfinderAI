# Puppeteer bulk scrape (opt-in)

Separate from the default HTML / Algolia / n8n cron. **Disabled by default.**

## Safety

- `JAB_RE_PUPPETEER_SCRAPE=0` (default) — Hub never launches Chromium
- Sources: `bayut_puppeteer`, `propertyfinder_puppeteer`, `dubizzle_puppeteer` only
- **Not** in `INGEST_SOURCES`, `DEFAULT_N8N_SOURCES`, or `$0 mode` n8n branches
- Listing rows still use `source: bayut|propertyfinder|dubizzle` for chat/RAG compatibility
- Dynamic `import("puppeteer")` — missing package does not break hub startup

## Enable on VPS

```bash
# In /opt/jab-hub/.env
JAB_RE_PUPPETEER_SCRAPE=1
JAB_RE_PUPPETEER_MAX_PAGES=3
JAB_RE_PUPPETEER_DELAY_MS=3000

# Install Chromium (once)
cd /opt/jab-hub && sudo -u jabhub npm install puppeteer

# Optional daily timer (only after env is set)
sudo systemctl enable --now jab-re-puppeteer-scrape.timer
```

## API

```http
POST /api/rent/ingest/puppeteer
Authorization: Bearer $JAB_RE_INGEST_TOKEN
Content-Type: application/json

{ "source": "bayut_puppeteer", "maxPages": 2 }
```

All sources:

```json
{ "all": true, "maxPages": 3 }
```

## CLI

```bash
node scripts/re-puppeteer-ingest.mjs --source=bayut_puppeteer
node scripts/re-puppeteer-ingest.mjs --all --maxPages=5
```

## Deploy

```bash
node deploy/deploy-puppeteer-scraper.cjs
```

Installs units but **does not** enable the timer or set `JAB_RE_PUPPETEER_SCRAPE=1`.

## Cron sources (default)

Daily timer runs **`propertyfinder_puppeteer` only** via `JAB_RE_PUPPETEER_SOURCES`:

```env
JAB_RE_PUPPETEER_SOURCES=propertyfinder_puppeteer
```

Bayut/Dubizzle remain available via explicit `--source=` or API `{ "source": "bayut_puppeteer" }` but are **not** in the default cron.

## How it fetches (VPS-safe)

1. **Plain HTTP fetch** first (same as working HTML cron — avoids headless captcha)
2. **Puppeteer** if fetch lacks `__NEXT_DATA__`
3. **Portal fallbacks** if still empty: Bayut → Algolia API, PF/Dubizzle → HTML scraper

Listing rows always land in Supabase via `batchSyncListingsToSupabase`.

| Path | Unchanged |
|------|-----------|
| `POST /api/rent/ingest/scrape` | HTML/Algolia sources only |
| `jab-re-scrape.timer` | Hourly HTML scrape |
| Live search / developer intel / chat | Independent |
