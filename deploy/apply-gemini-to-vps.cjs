const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

function findKey() {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const t = fs.readFileSync(envPath, "utf8");
    for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
      const m = t.match(new RegExp("^" + k + "=(.+)$", "m"));
      if (m && m[1].trim()) {
        return { source: envPath, keyName: k, key: m[1].trim().replace(/^["']|["']$/g, "") };
      }
    }
  }
  const authPath = path.join(
    process.env.USERPROFILE || "",
    ".openclaw",
    "agents",
    "main",
    "agent",
    "auth-profiles.json"
  );
  if (fs.existsSync(authPath)) {
    const raw = fs.readFileSync(authPath, "utf8").replace(/^\uFEFF/, "");
    const j = JSON.parse(raw);
    const google = j?.profiles?.["google:manual"];
    const key = google?.token || google?.key;
    if (key) return { source: authPath, keyName: "google:manual", key: String(key).trim() };
  }
  return null;
}

const found = findKey();
if (!found) {
  console.error("NOT_FOUND");
  process.exit(2);
}
console.log(
  JSON.stringify({
    source: found.source,
    keyName: found.keyName,
    prefix: found.key.slice(0, 6),
    len: found.key.length
  })
);

const PASS = process.env.VPS_PASSWORD || "";
if (!PASS) {
  console.error("VPS_PASSWORD missing");
  process.exit(1);
}

const remotePy = `
from pathlib import Path
p = Path('/opt/jab-hub/.env')
text = p.read_text(encoding='utf-8', errors='ignore') if p.exists() else ''
lines = text.splitlines()
updates = {
  'GEMINI_API_KEY': ${JSON.stringify(found.key)},
  'GOOGLE_GENERATIVE_AI_API_KEY': ${JSON.stringify(found.key)},
}
out = []
seen = set()
for line in lines:
    matched = False
    for k, v in updates.items():
        if line.startswith(k + '='):
            out.append(k + '=' + v)
            seen.add(k)
            matched = True
            break
    if not matched:
        out.append(line)
for k, v in updates.items():
    if k not in seen:
        if out and out[-1] != '':
            out.append('')
        out.append(k + '=' + v)
p.write_text('\\n'.join(out).rstrip() + '\\n', encoding='utf-8')
print('updated', ','.join(updates.keys()))
`;

function sshExec(conn, cmd) {
  return new Promise((res, rej) => {
    let out = "",
      err = "";
    conn.exec(cmd, (e, stream) => {
      if (e) return rej(e);
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (err += d));
      stream.on("close", (code) =>
        code !== 0 ? rej(new Error((err || out || "exit " + code).trim().slice(0, 3000))) : res(out)
      );
    });
  });
}

(async () => {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on("ready", resolve)
      .on("error", reject)
      .connect({ host: "169.58.81.179", username: "root", password: PASS, readyTimeout: 120000 });
  });
  const b64 = Buffer.from(remotePy, "utf8").toString("base64");
  const out = await sshExec(
    conn,
    `echo ${b64} | base64 -d > /tmp/set-gemini.py && python3 /tmp/set-gemini.py && rm -f /tmp/set-gemini.py`
  );
  console.log(out.trim());
  // verify set without printing value
  const verify = await sshExec(
    conn,
    "grep -E '^(GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY)=' /opt/jab-hub/.env | sed -E 's/=.+/=SET/'"
  );
  console.log("VERIFY\n" + verify.trim());
  await sshExec(conn, "systemctl restart jab-hub-social jab-hub-marketing jab-hub-bridge || true");
  console.log(
    "ACTIVE\n" +
      (await sshExec(conn, "systemctl is-active jab-hub-social jab-hub-marketing jab-hub-bridge || true")).trim()
  );
  conn.end();
  console.log("RESULT: SUCCESS");
})().catch((e) => {
  console.error("RESULT: FAIL");
  console.error(String(e.message || e));
  process.exit(1);
});
