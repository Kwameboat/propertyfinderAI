# Free Jiji scraper (no paid proxy)

Jiji sits behind Cloudflare’s **Managed Challenge**. Plain `fetch` from Vercel/GitHub datacenter IPs gets `403 Just a moment…`.

PropertyFinder Gh supports **two free paths**:

## 1) Browser cookie (best for Vercel)

1. On your laptop, open [jiji.com.gh](https://jiji.com.gh) in Chrome until listings load.
2. DevTools → **Application** → **Cookies** → `https://jiji.com.gh`
3. Copy `cf_clearance` (and optionally `__cf_bm`).
4. Note your Chrome user-agent (`chrome://version`).
5. Set on Vercel:

```bash
JIJI_CF_CLEARANCE=...your_clearance...
JIJI_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36
# or full cookie header:
# JIJI_COOKIE=cf_clearance=...; __cf_bm=...
```

When set, cron ticks **include `jiji`** automatically. Refresh the cookie when scrapes start failing with “cookie expired”.

## 2) GitHub Actions + FlareSolverr (fully automatic, free)

Workflow: [`.github/workflows/fie-ghana-scrape.yml`](../../.github/workflows/fie-ghana-scrape.yml)

- Runs every 6 hours (and on manual dispatch)
- Starts **FlareSolverr** as a free Actions service container
- Scrapes `ghanapropertycentre`, `jiji`, `meqasa` → Supabase

Repo secrets:

| Secret | Required |
|--------|----------|
| `SUPABASE_URL` | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | yes |
| `JIJI_CF_CLEARANCE` | optional |
| `JIJI_USER_AGENT` | optional |

## Local test

```bash
cd apps/fie-ai
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
export JIJI_CF_CLEARANCE=... JIJI_USER_AGENT=...
# or: export FLARESOLVERR_URL=http://127.0.0.1:8191
node scripts/scrape-to-supabase.mjs --source=jiji --city=Accra --type=rent
```
