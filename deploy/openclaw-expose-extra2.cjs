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
  const cmd = `grep -r 18789 /opt/jab-hub /etc/systemd 2>/dev/null | grep -v Binary | head -25; echo ---; systemctl show jab-openclaw-gateway -p ActiveState,SubState,MainPID; echo ---; ss -tlnp | grep 443; echo ---; ls /etc/caddy 2>/dev/null; grep -r openclaw /opt/jab-hub/deploy 2>/dev/null | head -15`;
  console.log(await run(cmd));
})().catch((e) => { console.error(e); process.exit(1); });
