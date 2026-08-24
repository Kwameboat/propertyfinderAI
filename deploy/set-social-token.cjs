const { Client } = require("ssh2");
const TOKEN = process.env.TELEGRAM_SOCIAL_BOT_TOKEN || "";
const PASS = process.env.VPS_PASSWORD || "";
const HOST = "169.58.81.179";

if (!TOKEN || !PASS) {
  console.error("FAIL: TELEGRAM_SOCIAL_BOT_TOKEN and VPS_PASSWORD required");
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
key = 'TELEGRAM_SOCIAL_BOT_TOKEN'
val = ${JSON.stringify(TOKEN)}
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
has_social = any(l.startswith('TELEGRAM_SOCIAL_APPROVER_IDS=') and l.split('=',1)[1].strip() for l in out)
if not has_social:
    mkt = next((l.split('=',1)[1].strip() for l in out if l.startswith('TELEGRAM_APPROVER_IDS=') and l.split('=',1)[1].strip()), '')
    if mkt:
        replaced = False
        new = []
        for l in out:
            if l.startswith('TELEGRAM_SOCIAL_APPROVER_IDS='):
                new.append('TELEGRAM_SOCIAL_APPROVER_IDS=' + mkt)
                replaced = True
            else:
                new.append(l)
        if not replaced:
            new.append('TELEGRAM_SOCIAL_APPROVER_IDS=' + mkt)
        out = new
p.write_text('\\n'.join(out).rstrip() + '\\n', encoding='utf-8')
text = p.read_text()
print('has_social_token', bool(re.search(r'^TELEGRAM_SOCIAL_BOT_TOKEN=.+', text, re.M)))
print('has_social_approvers', bool(re.search(r'^TELEGRAM_SOCIAL_APPROVER_IDS=.+', text, re.M)))
m = re.search(r'^TELEGRAM_SOCIAL_APPROVER_IDS=(.*)$', text, re.M)
print('approver_len', len((m.group(1) if m else '').strip()))
`;

(async () => {
  await withConn(async (conn) => {
    const b64 = Buffer.from(remotePy, "utf8").toString("base64");
    await sshExec(conn, `echo ${b64} | base64 -d > /tmp/set-social-token.py && python3 /tmp/set-social-token.py && rm -f /tmp/set-social-token.py`);
    console.log("ENV_OK");
    await sshExec(conn, "systemctl daemon-reload");
    await sshExec(conn, "systemctl enable --now jab-hub-social");
    await sshExec(conn, "systemctl restart jab-hub-social");
    console.log("ACTIVE", (await sshExec(conn, "systemctl is-active jab-hub-social")).trim());
    const logs = await sshExec(conn, "journalctl -u jab-hub-social -n 15 --no-pager");
    // redact token if it somehow appears
    console.log(
      "LOGS\n" +
        logs
          .split("\n")
          .slice(-12)
          .map((l) => l.replace(/8951494627:[A-Za-z0-9_-]+/g, "[redacted]"))
          .join("\n")
    );
    console.log("RESULT: SUCCESS");
  });
})().catch((e) => {
  console.error("RESULT: FAIL");
  console.error(String(e.message || e));
  process.exit(1);
});
