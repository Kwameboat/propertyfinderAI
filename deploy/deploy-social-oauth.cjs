const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("ssh2");
const HOST = "169.58.81.179";
const PASS = process.env.VPS_PASSWORD;
const BASE = "/opt/jab-hub";
const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "packages/social-oauth.mjs",
  "packages/social-publishers/creds.mjs",
  "packages/social-publishers/x.mjs",
  "apps/hub/server.mjs",
  "apps/hub/public/index.html",
  "apps/hub/public/app.js",
  "deploy/.env.production.example",
];
if (!PASS) {
  console.error("FAIL: VPS_PASSWORD not set");
  process.exit(1);
}
const tgz = path.join(__dirname, ".oauth-upload.tgz");
const listFile = path.join(__dirname, ".oauth-filelist.txt");
fs.writeFileSync(listFile, FILES.join("\n") + "\n");
execSync(`tar -czf "${tgz}" -T "${listFile}"`, { cwd: ROOT, stdio: "inherit", shell: true });

function withConn(fn) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => fn(conn).then(resolve, reject).finally(() => conn.end()))
      .on("error", reject)
      .connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 180000 });
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
    await sftpPut(conn, tgz, "/tmp/jab-oauth.tgz");
    await sshExec(
      conn,
      `cd ${BASE} && tar -xzf /tmp/jab-oauth.tgz && chown -R jabhub:jabhub packages/social-oauth.mjs packages/social-publishers apps/hub && rm -f /tmp/jab-oauth.tgz`
    );
    await sshExec(conn, "systemctl restart jab-hub-dashboard");
    console.log("DASHBOARD", (await sshExec(conn, "systemctl is-active jab-hub-dashboard")).trim());
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
