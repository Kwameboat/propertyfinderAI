set +e
echo "=== evolution env webhook ==="
docker exec jabhub_evolution_api printenv | grep -E 'WEBHOOK|SERVER_URL' | grep -v KEY
echo "=== wget hdi ==="
docker exec jabhub_evolution_api wget -q -O - -S http://host.docker.internal:8787/evolution 2>&1 | head -5
echo "=== wget gw ==="
docker exec jabhub_evolution_api wget -q -O /dev/null -S http://172.18.0.1:8787/evolution 2>&1 | head -5
echo "=== evolution webhook errors 2h ==="
docker logs jabhub_evolution_api --since 2h 2>&1 | grep -iE 'webhook|8787|3000|ECONN|axios|fetch failed|MessageUpsert' | tail -40
echo "=== bridge webhook/openclaw 30m ==="
journalctl -u jab-hub-bridge --since "30 min ago" --no-pager | grep -iE 'webhook|MessageUpsert|openclaw|invoke|incoming|POST /evolution' | tail -30
echo "=== connectionState ==="
ENV_KEY=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | head -1 | cut -d= -f2- | tr -d '\r')
curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/instance/connectionState/jab-whatsapp
echo
