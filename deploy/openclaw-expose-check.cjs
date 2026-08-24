const { Client } = require("ssh2");
const PW = process.env.VPS_PASSWORD;
function run(cmd) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let o = "";
    c.on("ready", () =>
      c.exec(cmd, (e, s) => {
        if (e) return reject(e);
        s.on("data", (d) => { o += d; });
        s.stderr.on("data", (d) => { o += d; });
        s.on("close", () => { c.end(); resolve(o); });
      })
    );
    c.on("error", reject);
    c.connect({ host: "169.58.81.179", username: "root", password: PW, readyTimeout: 30000 });
  });
}
(async () => {
  const sections = [
    ["SYSTEMD", "systemctl cat jab-openclaw-gateway 2>/dev/null | head -40"],
    ["SS", "ss -tlnp 2>/dev/null | grep -E 'openclaw|node|18789|1879|1878|3000|8080' || ss -tlnp 2>/dev/null | head -35"],
    ["CONFIG", `python3 << 'PYEOF'
import json
try:
    with open('/home/jabhub/.openclaw/openclaw.json') as f:
        d = json.load(f)
    g = d.get('gateway') or {}
    def skip(k):
        kl = k.lower()
        return any(x in kl for x in ('token','secret','password','apikey','api_key','key'))
    out = {}
    for k, v in g.items():
        if skip(k):
            continue
        if k == 'controlUi' and isinstance(v, dict):
            out[k] = {kk: vv for kk, vv in v.items() if not skip(kk)}
        else:
            out[k] = v
    print(json.dumps(out, indent=2))
except Exception as e:
    print('ERR:', e)
PYEOF`],
    ["UFW", "ufw status verbose 2>/dev/null || ufw status 2>/dev/null || echo ufw-not-found"],
    ["CURL", `PORT=$(python3 -c "import json; g=json.load(open('/home/jabhub/.openclaw/openclaw.json')).get('gateway',{}); print(g.get('port',18789))" 2>/dev/null); echo GATEWAY_PORT=$PORT; curl -s -o /dev/null -w 'LOCAL_HTTP=%{http_code}' http://127.0.0.1:$PORT/; echo; curl -s -o /dev/null -w 'PUBLIC_HTTP=%{http_code}' http://169.58.81.179:$PORT/ 2>/dev/null; echo`],
  ];
  for (const [label, cmd] of sections) {
    console.log("=== " + label + " ===");
    console.log(await run(cmd));
  }
})().catch((e) => { console.error(e); process.exit(1); });
