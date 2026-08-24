const { Client } = require("ssh2");
const PW = process.env.VPS_PASSWORD;
function sshExec(cmd, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let o = "", e = "";
    const t = setTimeout(() => { conn.end(); reject(new Error("timeout")); }, timeoutMs);
    conn.on("ready", () => conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(t); return reject(err); }
      stream.on("close", (code) => { clearTimeout(t); conn.end(); resolve({ code, out: o, err: e }); });
      stream.on("data", d => { o += d.toString(); });
      stream.stderr.on("data", d => { e += d.toString(); });
    })).on("error", err => { clearTimeout(t); reject(err); })
    .connect({ host: "169.58.81.179", port: 22, username: "root", password: PW, readyTimeout: 60000 });
  });
}
function redact(s) {
  return String(s).replace(/(apikey|token|secret|password|Bearer)[=: ]["']?[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(AUTHENTICATION_API_KEY)=[^\n]+/gi, "$1=[REDACTED]");
}
const fixAndVerify = [
"set -e",
"ENV=/opt/jab-hub/.env",
"cd /opt/jab-hub",
'echo "=== BEFORE ==="',
'grep -E "^(WEBHOOK_GLOBAL_URL|WEBHOOK_URL|JAB_HUB_BRIDGE_URL)=" "$ENV" || true',
'for var in WEBHOOK_GLOBAL_URL WEBHOOK_URL; do',
'  if grep -q "^${var}=" "$ENV"; then',
'    sed -i "s|^${var}=.*|${var}=http://host.docker.internal:8787/evolution|" "$ENV"',
'  else',
'    echo "${var}=http://host.docker.internal:8787/evolution" >> "$ENV"',
'  fi',
'done',
'grep -q "^JAB_HUB_BRIDGE_URL=" "$ENV" || echo "JAB_HUB_BRIDGE_URL=http://host.docker.internal:8787/evolution" >> "$ENV"',
'echo "=== AFTER ==="',
'grep -E "^(WEBHOOK_GLOBAL_URL|WEBHOOK_URL|JAB_HUB_BRIDGE_URL)=" "$ENV"',
'if [ -f docker-compose.yml ] && [ -f deploy/docker-compose.prod.yml ]; then docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --force-recreate api; else docker compose up -d --force-recreate api; fi',
"systemctl restart jab-hub-bridge",
"sleep 5",
'ENV_KEY=$(grep -E "^AUTHENTICATION_API_KEY=" "$ENV" | head -1 | cut -d= -f2- | tr -d "\\r" | sed "s/^[\"'"'"'\"]//;s/[\"'"'"'\"]$//")',
'echo "=== connectionState ==="',
'curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/instance/connectionState/jab-whatsapp; echo',
'echo "=== fetchInstances ==="',
'curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/instance/fetchInstances | head -c 1500; echo',
'echo "=== webhook find ==="',
'curl -s -H "apikey: $ENV_KEY" http://127.0.0.1:8080/webhook/find/jab-whatsapp; echo',
'echo "=== ss 8787 ==="',
'ss -tlnp | grep 8787 || echo NOT_LISTENING',
"docker exec jabhub_evolution_api sh -c 'curl -s -o /dev/null -w hdi:%{http_code} http://host.docker.internal:8787/evolution' || echo hdi_fail",
'GW=$(docker exec jabhub_evolution_api sh -c "ip route | awk \\"/default/{print \\\\\\$3}\\"" 2>/dev/null)',
'echo GW=$GW',
'[ -n "$GW" ] && docker exec jabhub_evolution_api sh -c "curl -s -o /dev/null -w gw:%{http_code} http://$GW:8787/evolution" || true',
'echo "=== bridge journal (2h tail) ==="',
'journalctl -u jab-hub-bridge --since "2 hours ago" --no-pager | tail -50',
'echo "=== evolution logs (2h) ==="',
'docker logs jabhub_evolution_api --since 2h 2>&1 | tail -50',
'echo "=== openclaw gateway ==="',
'journalctl -u jab-openclaw-gateway --since "2 hours ago" --no-pager | tail -30',
'echo "=== ufw ==="',
'ufw status | head -10',
].join("\n");
(async () => {
  const r = await sshExec(fixAndVerify);
  console.log(redact(r.out));
  if (r.err) console.error(redact(r.err));
  process.exit(r.code || 0);
})().catch(e => { console.error(e.message); process.exit(1); });
