const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("ssh2");
const HOST = "169.58.81.179";
const USER = "root";
const PASS = process.env.VPS_PASSWORD;
const BASE = "/opt/jab-hub";
const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "packages/hub-db/social.mjs",
  "packages/hub-db/index.mjs",
  "packages/social-prompt.mjs",
  "packages/social-media-gen.mjs",
  "packages/social-briefing.mjs",
  "packages/social-stock.mjs",
  "packages/social-postermywall.mjs",
  "packages/social-publishers/creds.mjs",
  "packages/social-publishers/meta.mjs",
  "packages/social-publishers/tiktok.mjs",
  "packages/social-publishers/x.mjs",
  "packages/social-publishers/linkedin.mjs",
  "packages/social-publishers/youtube.mjs",
  "packages/social-publishers/index.mjs",
  "scripts/proactive-social-agent.mjs",
  "apps/hub/server.mjs",
  "apps/hub/public/index.html",
  "apps/hub/public/app.js",
  "deploy/DEPLOY.md",
  "deploy/.env.production.example",
  ".env.example",
];
if (!PASS) {
  console.error("FAIL: VPS_PASSWORD not set");
  process.exit(1);
}

const tgz = path.join(__dirname, ".social-upload.tgz");
const listFile = path.join(__dirname, ".social-filelist.txt");
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
    await sftpPut(conn, tgz, "/tmp/jab-social.tgz");
    console.log("UPLOADED archive");
    await sshExec(
      conn,
      `cd ${BASE} && tar -xzf /tmp/jab-social.tgz && chown -R jabhub:jabhub packages/hub-db packages/social-prompt.mjs packages/social-media-gen.mjs packages/social-briefing.mjs packages/social-stock.mjs packages/social-postermywall.mjs packages/social-publishers scripts/proactive-social-agent.mjs apps/hub/server.mjs apps/hub/public/index.html apps/hub/public/app.js 2>/dev/null; rm -f /tmp/jab-social.tgz`
    );
    console.log("EXTRACTED");
    await sshExec(conn, "DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg >/tmp/ffmpeg-install.log 2>&1 || true");
    console.log("FFMPEG", (await sshExec(conn, "ffmpeg -version 2>&1 | head -1")).trim());
    const unit = `[Unit]
Description=JAB Hub social media agent
After=network.target

[Service]
Type=simple
User=jabhub
WorkingDirectory=/opt/jab-hub
EnvironmentFile=/opt/jab-hub/.env
ExecStart=/usr/bin/node /opt/jab-hub/scripts/proactive-social-agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
    await sshExec(conn, "cat > /etc/systemd/system/jab-hub-social.service << 'EOF'\n" + unit + "EOF\n");
    await sshExec(
      conn,
      "grep -q '^JAB_SOCIAL_DRY_RUN=' /opt/jab-hub/.env || echo 'JAB_SOCIAL_DRY_RUN=1' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_SOCIAL_PUBLIC_MEDIA_BASE=' /opt/jab-hub/.env || echo 'JAB_SOCIAL_PUBLIC_MEDIA_BASE=http://169.58.81.179:3000/media/social' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_HUB_PUBLIC_URL=' /opt/jab-hub/.env || echo 'JAB_HUB_PUBLIC_URL=http://169.58.81.179:3000' >> /opt/jab-hub/.env; " +
        "grep -q '^JAB_SOCIAL_IMAGE_MODEL=' /opt/jab-hub/.env || echo 'JAB_SOCIAL_IMAGE_MODEL=gemini-2.5-flash-image' >> /opt/jab-hub/.env; true"
    );
    await sshExec(conn, "systemctl daemon-reload && systemctl restart jab-hub-dashboard");
    const hasToken = (
      await sshExec(
        conn,
        "grep -E '^TELEGRAM_SOCIAL_BOT_TOKEN=.+' /opt/jab-hub/.env | grep -v 'TOKEN=$' | head -1 || true"
      )
    ).trim();
    if (hasToken && !hasToken.endsWith("=")) {
      await sshExec(conn, "systemctl enable --now jab-hub-social");
      console.log("SOCIAL", (await sshExec(conn, "systemctl is-active jab-hub-social || true")).trim());
    } else {
      console.log("SOCIAL skipped — add TELEGRAM_SOCIAL_BOT_TOKEN to /opt/jab-hub/.env then enable jab-hub-social");
    }
    console.log("DASHBOARD", (await sshExec(conn, "systemctl is-active jab-hub-dashboard")).trim());
    const smoke = await sshExec(
      conn,
      "cd /opt/jab-hub && sudo -u jabhub env JAB_HUB_DATA_DIR=/var/lib/jab-hub node -e " +
        JSON.stringify(
          "import('./packages/hub-db/index.mjs').then(m=>{m.openHubDb(); console.log('ok', typeof m.createSocialPost);}).catch(e=>{console.error(e.message); process.exit(1);})"
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
