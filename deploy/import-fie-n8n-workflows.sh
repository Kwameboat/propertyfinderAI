#!/usr/bin/env bash
# Import FIE AI n8n workflows and deactivate Dar Concierge (UAE) scrape workflows.
set -euo pipefail
ROOT="${1:-/opt/keyfinder-ghana}"
ENV_FILE="${2:-/opt/keyfinder-ghana/.env}"
TOKEN="$(python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import sys
env = {}
for line in Path(sys.argv[1]).read_text(errors="replace").splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k.strip()] = v.strip()
print(env.get("JAB_RE_INGEST_TOKEN") or "")
PY
)"
if [[ -z "$TOKEN" ]]; then
  echo "FAIL: JAB_RE_INGEST_TOKEN missing in $ENV_FILE" >&2
  exit 1
fi
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
for f in \
  "$ROOT/deploy/n8n/re-listings-multi-source.json" \
  "$ROOT/deploy/n8n/re-live-search-rag.json" \
  "$ROOT/deploy/n8n/re-puppeteer-pf-scrape.json" \
  "$ROOT/deploy/n8n/gh-listings-multi-source.json" \
  "$ROOT/deploy/n8n/gh-live-search-rag.json" \
  "$ROOT/deploy/n8n/gh-listings-scrape-all.json"
do
  base="$(basename "$f")"
  python3 - "$f" "$WORKDIR/$base" "$TOKEN" <<'PY'
from pathlib import Path
import sys
src, dst, token = sys.argv[1], sys.argv[2], sys.argv[3]
Path(dst).write_text(Path(src).read_text().replace("REPLACE_WITH_JAB_RE_INGEST_TOKEN", token))
PY
  docker cp "$WORKDIR/$base" jabhub_n8n:/tmp/"$base"
  docker exec jabhub_n8n n8n import:workflow --input=/tmp/"$base"
done
docker exec jabhub_n8n n8n update:workflow --id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 --active=false || true
docker exec jabhub_n8n n8n update:workflow --id=b2c3d4e5-f6a7-8901-bcde-f12345678901 --active=false || true
docker exec jabhub_n8n n8n update:workflow --id=c3d4e5f6-a7b8-9012-cdef-123456789012 --active=false || true
docker exec jabhub_n8n n8n update:workflow --id=d4e5f6a7-b8c9-0123-defa-234567890123 --active=true || true
docker exec jabhub_n8n n8n update:workflow --id=e5f6a7b8-c9d0-1234-efab-345678901234 --active=true || true
docker exec jabhub_n8n n8n update:workflow --id=f6a7b8c9-d0e1-2345-fabc-456789012345 --active=true || true
echo "n8n workflows imported (UAE scrape disabled, FIE AI Ghana active)"
docker exec jabhub_n8n n8n list:workflow
