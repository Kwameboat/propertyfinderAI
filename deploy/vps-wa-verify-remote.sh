set +e
ENV=/opt/jab-hub/.env
ENV_KEY=$(grep -E '^AUTHENTICATION_API_KEY=' "$ENV" | head -1 | cut -d= -f2- | tr -d '\r')
sleep 3
for i in 1 2 3 4 5 6; do
  CS=$(curl -s -o /tmp/cs.json -w "%{http_code}" -H "apikey: $ENV_KEY" http://127.0.0.1:8080/instance/connectionState/jab-whatsapp)
  echo "try$i http=$CS body=$(cat /tmp/cs.json 2>/dev/null)"
  [ "$CS" = "200" ] && break
  sleep 5
done
echo "=== fetchInstances ==="
curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/instance/fetchInstances | head -c 2000
echo
echo "=== webhook find ==="
curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/webhook/find/jab-whatsapp
echo
echo "=== ss 8787 ==="
ss -tlnp | grep 8787 || echo NOT_LISTENING
docker exec jabhub_evolution_api sh -c 'curl -s -o /dev/null -w "hdi:%{http_code}\n" http://host.docker.internal:8787/evolution' 2>&1
GW=$(docker exec jabhub_evolution_api sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null)
echo "GW=$GW"
[ -n "$GW" ] && docker exec jabhub_evolution_api sh -c "curl -s -o /dev/null -w \"gw:%{http_code}\n\" http://$GW:8787/evolution"
echo "=== env webhook ==="
grep -E '^(WEBHOOK_GLOBAL_URL|JAB_HUB_BRIDGE_URL|SERVER_URL)=' "$ENV"
echo "=== bridge grep 2h ==="
journalctl -u jab-hub-bridge --since "2 hours ago" --no-pager | grep -iE 'MessageUpsert|webhook|openclaw|invoke|error|401|8787|3000' | tail -40
echo "=== bridge tail ==="
journalctl -u jab-hub-bridge --since "2 hours ago" --no-pager | tail -25
echo "=== evolution grep ==="
docker logs jabhub_evolution_api --since 2h 2>&1 | grep -iE 'MessageUpsert|webhook|error|PENDING|8787|3000|ECONNREFUSED' | tail -30
echo "=== evolution tail ==="
docker logs jabhub_evolution_api --since 30m 2>&1 | tail -25
echo "=== openclaw ==="
journalctl -u jab-openclaw-gateway --since "2 hours ago" --no-pager | tail -30
echo "=== ufw ==="
ufw status | head -8
