const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
const PASS = process.env.VPS_PASSWORD || "";
const outDir = path.join(__dirname, ".social-preview");
fs.mkdirSync(outDir, { recursive: true });

function sshExec(conn, cmd) {
  return new Promise((res, rej) => {
    let out = "",
      err = "";
    conn.exec(cmd, (e, stream) => {
      if (e) return rej(e);
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (err += d));
      stream.on("close", (code) =>
        code !== 0 ? rej(new Error((err || out || "exit " + code).trim().slice(0, 5000))) : res(out)
      );
    });
  });
}
function sftpGet(conn, remote, local) {
  return new Promise((res, rej) => {
    conn.sftp((e, sftp) => {
      if (e) return rej(e);
      sftp.fastGet(remote, local, (err) => (err ? rej(err) : res()));
    });
  });
}

(async () => {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on("ready", resolve)
      .on("error", reject)
      .connect({ host: "169.58.81.179", username: "root", password: PASS, readyTimeout: 90000 });
  });

  const env = await sshExec(
    conn,
    "grep -E '^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|JAB_SOCIAL_IMAGE_MODEL)=' /opt/jab-hub/.env | sed -E 's/=.+/=SET/' || true"
  );
  console.log("ENV_KEYS\n" + (env.trim() || "(none)"));

  const logs = await sshExec(
    conn,
    'journalctl -u jab-hub-social --since "2026-07-27 23:27:47" --no-pager | tail -100'
  );
  console.log("LOGS\n" + logs.trim());

  await sftpGet(
    conn,
    "/var/lib/jab-hub/social/flyer-e3a6af4d7d2e-1080.png",
    path.join(outDir, "flyer1.png")
  );
  await sftpGet(
    conn,
    "/var/lib/jab-hub/social/flyer-9396080f098b-1080.png",
    path.join(outDir, "flyer2.png")
  );
  console.log("DOWNLOADED", outDir);
  conn.end();
})().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
