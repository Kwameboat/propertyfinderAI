/**
 * Deploy Personal PA agent to Contabo VPS.
 *
 * Usage (set password in env OR one-line file — never pass on CLI in chat):
 *   PowerShell:  $env:VPS_PASSWORD = Read-Host -AsSecureString ... ; # or from your password manager
 *   Or create:   deploy/.vps-password  (gitignored, single line)
 *   Then:        node deploy/deploy-pa.cjs
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("ssh2");

const HOST = "169.58.81.179";
const USER = "root";
const BASE = "/opt/jab-hub";
const ROOT = path.resolve(__dirname, "..");

function loadVpsPassword() {
  if (process.env.VPS_PASSWORD) return String(process.env.VPS_PASSWORD).trim();
  const file = path.join(__dirname, ".vps-password");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return "";
}

const PASS = loadVpsPassword();

const FILES = [
  "packages/hub-db/pa.mjs",
  "packages/hub-db/index.mjs",
  "packages/pa-prompt.mjs",
  "packages/pa-rag.mjs",
  "packages/pa-cursor.mjs",
  "packages/pa-web.mjs",
  "packages/pa-tools.mjs",
  "packages/marketing-discovery.mjs",
  "scripts/proactive-pa-agent.mjs",
  "deploy/DEPLOY.md",
  "deploy/.env.production.example",
  ".env.example"
];

if (!PASS) {
  console.error("FAIL: set VPS_PASSWORD env var or create deploy/.vps-password (gitignored)");
  process.exit(1);
}

const tgz = path.join(__dirname, ".pa-upload.tgz");
const listFile = path.join(__dirname, ".pa-filelist.txt");
fs.writeFileSync(listFile, FILES.join("\n") + "\n");
execSync(`tar -czf "${tgz}" -T "${listFile}"`, { cwd: ROOT, stdio: "inherit", shell: true });

function withConn(fn) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => fn(conn).then(resolve, reject).finally(() => conn.end()))
      .on("error", reject)
      .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 180000 });
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

function sftpPut(conn, local, remote) {
  return new Promise((res, rej) => {
    conn.sftp((e, sftp) => {
      if (e) return rej(e);
      sftp.fastPut(local, remote, (err) => (err ? rej(err) : res()));
    });
  });
}

(async () => {
  await withConn(async (conn) => {
    await sftpPut(conn, tgz, "/tmp/jab-pa.tgz");
    console.log("UPLOADED archive");
    await sshExec(
      conn,
      `cd ${BASE} && tar -xzf /tmp/jab-pa.tgz && chown -R jabhub:jabhub packages/hub-db/pa.mjs packages/hub-db/index.mjs packages/pa-prompt.mjs packages/pa-rag.mjs packages/pa-cursor.mjs packages/pa-web.mjs packages/pa-tools.mjs packages/marketing-discovery.mjs scripts/proactive-pa-agent.mjs 2>/dev/null; rm -f /tmp/jab-pa.tgz`
    );
    console.log("EXTRACTED");
    await sshExec(
      conn,
      "mkdir -p /var/lib/jab-hub/pa/docs && chown -R jabhub:jabhub /var/lib/jab-hub/pa"
    );
    const unit = `[Unit]
Description=JAB Hub personal PA agent
After=network.target

[Service]
Type=simple
User=jabhub
WorkingDirectory=/opt/jab-hub
EnvironmentFile=/opt/jab-hub/.env
ExecStart=/usr/bin/node /opt/jab-hub/scripts/proactive-pa-agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
    await sshExec(conn, "cat > /etc/systemd/system/jab-hub-pa.service << 'EOF'\n" + unit + "EOF\n");
    await sshExec(
      conn,
      "grep -q '^JAB_PA_TZ=' /opt/jab-hub/.env || echo 'JAB_PA_TZ=Africa/Accra' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_PA_DAILY_BRIEF_HOUR=' /opt/jab-hub/.env || echo 'JAB_PA_DAILY_BRIEF_HOUR=6' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_PA_CURSOR_REPO_URL=' /opt/jab-hub/.env || echo 'JAB_PA_CURSOR_REPO_URL=https://github.com/Kwameboat/jab-hub.git' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_PA_CURSOR_BRANCH=' /opt/jab-hub/.env || echo 'JAB_PA_CURSOR_BRANCH=master' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_PA_CURSOR_MODEL=' /opt/jab-hub/.env || echo 'JAB_PA_CURSOR_MODEL=composer-2.5' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_PA_CURSOR_AUTO_PR=' /opt/jab-hub/.env || echo 'JAB_PA_CURSOR_AUTO_PR=0' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_HUB_DATA_DIR=' /opt/jab-hub/.env || echo 'JAB_HUB_DATA_DIR=/var/lib/jab-hub' >> /opt/jab-hub/.env; true"
    );
    await sshExec(conn, "systemctl daemon-reload");
    const hasToken = (
      await sshExec(
        conn,
        "grep -E '^TELEGRAM_PA_BOT_TOKEN=.+' /opt/jab-hub/.env | grep -v 'TOKEN=$' | head -1 || true"
      )
    ).trim();
    if (hasToken && !hasToken.endsWith("=")) {
      await sshExec(conn, "systemctl enable --now jab-hub-pa");
      await sshExec(conn, "systemctl restart jab-hub-pa");
      console.log("PA", (await sshExec(conn, "systemctl is-active jab-hub-pa || true")).trim());
    } else {
      console.log("PA skipped — add TELEGRAM_PA_BOT_TOKEN to /opt/jab-hub/.env then: systemctl enable --now jab-hub-pa");
    }
    const smoke = await sshExec(
      conn,
      "cd /opt/jab-hub && sudo -u jabhub env JAB_HUB_DATA_DIR=/var/lib/jab-hub node -e " +
        JSON.stringify(
          "import('./packages/hub-db/index.mjs').then(m=>{m.openHubDb(); console.log('ok', typeof m.createPaTask);}).catch(e=>{console.error(e.message); process.exit(1);})"
        )
    );
    console.log("SMOKE", smoke.trim());
    console.log("RESULT: SUCCESS");
  });
  try {
    fs.unlinkSync(tgz);
    fs.unlinkSync(listFile);
  } catch {}
})().catch((e) => {
  console.error("RESULT: FAIL");
  console.error(String(e.message || e));
  process.exit(1);
});
