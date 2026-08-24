const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const HOST = "169.58.81.179";

function loadVpsPassword() {
  if (process.env.VPS_PASSWORD) return String(process.env.VPS_PASSWORD).trim();
  const file = path.join(__dirname, ".vps-password");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return "";
}

const PASS = loadVpsPassword();
if (!PASS) {
  console.error("FAIL: VPS_PASSWORD or deploy/.vps-password required");
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

(async () => {
  await withConn(async (conn) => {
    console.log("SERVICE", (await sshExec(conn, "systemctl is-active jab-hub-pa || true")).trim());
    console.log(
      "ENV",
      (await sshExec(
        conn,
        "grep -E '^(TELEGRAM_PA_BOT_TOKEN|TELEGRAM_PA_OWNER_IDS|GEMINI_API_KEY|BRAVE_SEARCH|CURSOR_API_KEY|JAB_PA_CURSOR_)=' /opt/jab-hub/.env | sed 's/=.*/=***/' || true"
      )).trim()
    );
    console.log(
      "LOGS",
      (
        await sshExec(conn, "journalctl -u jab-hub-pa -n 8 --no-pager 2>/dev/null || true")
      ).trim()
    );
  });
})().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
