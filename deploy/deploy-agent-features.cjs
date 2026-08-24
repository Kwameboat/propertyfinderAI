const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const HOST = "169.58.81.179";
const USER = "root";
const PASS = process.env.VPS_PASSWORD;
const BASE = "/opt/jab-hub";
const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "packages/hub-db/agents-features.mjs",
  "packages/hub-db/index.mjs",
  "packages/hub-db/marketing.mjs",
  "packages/agency-growth-prompt.mjs",
  "apps/hub/server.mjs",
  "apps/hub/public/index.html",
  "apps/hub/public/app.js",
  "scripts/evolution-openclaw-bridge.mjs",
  "scripts/proactive-marketing-agent.mjs",
];
if (!PASS) { console.error("FAIL: VPS_PASSWORD not set"); process.exit(1); }
function withConn(fn) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => fn(conn).then(resolve, reject).finally(() => conn.end())).on("error", reject)
      .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 120000 });
  });
}
function sshExec(conn, cmd) {
  return new Promise((res, rej) => {
    let out = "", err = "";
    conn.exec(cmd, (e, stream) => {
      if (e) return rej(e);
      stream.on("data", d => out += d);
      stream.stderr.on("data", d => err += d);
      stream.on("close", code => code !== 0 ? rej(new Error((err || out || "exit " + code).trim().slice(0, 4000))) : res(out));
    });
  });
}
function sftpPut(conn, local, remote) {
  return new Promise((res, rej) => {
    conn.sftp((e, sftp) => { if (e) return rej(e); sftp.fastPut(local, remote, err => err ? rej(err) : res()); });
  });
}
function toLf(content) { return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); }
(async () => {
  await withConn(async conn => {
    for (const rel of FILES) {
      const local = path.join(ROOT, rel);
      if (!fs.existsSync(local)) throw new Error("missing local: " + rel);
      const remote = BASE + "/" + rel.replace(/\\/g, "/");
      const dir = remote.replace(/\/[^/]+$/, "");
      await sshExec(conn, "mkdir -p " + JSON.stringify(dir));
      const tmpLocal = path.join(__dirname, ".deploy-tmp-" + path.basename(rel));
      fs.writeFileSync(tmpLocal, toLf(fs.readFileSync(local, "utf8")));
      const tmp = "/tmp/jab-deploy-" + path.basename(rel);
      await sftpPut(conn, tmpLocal, tmp);
      await sshExec(conn, "install -o jabhub -g jabhub -m 644 " + JSON.stringify(tmp) + " " + JSON.stringify(remote) + " && rm -f " + JSON.stringify(tmp));
      try { fs.unlinkSync(tmpLocal); } catch {}
      console.log("UPLOADED", rel);
    }
    const envCheck = await sshExec(conn, "grep -E '^(EnvironmentFile|Environment=)' /etc/systemd/system/jab-hub-dashboard.service 2>/dev/null || true");
    console.log("DASHBOARD_ENV_LINES", envCheck.trim());
    let dataDir = "";
    const ef = envCheck.match(/EnvironmentFile=(.+)/);
    if (ef) {
      const efPath = ef[1].trim();
      const fromFile = await sshExec(conn, "grep -E '^JAB_HUB_DATA_DIR=' " + JSON.stringify(efPath) + " 2>/dev/null | tail -1 || true");
      const m = fromFile.match(/JAB_HUB_DATA_DIR=(.*)/);
      if (m) dataDir = m[1].trim().replace(/^["']|["']$/g, "");
    }
    console.log("JAB_HUB_DATA_DIR", dataDir || "(default from app)");
    await sshExec(conn, "systemctl restart jab-hub-dashboard jab-hub-bridge jab-hub-marketing");
    console.log("IS_ACTIVE\n" + (await sshExec(conn, "systemctl is-active jab-hub-dashboard jab-hub-bridge jab-hub-marketing")).trim());
    const smokeEnv = dataDir ? "JAB_HUB_DATA_DIR=" + JSON.stringify(dataDir) + " " : "";
    const smoke = await sshExec(conn, "cd " + BASE + " && sudo -u jabhub env " + smokeEnv + "node -e " + JSON.stringify("import('./packages/hub-db/index.mjs').then(m=>{m.openHubDb(); console.log('migrate ok', typeof m.formatKnowledgeForAgent, typeof m.listInboxThreads);}).catch(e=>{console.error(e.message); process.exit(1);})"));
    console.log("SMOKE\n" + smoke.trim());
    console.log("RESULT: SUCCESS");
  });
})().catch(e => { console.error("RESULT: FAIL"); console.error(String(e.message || e)); process.exit(1); });

