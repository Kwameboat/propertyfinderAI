#!/bin/sh
set -e
cd /evolution

echo "[jab-hub] Ensuring baileys@7.0.0-rc13 (tctoken fix for outbound 463/ERROR)..."
npm install baileys@7.0.0-rc13 --save-exact --no-fund --no-audit >/tmp/baileys-install.log 2>&1 || {
  echo "[jab-hub] baileys install failed:"
  tail -30 /tmp/baileys-install.log
  exit 1
}
grep '"version"' node_modules/baileys/package.json | head -1

# Prefer the image's normal start path
if [ -f dist/main.js ]; then
  echo "[jab-hub] starting dist/main.js"
  exec node dist/main.js
fi
if [ -f package.json ] && grep -q '"start:prod"' package.json; then
  exec npm run start:prod
fi
if [ -f package.json ] && grep -q '"start"' package.json; then
  exec npm run start
fi
exec node dist/main.js
