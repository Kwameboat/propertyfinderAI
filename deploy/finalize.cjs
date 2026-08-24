const { Client } = require("ssh2");
const VPS_PASSWORD = process.env.VPS_PASSWORD;
function put(local, remote) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on("ready", () => c.sftp((e, s) => {
      if (e) return reject(e);
      s.fastPut(local, remote, (err) => { c.end(); err ? reject(err) : resolve(); });
    })).on("error", reject).connect({ host: "169.58.81.179", port: 22, username: "root", password: VPS_PASSWORD, readyTimeout: 60000 });
  });
}
function run(cmd) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let o = "";
    c.on("ready", () => c.exec(cmd, (e, s) => {
      if (e) return reject(e);
      s.on("close", () => { c.end(); resolve(o); });
      s.on("data", (d) => { o += d.toString(); });
    })).on("error", reject).connect({ host: "169.58.81.179", port: 22, username: "root", password: VPS_PASSWORD, readyTimeout: 60000 });
  });
}
(async () => {
  if (!VPS_PASSWORD) throw new Error("VPS_PASSWORD");
  await put("remote-env-bom.js", "/tmp/remote-env-bom.js");
  console.log((await run("node /tmp/remote-env-bom.js")).trim());
  console.log((await run("test -f /home/jabhub/.openclaw/agents/main/agent/auth-profiles.json && echo AUTH_PROFILES=yes || echo AUTH_PROFILES=no")).trim());
  await new Promise((r) => setTimeout(r, 35000));
  console.log((await run("journalctl -u jab-hub-bridge -n 12 --no-pager | grep 401 >/dev/null && echo HAS401=yes || echo HAS401=no")).trim());
  const sync = await run("journalctl -u jab-hub-bridge -n 5 --no-pager | grep sync || true");
  console.log(sync.trim());
})().catch((e) => { console.error(e.message); process.exit(1); });
