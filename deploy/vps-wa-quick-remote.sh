set +e
echo "=== evolution env webhook ==="
docker exec jabhub_evolution_api printenv | grep -E 'WEBHOOK|SERVER_URL' | grep -v KEY
echo "=== getent hosts host.docker.internal ==="
docker exec jabhub_evolution_api getent hosts host.docker.internal 2>&1 || docker exec jabhub_evolution_api cat /etc/hosts | grep -i docker
echo "=== wget hdi timeout 3 ==="
docker exec jabhub_evolution_api wget -T 3 -q -O /dev/null -S http://host.docker.internal:8787/evolution 2>&1 | head -8
echo "=== wget 172.18.0.1 timeout 3 ==="
docker exec jabhub_evolution_api wget -T 3 -q -O /dev/null -S http://172.18.0.1:8787/evolution 2>&1 | head -8
echo "=== bridge grep 30m ==="
journalctl -u jab-hub-bridge --since "30 min ago" --no-pager | grep -iE 'webhook|MessageUpsert|openclaw|invoke|evolution' | tail -20
echo "=== connectionState ==="
ENV_KEY=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | head -1 | cut -d= -f2- | tr -d '\r')
curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/instance/connectionState/jab-whatsapp; echo
