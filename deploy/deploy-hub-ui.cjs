const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const HOST = "169.58.81.179";
const PASS = process.env.VPS_PASSWORD;
const BASE = "/opt/jab-hub";
const ROOT = path.resolve(__dirname, "..");
const FILES = ["apps/hub/public/index.html", "apps/hub/public/app.js"];
if (!PASS) {
  console.error("FAIL: VPS_PASSWORD not set");
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
        code !== 0 ? rej(new Error((err || out || "exit " + code).trim().slice(0, 2000))) : res(out)
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
    for (const rel of FILES) {
      const local = path.join(ROOT, rel);
      const remote = BASE + "/" + rel.replace(/\\/g, "/");
      const tmp = "/tmp/" + path.basename(rel);
      const tmpLocal = path.join(__dirname, ".tmp-" + path.basename(rel));
      fs.writeFileSync(tmpLocal, fs.readFileSync(local, "utf8").replace(/\r\n/g, "\n"));
      await sftpPut(conn, tmpLocal, tmp);
      await sshExec(conn, `install -o jabhub -g jabhub -m 644 ${JSON.stringify(tmp)} ${JSON.stringify(remote)} && rm -f ${JSON.stringify(tmp)}`);
      try {
        fs.unlinkSync(tmpLocal);
      } catch {}
      console.log("UPLOADED", rel);
    }
    console.log("RESULT: SUCCESS");
  });
})().catch((e) => {
  console.error("RESULT: FAIL");
  console.error(String(e.message || e));
  process.exit(1);
});
