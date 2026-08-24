/**
 * Start or update n8n on the VPS (Docker Compose).
 * Requires VPS_PASSWORD in the environment.
 *
 *   node deploy/deploy-n8n.cjs
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const HOST = process.env.VPS_HOST || "169.58.81.179";
const PASS = process.env.VPS_PASSWORD;
const BASE = process.env.JAB_HUB_APP_DIR || "/opt/jab-hub";
const ROOT = path.resolve(__dirname, "..");

const UPLOAD = [
  "docker-compose.yml",
  "deploy/docker-compose.prod.yml",
  "deploy/N8N.md"
];

if (!PASS) {
  console.error("FAIL: set VPS_PASSWORD (and optionally VPS_HOST)");
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

function sshExec(conn, cmd, timeoutMs = 600000) {
  return new Promise((res, rej) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => rej(new Error("SSH timeout")), timeoutMs);
    conn.exec(cmd, (e, stream) => {
      if (e) {
        clearTimeout(timer);
        return rej(e);
      }
      stream.on("data", (d) => {
        out += d;
        process.stdout.write(d);
      });
      stream.stderr.on("data", (d) => {
        err += d;
        process.stderr.write(d);
      });
      stream.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          rej(new Error((err || out || `exit ${code}`).trim().slice(0, 3000)));
          return;
        }
        res(out);
      });
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

async function uploadFile(conn, rel) {
  const local = path.join(ROOT, rel);
  if (!fs.existsSync(local)) {
    throw new Error(`missing local file: ${rel}`);
  }
  const remoteDir = path.posix.dirname(`${BASE}/${rel.replace(/\\/g, "/")}`);
  const tmp = `/tmp/jab-n8n-${path.basename(rel)}`;
  const remote = `${BASE}/${rel.replace(/\\/g, "/")}`;
  const tmpLocal = path.join(__dirname, `.tmp-${path.basename(rel)}`);
  fs.writeFileSync(tmpLocal, fs.readFileSync(local, "utf8").replace(/\r\n/g, "\n"));
  await sshExec(conn, `mkdir -p ${JSON.stringify(remoteDir)}`);
  await sftpPut(conn, tmpLocal, tmp);
  await sshExec(
    conn,
    `install -o jabhub -g jabhub -m 644 ${JSON.stringify(tmp)} ${JSON.stringify(remote)} && rm -f ${JSON.stringify(tmp)}`
  );
  try {
    fs.unlinkSync(tmpLocal);
  } catch {
    /* ignore */
  }
  console.log("UPLOADED", rel);
}

(async () => {
  await withConn(async (conn) => {
    for (const rel of UPLOAD) {
      await uploadFile(conn, rel);
    }

    // Ensure n8n env vars exist on VPS .env (non-destructive append)
    await sshExec(
      conn,
      `ENV="${BASE}/.env"; test -f "$ENV" || { echo "missing $ENV"; exit 1; }
grep -q '^N8N_PORT=' "$ENV" || echo 'N8N_PORT=5678' >> "$ENV"
grep -q '^N8N_BASIC_AUTH_ACTIVE=' "$ENV" || echo 'N8N_BASIC_AUTH_ACTIVE=true' >> "$ENV"
grep -q '^N8N_BASIC_AUTH_USER=' "$ENV" || echo 'N8N_BASIC_AUTH_USER=admin' >> "$ENV"
grep -q '^N8N_WEBHOOK_URL=' "$ENV" || echo 'N8N_WEBHOOK_URL=http://${HOST}:5678/' >> "$ENV"
grep -q '^N8N_HOST=' "$ENV" || echo 'N8N_HOST=${HOST}' >> "$ENV"
grep -q '^N8N_PROTOCOL=' "$ENV" || echo 'N8N_PROTOCOL=http' >> "$ENV"
grep -q '^N8N_TIMEZONE=' "$ENV" || echo 'N8N_TIMEZONE=Africa/Accra' >> "$ENV"
if ! grep -q '^N8N_BASIC_AUTH_PASSWORD=.' "$ENV"; then
  P=$(openssl rand -hex 16)
  if grep -q '^N8N_BASIC_AUTH_PASSWORD=' "$ENV"; then
    sed -i "s|^N8N_BASIC_AUTH_PASSWORD=.*|N8N_BASIC_AUTH_PASSWORD=$P|" "$ENV"
  else
    echo "N8N_BASIC_AUTH_PASSWORD=$P" >> "$ENV"
  fi
  echo "GENERATED_N8N_PASSWORD=$P"
fi
if ! grep -q '^N8N_ENCRYPTION_KEY=.' "$ENV"; then
  K=$(openssl rand -hex 32)
  if grep -q '^N8N_ENCRYPTION_KEY=' "$ENV"; then
    sed -i "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$K|" "$ENV"
  else
    echo "N8N_ENCRYPTION_KEY=$K" >> "$ENV"
  fi
fi
sed -i "s|http://YOUR_VPS_IP:5678/|http://${HOST}:5678/|g" "$ENV" 2>/dev/null || true
sed -i "s|^N8N_HOST=YOUR_VPS_IP|N8N_HOST=${HOST}|" "$ENV" 2>/dev/null || true
chown jabhub:jabhub "$ENV"
chmod 600 "$ENV"`
    );

    await sshExec(conn, "ufw allow 5678/tcp >/dev/null 2>&1 || true");

    await sshExec(
      conn,
      `cd ${JSON.stringify(BASE)} && docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml pull n8n && docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d n8n`
    );

    await sshExec(
      conn,
      `docker ps --filter name=jabhub_n8n --format '{{.Names}} {{.Status}}' && curl -fsS -o /dev/null -w 'n8n_http=%{http_code}\\n' http://127.0.0.1:5678/healthz || true`
    );

    console.log("");
    console.log("======== n8n ========");
    console.log(`URL:      http://${HOST}:5678`);
    console.log(`User:     admin (N8N_BASIC_AUTH_USER)`);
    console.log(`Password: see N8N_BASIC_AUTH_PASSWORD in ${BASE}/.env on VPS`);
    console.log(`Guide:    ${BASE}/deploy/N8N.md`);
    console.log("=====================");
    console.log("RESULT: SUCCESS");
  });
})().catch((e) => {
  console.error("RESULT: FAIL");
  console.error(String(e.message || e));
  process.exit(1);
});
