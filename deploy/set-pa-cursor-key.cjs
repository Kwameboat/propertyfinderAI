/**
 * Set CURSOR_API_KEY for the PA cloud worker on VPS.
 *
 * Usage:
 *   $env:CURSOR_API_KEY = "cursor_..."
 *   node deploy/set-pa-cursor-key.cjs
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const CURSOR_API_KEY = process.env.CURSOR_API_KEY || "";
const HOST = "169.58.81.179";

function loadVpsPassword() {
  if (process.env.VPS_PASSWORD) return String(process.env.VPS_PASSWORD).trim();
  const file = path.join(__dirname, ".vps-password");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return "";
}

const PASS = loadVpsPassword();
if (!CURSOR_API_KEY || !PASS) {
  console.error("FAIL: CURSOR_API_KEY and VPS_PASSWORD (or deploy/.vps-password) required");
  process.exit(1);
}

function withConn(fn) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => fn(conn).then(resolve, reject).finally(() => conn.end()))
      .on("error", reject)
      .connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 120000 });
  });
}

function sshExec(conn, cmd) {
  return new Promise((res, rej) => {
    let out = "",
      err = "";
    conn.exec(cmd, (e, stream) => {
      if (e) return rej(e);
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (err += d));
      stream.on("close", (code) =>
        code !== 0 ? rej(new Error((err || out || "exit " + code).trim().slice(0, 4000))) : res(out)
      );
    });
  });
}

const remotePy = `
from pathlib import Path
p = Path('/opt/jab-hub/.env')
text = p.read_text(encoding='utf-8', errors='ignore')
lines = text.splitlines()
key = 'CURSOR_API_KEY'
val = ${JSON.stringify(CURSOR_API_KEY)}
out = []
found = False
for line in lines:
    if line.startswith(key + '='):
        out.append(key + '=' + val)
        found = True
    else:
        out.append(line)
if not found:
    if out and out[-1] != '':
        out.append('')
    out.append(key + '=' + val)
p.write_text('\\n'.join(out).rstrip() + '\\n', encoding='utf-8')
print('cursor_key_set', True)
`;

(async () => {
  await withConn(async (conn) => {
    const b64 = Buffer.from(remotePy, "utf8").toString("base64");
    await sshExec(conn, `echo ${b64} | base64 -d > /tmp/set-pa-cursor.py && python3 /tmp/set-pa-cursor.py && rm -f /tmp/set-pa-cursor.py`);
    console.log("ENV_OK");
    await sshExec(conn, "systemctl daemon-reload && systemctl restart jab-hub-pa");
    console.log("ACTIVE", (await sshExec(conn, "systemctl is-active jab-hub-pa")).trim());
    console.log("RESULT: SUCCESS");
  });
})().catch((e) => {
  console.error("RESULT: FAIL");
  console.error(String(e.message || e));
  process.exit(1);
});
