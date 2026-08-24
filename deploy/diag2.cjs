const { Client } = require("ssh2");
const VPS_PASSWORD = process.env.VPS_PASSWORD;
function sshExec(cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    conn.on("ready", () => conn.exec(cmd, (e, s) => {
      if (e) return reject(e);
      s.on("close", () => { conn.end(); resolve(stdout); });
      s.on("data", d => stdout += d.toString());
    })).on("error", reject).connect({ host:"169.58.81.179", port:22, username:"root", password:VPS_PASSWORD, readyTimeout:60000 });
  });
}
(async () => {
  const out = await sshExec(`bash -lc 'docker ps --format "{{.Names}}"; echo ---; systemctl cat jab-hub-bridge 2>/dev/null | head -30; echo ---; test -f /opt/jab-hub/.env && wc -c /opt/jab-hub/.env; grep -c AUTHENTICATION_API_KEY /opt/jab-hub/.env || true; echo ---; journalctl -u jab-hub-bridge -n 15 --no-pager; echo ---; curl -s -o /dev/null -w HTTP=%{http_code} http://127.0.0.1:8080/ || true'`);
  console.log(out.replace(/apikey: [^\r\n]+/gi, "apikey: [redacted]"));
})().catch(e => { console.error(e.message); process.exit(1); });
