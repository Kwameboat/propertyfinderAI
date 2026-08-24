const { Client } = require("ssh2");
const PW = process.env.VPS_PASSWORD;
if (!PW) { console.error("Set VPS_PASSWORD"); process.exit(1); }
function sshExec(cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let o = "", e = "";
    conn.on("ready", () => conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on("close", (code) => { conn.end(); resolve({ code, out: o, err: e }); });
      stream.on("data", d => { o += d.toString(); });
      stream.stderr.on("data", d => { e += d.toString(); });
    })).on("error", reject).connect({ host: "169.58.81.179", port: 22, username: "root", password: PW, readyTimeout: 60000 });
  });
}
function redact(s) {
  return String(s)
    .replace(/(apikey|token|secret|password|Bearer)[=: ]["']?[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(AUTHENTICATION_API_KEY|EVO_GLOBAL_KEY|OPENCLAW)[=: ][^\n]+/gi, "$1=[REDACTED]");
}
const sh = String.raw`bash -s <<'REMOTE_EOF'
set +e
echo "=== ENV WEBHOOK/BRIDGE ==="
grep -E '^(WEBHOOK_|SERVER_URL|JAB_HUB_BRIDGE)' /opt/jab-hub/.env | sed -E 's/(API_KEY|TOKEN|SECRET|PASSWORD)=.*/\1=[REDACTED]/i'

AUTH=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | cut -d= -f2- | tr -d '"'"'"'"'"'"'"'"')
echo "=== connectionState jab-whatsapp ==="
curl -s -H "apikey: $AUTH" http://127.0.0.1:8080/instance/connectionState/jab-whatsapp
echo
echo "=== fetchInstances ==="
curl -s -H "apikey: $AUTH" http://127.0.0.1:8080/instance/fetchInstances
echo
echo "=== webhook find ==="
curl -s -H "apikey: $AUTH" http://127.0.0.1:8080/webhook/find/jab-whatsapp
echo
echo "=== ss 8787 ==="
ss -tlnp | grep 8787 || echo NOT_LISTENING
EVOL=jabhub_evolution_api
docker exec $EVOL sh -c 'curl -s -o /dev/null -w "hdi:%{http_code}\n" http://host.docker.internal:8787/evolution' 2>/dev/null
GW=$(docker exec $EVOL sh -c "ip route | awk '/default/{print \$3}'" 2>/dev/null)
echo "GW=$GW"
[ -n "$GW" ] && docker exec $EVOL sh -c "curl -s -o /dev/null -w \"gw:%{http_code}\n\" http://$GW:8787/evolution"
echo "=== grep logs keywords bridge ==="
journalctl -u jab-hub-bridge --since "2 hours ago" --no-pager | tail -80 | grep -iE 'MessageUpsert|webhook|openclaw|invoke|sendText|error|PENDING|401|8787' || journalctl -u jab-hub-bridge --since "2 hours ago" --no-pager | tail -80
echo "=== evolution logs ==="
docker logs jabhub_evolution_api --since 2h 2>&1 | tail -80 | grep -iE 'MessageUpsert|webhook|error|PENDING|8787|host.docker' || docker logs jabhub_evolution_api --since 2h 2>&1 | tail -80
echo "=== openclaw gateway ==="
journalctl -u jab-openclaw-gateway --since "2 hours ago" --no-pager | tail -40
echo "=== ufw ==="
ufw status | head -15
REMOTE_EOF`;
(async () => {
  const r = await sshExec(sh);
  console.log(redact(r.out));
  if (r.err) console.error(redact(r.err));
})().catch(e => { console.error(e.message); process.exit(1); });