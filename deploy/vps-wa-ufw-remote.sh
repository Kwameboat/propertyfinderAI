set +e
ufw allow 8787/tcp comment 'jab-hub-bridge from Evolution'
ufw status | grep 8787
echo "=== container wget :8787 after ufw ==="
docker exec jabhub_evolution_api wget -T 5 -q -O /dev/null -S http://host.docker.internal:8787/evolution 2>&1 | head -10
echo "=== simulate POST from container ==="
docker exec jabhub_evolution_api wget -T 5 -q -O - --post-data='{"event":"test"}' --header='Content-Type: application/json' http://host.docker.internal:8787/evolution 2>&1 | head -5
