set +e
echo "=== host curl 127.0.0.1:8787 ==="
curl -s -o /dev/null -w "127:%{http_code}\n" -m 3 http://127.0.0.1:8787/evolution
echo "=== host curl 172.17.0.1:8787 ==="
curl -s -o /dev/null -w "17217:%{http_code}\n" -m 3 http://172.17.0.1:8787/evolution
echo "=== host curl 172.18.0.1:8787 ==="
curl -s -o /dev/null -w "17218:%{http_code}\n" -m 3 http://172.18.0.1:8787/evolution
echo "=== container wget :3000 ==="
docker exec jabhub_evolution_api wget -T 3 -q -O /dev/null -S http://host.docker.internal:3000/ 2>&1 | head -6
echo "=== container wget :8787 ==="
docker exec jabhub_evolution_api wget -T 3 -q -O /dev/null -S http://host.docker.internal:8787/evolution 2>&1 | head -6
echo "=== ufw ==="
ufw status verbose 2>/dev/null | head -20
echo "=== iptables DOCKER-USER ==="
iptables -L DOCKER-USER -n 2>/dev/null | head -15
echo "=== docker network inspect ==="
docker inspect jabhub_evolution_api --format '{{range .NetworkSettings.Networks}}{{.NetworkID}} {{.Gateway}} {{.IPAddress}}{{end}}'
