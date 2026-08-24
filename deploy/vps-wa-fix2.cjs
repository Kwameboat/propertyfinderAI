const fs = require("fs");
const { Client } = require("ssh2");
const PW = process.env.VPS_PASSWORD;
const sh = fs.readFileSync(__dirname + "/vps-wa-fix-remote.sh", "utf8");
function sshExec(script) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let o = "", e = "";
    conn.on("ready", () => {
      conn.exec("bash -s", (err, stream) => {
        if (err) return reject(err);
        stream.on("close", (code) => { conn.end(); resolve({ code, out: o, err: e }); });
        stream.on("data", d => { o += d.toString(); });
        stream.stderr.on("data", d => { e += d.toString(); });
        stream.end(script);
      });
    }).on("error", reject).connect({ host: "169.58.81.179", port: 22, username: "root", password: PW, readyTimeout: 120000 });
  });
}
function redact(s) {
  return String(s).replace(/(apikey|token|secret|password|Bearer)[=: ]["']?[^\s"']+/gi, "$1[REDACTED]");
}
(async () => {
  const r = await sshExec(sh);
  console.log(redact(r.out));
  if (r.err) console.error(redact(r.err));
  process.exit(r.code || 0);
})().catch(e => { console.error(e.message); process.exit(1); });
