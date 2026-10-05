# FIE AI (standalone)

Ghana housing AI agent as a **standalone PWA** for **Vercel**.

This is the Vercel architecture for FIE AI. The Contabo `/gh` dual-hub layout in [GHANA.md](../../GHANA.md) remains available for VPS deploys; this app does not depend on Dar Concierge, Evolution, or FlareSolverr.

## What runs on Vercel

| Piece | How |
|-------|-----|
| PWA shell | Static `public/` (`index.html`, SW, manifest) |
| Chat / browse / viewing | Serverless Express in `api/index.mjs` → `server.mjs` |
| Listings | Supabase when configured, else SQLite seed in `/tmp` |
| Voice | Gemini |
| Viewing fee | Paystack (or `JAB_RE_GH_DEV_PAY=1` for demo PIN) |

## What stays off Vercel

- Portal scrapers (`scripts/scrape-ghana-listings.mjs`, FlareSolverr, n8n)
- Evolution WhatsApp inbound (`fie-ghana-wa`)
- Agency dashboard (`/admin/re`)

Point scrapers at Supabase; the PWA reads the same store.

## Local

```bash
cd apps/fie-ai
cp .env.example .env   # set GEMINI_API_KEY
npm install
npm run dev
# http://127.0.0.1:3010
```

## Vercel

1. Import this GitHub repo in Vercel.
2. Set **Root Directory** to `apps/fie-ai`.
3. Add env: `JAB_RE_MARKET=GH`, `JAB_FIE_STANDALONE=1`, `GEMINI_API_KEY`, optional Supabase + Paystack.
4. Deploy. Installable PWA at the deployment URL (`start_url: /`).

```bash
cd apps/fie-ai && npx vercel --prod
```

## Routes

| Path | Role |
|------|------|
| `/` | Consumer PWA |
| `/agent` | Listing-agent PIN + MoMo |
| `/thanks` | Paystack return |
| `/api/rent/*` | Chat, browse, lead, viewing |
| `/api/health` | Liveness |
