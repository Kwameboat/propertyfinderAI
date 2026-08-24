import { Client } from "ssh2";
import { existsSync } from "fs";

const VPS_HOST = "169.58.81.179";
const VPS_USER = "root";
const VPS_PASSWORD = process.env.VPS_PASSWORD;
const LOCAL_AUTH = "C:/Users/DELL/.openclaw/agents/main/agent/auth-profiles.json";

function sshExec(cmd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { conn.end(); reject(new Error("Timeout")); }, timeoutMs);
    conn.on("ready", () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        stream.on("close", (code) => { clearTimeout(timer); conn.end(); resolve({ code, stdout, stderr }); });
        stream.on("data", (d) => { stdout += d.toString(); });
        stream.stderr.on("data", (d) => { stderr += d.toString(); });
      });
    }).on("error", reject)
      .connect({ host: VPS_HOST, port: 22, username: VPS_USER, password: VPS_PASSWORD, readyTimeout: 60000 });
  });
}

function sftpPut(local, remote) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.fastPut(local, remote, (e) => { conn.end(); e ? reject(e) : resolve(); });
      });
    }).on("error", reject)
      .connect({ host: VPS_HOST, port: 22, username: VPS_USER, password: VPS_PASSWORD, readyTimeout: 60000 });
  });
}

const report = { envLen: 0, evoLen: 0, match: false, bridgeUsesEnvFile: false, fixed: [], curlCode: null, journalHas401: false };

async function main() {
  if (!VPS_PASSWORD) throw new Error("Set VPS_PASSWORD in environment");

  const diag = await sshExec(`bash -s <<'REMOTE'
ENV_FILE=/opt/jab-hub/.env
ENV_KEY=$(grep -E '^AUTHENTICATION_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')
ENV_LEN=${#ENV_KEY}
CONT=$(docker ps --format '{{.Names}}' | grep -iE 'evolution|jabhub.*api' | head -1)
EVO_KEY=""
[ -n "$CONT" ] && EVO_KEY=$(docker exec "$CONT" printenv AUTHENTICATION_API_KEY 2>/dev/null || true)
EVO_LEN=${#EVO_KEY}
MATCH=no
[ "$ENV_KEY" = "$EVO_KEY" ] && [ -n "$ENV_KEY" ] && MATCH=yes
echo ENV_LEN=$ENV_LEN
echo EVO_LEN=$EVO_LEN
echo MATCH=$MATCH
grep -E '^(SERVER_URL|WEBHOOK_GLOBAL_URL|WEBHOOK_URL)=' "$ENV_FILE" || true
grep EnvironmentFile /etc/systemd/system/jab-hub-bridge.service 2>/dev/null || true
REMOTE`);

  for (const line of diag.stdout.split(/\r?\n/)) {
    if (line.startsWith("ENV_LEN=")) report.envLen = +line.split("=")[1];
    if (line.startsWith("EVO_LEN=")) report.evoLen = +line.split("=")[1];
    if (line.startsWith("MATCH=")) report.match = line.endsWith("yes");
    if (line.includes("/opt/jab-hub/.env")) report.bridgeUsesEnvFile = true;
  }

  await sshExec(`bash -s <<'REMOTE'
set -e
ENV_FILE=/opt/jab-hub/.env
cd /opt/jab-hub
KEY=$(grep -E '^AUTHENTICATION_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')
[ -n "$KEY" ] || { echo MISSING_ENV_KEY; exit 1; }
grep -v '^AUTHENTICATION_API_KEY=' "$ENV_FILE" > /tmp/jab-env.tmp || true
printf 'AUTHENTICATION_API_KEY=%s\n' "$KEY" >> /tmp/jab-env.tmp
mv /tmp/jab-env.tmp "$ENV_FILE"
chmod 600 "$ENV_FILE"
if grep -q '^SERVER_URL=' "$ENV_FILE"; then sed -i 's|^SERVER_URL=.*|SERVER_URL=http://169.58.81.179:8080|' "$ENV_FILE"; else echo 'SERVER_URL=http://169.58.81.179:8080' >> "$ENV_FILE"; fi
for var in WEBHOOK_GLOBAL_URL WEBHOOK_URL; do
  if grep -q "^${var}=" "$ENV_FILE"; then sed -i "s|^${var}=.*|${var}=http://host.docker.internal:8787/evolution|" "$ENV_FILE"; fi
done
SVC=/etc/systemd/system/jab-hub-bridge.service
if [ -f "$SVC" ] && ! grep -q 'EnvironmentFile=/opt/jab-hub/.env' "$SVC"; then
  sed -i '/\[Service\]/a EnvironmentFile=/opt/jab-hub/.env' "$SVC"
  systemctl daemon-reload
fi
if [ -f docker-compose.yml ] && [ -f deploy/docker-compose.prod.yml ]; then
  docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --force-recreate api
else
  docker compose up -d --force-recreate api 2>/dev/null || docker compose up -d --force-recreate
fi
REMOTE`);
  report.fixed.push("synced .env, webhooks, systemd, recreated evolution api");

  if (existsSync(LOCAL_AUTH)) {
    await sftpPut(LOCAL_AUTH, "/tmp/auth-profiles.json");
    await sshExec(`bash -s <<'REMOTE'
mkdir -p /home/jabhub/.openclaw/agents/main/agent
install -o jabhub -g jabhub -m 600 /tmp/auth-profiles.json /home/jabhub/.openclaw/agents/main/agent/auth-profiles.json
rm -f /tmp/auth-profiles.json
REMOTE`);
    report.fixed.push("auth-profiles uploaded");
  }

  await sshExec("systemctl restart jab-hub-bridge jab-openclaw-gateway || systemctl restart jab-hub-bridge");
  await new Promise((r) => setTimeout(r, 6000));

  const verify = await sshExec(`bash -s <<'REMOTE'
KEY=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $KEY" http://127.0.0.1:8080/instance/fetchInstances)
echo CURL_CODE=$CODE
journalctl -u jab-hub-bridge -n 20 --no-pager | grep -q '401 Unauthorized' && echo HAS401=yes || echo HAS401=no
journalctl -u jab-hub-bridge -n 6 --no-pager
CONT=$(docker ps --format '{{.Names}}' | grep -iE 'evolution|jabhub.*api' | head -1)
EVO_KEY=$(docker exec "$CONT" printenv AUTHENTICATION_API_KEY 2>/dev/null || true)
[ "$KEY" = "$EVO_KEY" ] && echo FINAL_MATCH=yes || echo FINAL_MATCH=no
echo FINAL_ENV_LEN=${#KEY}
echo FINAL_EVO_LEN=${#EVO_KEY}
REMOTE`);

  if (verify.stdout.includes("CURL_CODE=200")) report.curlCode = "200";
  else report.curlCode = verify.stdout.match(/CURL_CODE=(\d+)/)?.[1] || "unknown";
  report.journalHas401 = verify.stdout.includes("HAS401=yes");
  report.match = verify.stdout.includes("FINAL_MATCH=yes");
  const em = verify.stdout.match(/FINAL_ENV_LEN=(\d+)/); if (em) report.envLen = +em[1];
  const ev = verify.stdout.match(/FINAL_EVO_LEN=(\d+)/); if (ev) report.evoLen = +ev[1];

  console.log(JSON.stringify(report));
}

main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
