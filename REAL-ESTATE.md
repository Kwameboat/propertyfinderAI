# UAE Real Estate Concierge

Consumer PWA + Gemini/OpenClaw chat agent for **anything UAE property**: news, trends, FAQs, rent/buy/off-plan search, move-in guides, and lead handoff to listing agents.

## Quick start (local)

```powershell
# 1. Ensure GEMINI_API_KEY in .env
# 2. Seed knowledge + sample listings
node scripts/seed-uae-real-estate.mjs

# 3. Start Hub (serves PWA + API)
cd apps/hub
npm start

# 4. Open consumer app
# http://127.0.0.1:3000/rent

# 5. Optional — Telegram lead ops (after phone calls)
node scripts/proactive-re-leads-bot.mjs
```

## Architecture

| Piece | Path |
|-------|------|
| PWA | `apps/hub/public/rent.html` |
| Chat API | `POST /api/rent/chat` in `apps/hub/server.mjs` |
| Orchestrator | `packages/real-estate/chat.mjs` |
| Listings DB (local) | SQLite `re_*` tables via `packages/hub-db/real-estate.mjs` |
| Supabase (optional) | `supabase/migrations/001_real_estate.sql` + `packages/real-estate/supabase.mjs` |
| Gemini / OpenClaw | `packages/real-estate/gemini.mjs` |
| Scraper cron | `scripts/scrape-uae-listings.mjs` |
| Lead ops bot | `scripts/proactive-re-leads-bot.mjs` |

## Environment

```env
GEMINI_API_KEY=...

# Optional OpenClaw instead of direct Gemini
JAB_RE_OPENCLAW_VIA=gemini
JAB_RE_OPENCLAW_AGENT_ID=uae-real-estate-agent
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789

# Optional Supabase mirror
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

# Telegram lead ops
TELEGRAM_RE_LEADS_BOT_TOKEN=
TELEGRAM_RE_LEADS_APPROVER_IDS=
JAB_RE_LEADS_INSTANCE=jab-whatsapp
JAB_RE_LEADS_DRY_RUN=1
```

## API

| Method | Path | Body |
|--------|------|------|
| POST | `/api/rent/session` | `{}` → `{ sessionId }` |
| POST | `/api/rent/chat` | `{ sessionId, message }` |
| POST | `/api/rent/lead` | `{ sessionId, listingId?, renterName, renterPhone, consent: true }` |
| GET | `/api/rent/listings/:id` | Listing detail |
| GET | `/api/rent/status` | `{ listings, supabase }` |

## User flow

1. User chats on `/rent` — asks news, FAQs, or property search
2. Agent qualifies → searches local listing DB → shows cards
3. User taps **I'm interested** → consent form
4. Lead saved → Telegram ops card (after your phone call)
5. You tap **Send to agent WA** → Evolution messages listing agent

## Listing ingest (n8n → Supabase)

Multi-source scrape runs on **n8n** (Bayut, Property Finder, Dubizzle, Emaar, Damac) and upserts to **Supabase**. Chat at `/rent` reads Supabase only — OpenClaw/Gemini handles conversation.

See **`deploy/N8N-REAL-ESTATE.md`** for setup, workflow import, and Apify upgrade path.

```bash
# Manual test (no n8n)
node scripts/re-n8n-ingest.mjs --source=bayut
node scripts/re-n8n-ingest.mjs --all
```

Legacy VPS cron (`jab-re-scrape.timer` / `scripts/scrape-uae-listings.mjs`) can be disabled once n8n ingest is stable.

## OpenClaw agent setup

Create agent `uae-real-estate-agent` in OpenClaw UI with AGENTS.md matching `packages/real-estate/prompt.mjs` rules, or keep `JAB_RE_OPENCLAW_VIA=gemini` (default, fastest).

## Disclaimer

Lead-gen only — not a broker. Listings include source URLs. Legal/financial questions → RERA-registered professionals.
