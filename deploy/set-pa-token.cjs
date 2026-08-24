/**
 * Set TELEGRAM_PA_BOT_TOKEN (+ copy owner id from social/marketing if missing) on VPS.
 *
 *   $env:TELEGRAM_PA_BOT_TOKEN = "..."
 *   $env:VPS_PASSWORD = "..."   # or deploy/.vps-password
 *   node deploy/set-pa-token.cjs
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const TOKEN = process.env.TELEGRAM_PA_BOT_TOKEN || "";
const HOST = "169.58.81.179";

function loadVpsPassword() {
  if (process.env.VPS_PASSWORD) return String(process.env.VPS_PASSWORD).trim();
  const file = path.join(__dirname, ".vps-password");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return "";
}

const PASS = loadVpsPassword();

if (!TOKEN || !PASS) {
  console.error("FAIL: TELEGRAM_PA_BOT_TOKEN and VPS_PASSWORD (or deploy/.vps-password) required");
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
import re
p = Path('/opt/jab-hub/.env')
text = p.read_text(encoding='utf-8', errors='ignore')
lines = text.splitlines()
token_key = 'TELEGRAM_PA_BOT_TOKEN'
owner_key = 'TELEGRAM_PA_OWNER_IDS'
token_val = ${JSON.stringify(TOKEN)}
out = []
found_token = False
for line in lines:
    if line.startswith(token_key + '='):
        out.append(token_key + '=' + token_val)
        found_token = True
    else:
        out.append(line)
if not found_token:
    if out and out[-1] != '':
        out.append('')
    out.append(token_key + '=' + token_val)
has_owner = any(l.startswith(owner_key + '=') and l.split('=',1)[1].strip() for l in out)
if not has_owner:
    for src in ('TELEGRAM_SOCIAL_APPROVER_IDS', 'TELEGRAM_APPROVER_IDS'):
        mkt = next((l.split('=',1)[1].strip() for l in out if l.startswith(src + '=') and l.split('=',1)[1].strip()), '')
        if mkt:
            out.append(owner_key + '=' + mkt.split(',')[0].strip())
            break
p.write_text('\\n'.join(out).rstrip() + '\\n', encoding='utf-8')
text = p.read_text()
print('has_pa_token', bool(re.search(r'^TELEGRAM_PA_BOT_TOKEN=.+', text, re.M)))
print('has_pa_owner', bool(re.search(r'^TELEGRAM_PA_OWNER_IDS=.+', text, re.M)))
`;

(async () => {
  await withConn(async (conn) => {
    const b64 = Buffer.from(remotePy, "utf8").toString("base64");
    await sshExec(conn, `echo ${b64} | base64 -d > /tmp/set-pa-token.py && python3 /tmp/set-pa-token.py && rm -f /tmp/set-pa-token.py`);
    console.log("ENV_OK");
    await sshExec(conn, "systemctl daemon-reload && systemctl enable --now jab-hub-pa && systemctl restart jab-hub-pa");
    console.log("ACTIVE", (await sshExec(conn, "systemctl is-active jab-hub-pa")).trim());
    const logs = await sshExec(conn, "journalctl -u jab-hub-pa -n 12 --no-pager");
    console.log(
      "LOGS\n" +
        logs
          .split("\n")
          .slice(-10)
          .map((l) => l.replace(/\d+:[A-Za-z0-9_-]{20,}/g, "[redacted]"))
          .join("\n")
    );
    console.log("RESULT: SUCCESS");
  });
})().catch((e) => {
  console.error("RESULT: FAIL");
  console.error(String(e.message || e));
  process.exit(1);
});
