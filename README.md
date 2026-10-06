# DAR Concierge

UAE real-estate AI agent (consumer PWA + listing dashboard + WhatsApp). This snapshot was copied from the live Contabo VPS `vmi3460077` (`169.58.81.179:/opt/jab-hub`) on 24 Aug 2026. Secrets (`.env`, DB, uploads) were not copied.

Live:

- Consumer app: `http://169.58.81.179:3000/rent`
- Listing dashboard: `http://169.58.81.179:3000/admin/re` (agency login)

This repository is **separate from** [`Kwameboat/jab-hub`](https://github.com/Kwameboat/jab-hub). `jab-hub` on GitHub is an older agency-lab snapshot and does not include the UAE listing product.

## What is in here

| Piece | Path |
|-------|------|
| Dar Concierge PWA | `apps/hub/public/rent.html` |
| Listing dashboard | `apps/hub/public/re-admin.html` → `/admin/re` |
| Chat / search | `packages/real-estate/` |
| Hub API | `apps/hub/server.mjs` |
| Listing DB helpers | `packages/hub-db/real-estate.mjs` |
| Seed + scrape | `scripts/seed-uae-real-estate.mjs`, `scripts/scrape-uae-listings.mjs` |
| Ghana PWA — PropertyFinder Gh (opt-in) | `/gh` when `JAB_RE_MARKET=GH` — see [GHANA.md](GHANA.md) |
| PropertyFinder Gh standalone (Vercel) | `apps/fie-ai` — see [apps/fie-ai/README.md](apps/fie-ai/README.md) |

The tree still contains the agency WhatsApp Hub (Evolution + OpenClaw bridge, contacts, campaigns) because that is how the VPS is deployed. The UAE concierge is the `/rent` + `/admin/re` layer on top.

## Local start

```bash
cp .env.example .env   # fill GEMINI_API_KEY and other secrets
docker compose up -d
cd apps/hub && npm install && npm start
```

Then open http://127.0.0.1:3000/rent

Optional seed:

```bash
node scripts/seed-uae-real-estate.mjs
```

## Production host

- Provider: Contabo Cloud VPS 4
- Instance: `vmi3460077` (panel id `203460077`)
- App path on the server: `/opt/jab-hub`
- Data: `/var/lib/jab-hub`
- Do not commit `.env` or `deploy/.vps-password`

Full real-estate setup: [REAL-ESTATE.md](REAL-ESTATE.md).
