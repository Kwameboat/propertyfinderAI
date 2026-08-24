/**
 * Full deploy to Contabo VPS (169.58.81.179).
 *
 * Password: VPS_PASSWORD env OR deploy/.vps-password (one line, gitignored)
 *
 *   node deploy/deploy-vps-contabo.cjs
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");

const HOST = process.env.VPS_HOST || "169.58.81.179";
const USER = "root";
const LOCAL_REPO = path.resolve(__dirname, "..");
const REMOTE_STAGE = "/root/jab-hub";
const OPENCLAW = path.join(process.env.USERPROFILE || process.env.HOME || "", ".openclaw");
const SECRETS_OUT = path.join(__dirname, ".vps-deploy-secrets.json");

function loadVpsPassword() {
  if (process.env.VPS_PASSWORD) return String(process.env.VPS_PASSWORD).trim();
  const file = path.join(__dirname, ".vps-password");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  return "";
}

const PASS = loadVpsPassword();

if (!PASS) {
  console.error("FAIL: set VPS_PASSWORD or create deploy/.vps-password");
  process.exit(1);
}

const report = {
  host: HOST,
  hubUrl: `http://${HOST}:3000`,
  evolutionUrl: `http://${HOST}:8080/manager`,
  n8nUrl: `http://${HOST}:5678`,
  installOk: false,
  verifyOk: false,
  secretsSaved: false,
  errors: [],
  services: {}
};

function withConn(fn) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => fn(conn).then(resolve, reject).finally(() => conn.end()))
      .on("error", reject)
      .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 120000 });
  });
}

function sshExec(cmd, timeoutMs = 900000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH timeout: ${cmd.slice(0, 120)}`));
    }, timeoutMs);
    conn
      .on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }
          stream.on("data", (d) => {
            stdout += d;
            process.stdout.write(d);
          });
          stream.stderr.on("data", (d) => {
            stderr += d;
            process.stderr.write(d);
          });
          stream.on("close", (code) => {
            clearTimeout(timer);
            conn.end();
            resolve({ code, stdout, stderr });
          });
        });
      })
      .on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      })
      .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 120000 });
  });
}

function sftpUploadDir(conn, localDir, remoteDir) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const mkdir = (p) =>
        new Promise((res, rej) =>
          sftp.mkdir(p, { mode: 0o755 }, (e) => (e && e.code !== 4 ? rej(e) : res()))
        );
      const put = (local, remote) =>
        new Promise((res, rej) => sftp.fastPut(local, remote, (e) => (e ? rej(e) : res())));

      (async () => {
        async function walk(local, remote) {
          await mkdir(remote);
          for (const name of fs.readdirSync(local)) {
            if (name === "node_modules" || name === ".git") continue;
            const lp = path.join(local, name);
            const rp = `${remote}/${name}`;
            if (fs.statSync(lp).isDirectory()) await walk(lp, rp);
            else await put(lp, rp);
          }
        }
        await walk(localDir, remoteDir);
        resolve();
      })().catch(reject);
    });
  });
}

function parseEnvMergeKeys(envPath) {
  const keys = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_APPROVER_IDS",
    "BRAVE_SEARCH_API_KEY",
    "JAB_MARKETING_SEARCH_PROVIDER",
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "JAB_MARKETING_DRY_RUN",
    "PAYSTACK_SECRET_KEY",
    "PAYSTACK_PUBLIC_KEY",
    "PAYSTACK_WEBHOOK_SECRET",
    "JAB_AGENCY_INSTANCE",
    "JAB_MARKETING_INSTANCE"
  ];
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    if (keys.includes(k) || k.startsWith("GEMINI_") || k.startsWith("N8N_")) out[k] = m[2];
  }
  return out;
}

async function main() {
  console.log(`=== Contabo deploy → ${HOST} ===\n`);

  console.log("=== 1/7 Upload project ===");
  await sshExec(`rm -rf ${REMOTE_STAGE} && mkdir -p ${REMOTE_STAGE}`);
  await withConn((conn) => sftpUploadDir(conn, LOCAL_REPO, REMOTE_STAGE));
  await sshExec(
    `find ${REMOTE_STAGE} -type f \\( -name '*.sh' -o -name '*.mjs' \\) -exec perl -pi -e 's/\\r\\n/\\n/g' {} +`
  );

  console.log("\n=== 2/7 install.sh (Docker + Hub + n8n) ===");
  const install = await sshExec(`cd ${REMOTE_STAGE} && VPS_IP=${HOST} bash deploy/install.sh 2>&1`);
  report.installOk = install.code === 0;
  if (install.code !== 0) report.errors.push(`install.sh exit ${install.code}`);

  const n8nPass = install.stdout.match(/^N8N_BASIC_AUTH_PASSWORD=(.+)$/m);
  const hubPass = install.stdout.match(/^HUB_ADMIN_PASSWORD=(.+)$/m);
  const apiKey = install.stdout.match(/^AUTHENTICATION_API_KEY=(.+)$/m);
  if (hubPass && apiKey) {
    const secrets = {
      host: HOST,
      HUB_ADMIN_PASSWORD: hubPass[1].trim(),
      AUTHENTICATION_API_KEY: apiKey[1].trim()
    };
    if (n8nPass) secrets.N8N_BASIC_AUTH_PASSWORD = n8nPass[1].trim();
    fs.writeFileSync(SECRETS_OUT, JSON.stringify(secrets, null, 2));
    report.secretsSaved = true;
    console.log("\n[secrets saved to deploy/.vps-deploy-secrets.json — only on first .env create]");
  }

  if (fs.existsSync(OPENCLAW)) {
    console.log("\n=== 3/7 OpenClaw config ===");
    await sshExec("rm -rf /home/jabhub/.openclaw && mkdir -p /home/jabhub/.openclaw");
    await withConn((conn) => sftpUploadDir(conn, OPENCLAW, "/home/jabhub/.openclaw"));
    await sshExec("chown -R jabhub:jabhub /home/jabhub/.openclaw");
  } else {
    console.log("\n=== 3/7 OpenClaw config (skipped — no local ~/.openclaw) ===");
  }

  console.log("\n=== 4/7 Merge .env keys from local ===");
  const envVars = parseEnvMergeKeys(path.join(LOCAL_REPO, ".env"));
  const mergeKeys = Object.keys(envVars);
  if (mergeKeys.length) {
    const b64 = Buffer.from(mergeKeys.map((k) => `${k}=${envVars[k]}`).join("\n"), "utf8").toString(
      "base64"
    );
    await sshExec(`python3 <<'PY'
import base64, re, pathlib
extra = base64.b64decode("${b64}").decode()
p = pathlib.Path("/opt/jab-hub/.env")
t = p.read_text() if p.exists() else ""
keys = {}
for line in extra.splitlines():
    if "=" not in line: continue
    k, v = line.split("=", 1)
    keys[k] = v
for k, v in keys.items():
    pat = re.compile("^" + re.escape(k) + "=.*$", re.M)
    t = pat.sub(k + "=" + v, t) if pat.search(t) else t.rstrip() + "\\n" + k + "=" + v + "\\n"
p.write_text(t)
PY`);
    console.log("Merged:", mergeKeys.join(", "));
  }

  console.log("\n=== 5/7 Ensure n8n + Evolution URLs in .env ===");
  await sshExec(`ENV=/opt/jab-hub/.env
grep -q '^JAB_HUB_PUBLIC_URL=' "$ENV" || echo 'JAB_HUB_PUBLIC_URL=http://${HOST}:3000' >> "$ENV"
grep -q '^N8N_WEBHOOK_URL=' "$ENV" || echo 'N8N_WEBHOOK_URL=http://${HOST}:5678/' >> "$ENV"
sed -i 's|http://YOUR_VPS_IP|http://${HOST}|g' "$ENV" 2>/dev/null || true
sed -i 's|^N8N_HOST=YOUR_VPS_IP|N8N_HOST=${HOST}|' "$ENV" 2>/dev/null || true
chown jabhub:jabhub "$ENV"
cd /opt/jab-hub && docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d n8n`);

  console.log("\n=== 6/7 Restart systemd services ===");
  await sshExec(
    "systemctl daemon-reload && systemctl restart jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard 2>/dev/null; systemctl enable jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard 2>/dev/null || true"
  );

  console.log("\n=== 7/7 verify ===");
  const verify = await sshExec("cd /opt/jab-hub && bash deploy/verify.sh 2>&1", 300000);
  report.verifyOk = verify.code === 0;
  if (verify.code !== 0) report.errors.push(`verify.sh exit ${verify.code}`);

  const status = await sshExec(
    "for u in jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard docker; do echo $u:$(systemctl is-active $u 2>/dev/null || echo inactive); done; docker ps --filter name=jabhub --format '{{.Names}}: {{.Status}}'"
  );
  for (const line of status.stdout.split("\n")) {
    const m = line.match(/^([^:]+):(.+)$/);
    if (m) report.services[m[1].trim()] = m[2].trim();
  }

  console.log("\n======== DEPLOY SUMMARY ========");
  console.log(`Hub:       ${report.hubUrl}`);
  console.log(`Evolution: ${report.evolutionUrl}`);
  console.log(`n8n:       ${report.n8nUrl}`);
  console.log(`Install:   ${report.installOk ? "OK" : "FAILED"}`);
  console.log(`Verify:    ${report.verifyOk ? "OK" : "check logs"}`);
  if (report.errors.length) console.log("Errors:", report.errors.join("; "));
  console.log("================================");
  console.log(JSON.stringify(report, null, 2));

  if (!report.installOk) process.exit(1);
}

main().catch((e) => {
  report.errors.push(String(e.message || e));
  console.error(e);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
});
