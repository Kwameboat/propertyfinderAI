set -e
ENV=/opt/jab-hub/.env
cd /opt/jab-hub
echo "=== BEFORE ==="
grep -E '^(WEBHOOK_GLOBAL_URL|WEBHOOK_URL|JAB_HUB_BRIDGE_URL)=' "$ENV"
sed -i 's|^WEBHOOK_GLOBAL_URL=.*|WEBHOOK_GLOBAL_URL=http://host.docker.internal:8787/evolution|' "$ENV"
if grep -q '^WEBHOOK_URL=' "$ENV"; then
  sed -i 's|^WEBHOOK_URL=.*|WEBHOOK_URL=http://host.docker.internal:8787/evolution|' "$ENV"
else
  echo 'WEBHOOK_URL=http://host.docker.internal:8787/evolution' >> "$ENV"
fi
echo "=== AFTER ==="
grep -E '^(WEBHOOK_GLOBAL_URL|WEBHOOK_URL|JAB_HUB_BRIDGE_URL)=' "$ENV"
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --force-recreate api
systemctl restart jab-hub-bridge
sleep 8
ENV_KEY=$(grep -E '^AUTHENTICATION_API_KEY=' "$ENV" | head -1 | cut -d= -f2- | tr -d '\r')
echo "=== connectionState ==="
curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/instance/connectionState/jab-whatsapp
echo
echo "=== fetchInstances ==="
curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/instance/fetchInstances
echo
echo "=== webhook find ==="
curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/webhook/find/jab-whatsapp
echo
echo "=== ss 8787 ==="
ss -tlnp | grep 8787 || echo NOT_LISTENING
docker exec jabhub_evolution_api sh -c 'curl -s -o /dev/null -w "hdi:%{http_code}\n" http://host.docker.internal:8787/evolution' || echo hdi_fail
GW=$(docker exec jabhub_evolution_api sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null)
echo "GW=$GW"
[ -n "$GW" ] && docker exec jabhub_evolution_api sh -c "curl -s -o /dev/null -w \"gw:%{http_code}\n\" http://$GW:8787/evolution" || true
echo "=== bridge logs ==="
journalctl -u jab-hub-bridge --since "2 hours ago" --no-pager | tail -60
echo "=== evolution logs ==="
docker logs jabhub_evolution_api --since 2h 2>&1 | tail -60
echo "=== openclaw ==="
journalctl -u jab-openclaw-gateway --since "2 hours ago" --no-pager | tail -30
echo "=== ufw ==="
ufw status | head -10

