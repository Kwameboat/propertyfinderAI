# n8n automation (JAB Hub stack)

[n8n](https://n8n.io/) runs alongside Evolution and Hub for workflow automation — scheduled jobs, webhooks, CRM sync, lead routing, and glue between services without custom code.

## URLs

| Environment | URL |
|---|---|
| Local | http://127.0.0.1:5678 |
| VPS | http://YOUR_VPS_IP:5678 |

Login uses HTTP basic auth from `.env`:

- `N8N_BASIC_AUTH_USER` (default `admin`)
- `N8N_BASIC_AUTH_PASSWORD`

## Start / restart

```bash
# Local or VPS (from repo root)
docker compose up -d n8n

# VPS production overlay
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d n8n
```

Data persists in the Docker volume `n8n_data`.

## Reach other stack services from n8n

n8n runs on the `jabhub-net` Docker network.

| Target | URL from n8n workflows |
|---|---|
| Evolution API | `http://api:8080` |
| Agency Hub (VPS) | `http://host.docker.internal:3000` |
| OpenClaw bridge (VPS) | `http://host.docker.internal:8787` |
| Agency Hub (local Windows/Mac) | `http://host.docker.internal:3000` |

### Evolution example (HTTP Request node)

- **Method:** POST  
- **URL:** `http://api:8080/message/sendText/jab-whatsapp`  
- **Header:** `apikey` = your `AUTHENTICATION_API_KEY` from `.env`  
- **Body (JSON):**

```json
{
  "number": "233XXXXXXXXX",
  "text": "Hello from n8n",
  "linkPreview": false
}
```

### Hub example (HTTP Request node)

Most Hub routes need the agency session cookie. For automation, prefer **Webhook** workflows triggered from Hub or the bridge later, or call Evolution directly for outbound WhatsApp.

Public read endpoints (if exposed) can be hit without auth; write routes use `HUB_ADMIN_PASSWORD` via `/login` cookie — store credentials in n8n **Credentials**.

## Common automation ideas

1. **Lead alert** — Webhook receives new lead JSON → Slack/email/Telegram notify.
2. **CRM sync** — Schedule daily export from Hub contacts → Google Sheets / Airtable.
3. **Follow-up sequences** — Cron + Evolution sendText for non-AI drip messages.
4. **Paystack webhook fan-out** — Duplicate Paystack events to accounting or Notion.
5. **Social posting** — Schedule n8n to POST Hub social preview endpoints after approval.
6. **Ops monitoring** — Cron hits `http://host.docker.internal:8787/health` and alerts if down.
7. **UAE Real Estate scrape** — Multi-source listing ingest → Supabase. See **`deploy/N8N-REAL-ESTATE.md`** and import `deploy/n8n/re-listings-multi-source.json`.

## Webhooks into n8n

1. Create workflow → **Webhook** trigger node.
2. Copy the production URL (uses `N8N_WEBHOOK_URL` from `.env`).
3. Point external services at that URL.

On VPS, `N8N_WEBHOOK_URL` must be the public IP or HTTPS domain, e.g.:

```env
N8N_WEBHOOK_URL=http://YOUR_VPS_IP:5678/
```

For HTTPS later, put Caddy/Nginx in front and set:

```env
N8N_HOST=agents.yourdomain.com
N8N_PROTOCOL=https
N8N_WEBHOOK_URL=https://agents.yourdomain.com/
N8N_SECURE_COOKIE=true
```

## Security notes

- Basic auth is enabled by default (`N8N_BASIC_AUTH_ACTIVE=true`).
- Set a strong `N8N_ENCRYPTION_KEY` in `.env` (installer generates one on VPS).
- UFW opens port `5678` on VPS — restrict by IP or add TLS + auth if exposing publicly.
- Do not commit `.env` or n8n credentials to git.

## Troubleshooting

```bash
docker logs jabhub_n8n --tail 50
docker compose ps n8n
curl -u admin:YOUR_N8N_PASSWORD http://127.0.0.1:5678/healthz
```

If webhooks return localhost URLs, fix `N8N_WEBHOOK_URL` and restart:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d n8n
```
