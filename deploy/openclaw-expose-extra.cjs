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
  const cmd = `echo ===NGINX===; grep -rl openclaw /etc/nginx 2>/dev/null | head -5; for f in /etc/nginx/sites-enabled/*; do if grep -q openclaw "$f" 2>/dev/null; then echo FILE:$f; sed -n '1,100p' "$f"; fi; done; echo ===HTTPS===; curl -sk -o /dev/null -w 'oc=%{http_code}\\n' https://oc.jabdigitalhub.com/; curl -sk -o /dev/null -w 'openclaw=%{http_code}\\n' https://openclaw.jabdigitalhub.com/; python3 << 'PYEOF'
import json
d=json.load(open("/home/jabhub/.openclaw/openclaw.json"))
g=d.get("gateway",{})
print("port", g.get("port", 18789))
print("bind", g.get("bind", "127.0.0.1 (inferred)"))
print("mode", g.get("mode"))
cu=g.get("controlUi") or {}
if isinstance(cu, dict):
    print("allowedOrigins", cu.get("allowedOrigins"))
PYEOF`;
  console.log(await run(cmd));
})().catch((e) => { console.error(e); process.exit(1); });
