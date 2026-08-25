#!/usr/bin/env bash
# Overlay Ghana keys onto a copy of the live Hub .env. Never prints secret values.
set -euo pipefail
SRC="${1:-/opt/jab-hub/.env}"
DST="${2:-/opt/keyfinder-ghana/.env}"
python3 - "$SRC" "$DST" <<'PY'
import sys
from pathlib import Path
src, dst = Path(sys.argv[1]), Path(sys.argv[2])
raw = src.read_text(encoding="utf-8", errors="replace")
env = {}
order = []
for line in raw.splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    k = k.strip()
    if k not in env:
        order.append(k)
    env[k] = v
# Ghana instance — do not inherit UAE listing store or HTTPS redirect.
env["JAB_RE_MARKET"] = "GH"
env["JAB_RE_GH_DEV_PAY"] = "1"
env["JAB_HUB_PORT"] = "3001"
env["JAB_HUB_DATA_DIR"] = "/var/lib/keyfinder-ghana"
env["JAB_HUB_PUBLIC_URL"] = "https://wa.jabdigitalhub.com"
env["JAB_RENT_HTTPS_ORIGIN"] = "https://wa.jabdigitalhub.com"
env["JAB_RE_PUPPETEER_SCRAPE"] = "0"
env["JAB_RE_ZERO_COST_MODE"] = "1"
env["JAB_RE_N8N_SOURCES"] = "meqasa,jiji,ghanapropertycentre,tonaton"
env["JAB_RE_SCRAPE_EMIRATES"] = "Accra,Kumasi,Tema"
env["N8N_LIVE_SEARCH_WEBHOOK"] = "http://127.0.0.1:5678/webhook/gh-live-search"
# Keep Supabase keys from the live Hub copy so Ghana listings land in the same project.
# Do not inherit UAE live-search webhook or Apify portal scrape lists.
for k in (
    "JAB_RE_MARKET",
    "JAB_RE_GH_DEV_PAY",
    "JAB_HUB_PORT",
    "JAB_HUB_DATA_DIR",
    "JAB_HUB_PUBLIC_URL",
    "JAB_RENT_HTTPS_ORIGIN",
    "JAB_RE_N8N_SOURCES",
    "JAB_RE_SCRAPE_EMIRATES",
    "N8N_LIVE_SEARCH_WEBHOOK",
):
    if k not in order:
        order.append(k)
lines = [f"{k}={env[k]}" for k in order if k in env]
dst.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {dst} ({len(lines)} keys)")
PY
chmod 640 "$DST"
chown jabhub:jabhub "$DST"
