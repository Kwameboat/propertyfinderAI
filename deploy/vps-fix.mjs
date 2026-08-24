const { Client } = require("ssh2");
const { existsSync, readFileSync, writeFileSync, createReadStream } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");

const VPS_HOST = "169.58.81.179";
const VPS_USER = "root";
const VPS_PASSWORD = process.env.VPS_PASSWORD;
const LOCAL_REPO = "C:/Users/DELL/jab-hub";
const OPENCLAW = "C:/Users/DELL/.openclaw";
const SECRETS_OUT = join(LOCAL_REPO, "deploy", ".vps-deploy-secrets.json");

const report = {
  os: "Ubuntu 24.04.4 LTS", ram: "7.8Gi total", disk: "96G total 94G free",
  installOk: false, hubUrl: `http://${VPS_HOST}:3000`,
  evolutionManagerUrl: `http://${VPS_HOST}:8080/manager`,
  services: {}, qrPath: null, errors: [], secretsSaved: false,
  marketingKeysSet: [], cloneUsed: "scp (git clone failed - private repo)",
};

function sshExec(cmd, timeoutMs = 900000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { conn.end(); reject(new Error("Timeout")); }, timeoutMs);
    conn.on("ready", () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); return reject(err); }
        stream.on("close", (code) => { clearTimeout(timer); conn.end(); resolve({ code, stdout, stderr }); });
        stream.on("data", (d) => { stdout += d.toString(); process.stdout.write(d); });
        stream.stderr.on("data", (d) => { stderr += d.toString(); process.stderr.write(d); });
      });
    }).on("error", (e) => { clearTimeout(timer); reject(e); })
      .connect({ host: VPS_HOST, port: 22, username: VPS_USER, password: VPS_PASSWORD, readyTimeout: 60000 });
  });
}

function sftpPut(localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        sftp.fastPut(localPath, remotePath, (e) => { conn.end(); e ? reject(e) : resolve(); });
      });
    }).on("error", reject).connect({ host: VPS_HOST, port: 22, username: VPS_USER, password: VPS_PASSWORD, readyTimeout: 120000 });
  });
}

function parseEnvKeys(path) {
  const keys = ["TELEGRAM_BOT_TOKEN","TELEGRAM_APPROVER_IDS","BRAVE_SEARCH_API_KEY","JAB_MARKETING_SEARCH_PROVIDER","GEMINI_API_KEY","GOOGLE_GENERATIVE_AI_API_KEY","JAB_MARKETING_DRY_RUN"];
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const k = m[1];
    if (keys.includes(k) || k.startsWith("GEMINI_")) out[k] = m[2];
  }
  return out;
}

async function main() {
  console.log("=== Fix CRLF on shell scripts ===");
  await sshExec("find /root/jab-hub -type f \\( -name '*.sh' -o -name '*.mjs' \\) -exec sed -i 's/\\r$//' {} +");

  console.log("\n=== Run install.sh ===");
  const install = await sshExec(`cd /root/jab-hub && VPS_IP=${VPS_HOST} bash deploy/install.sh 2>&1`);
  report.installOk = install.code === 0;
  if (install.code !== 0) report.errors.push("install.sh exit " + install.code);

  const apiMatch = install.stdout.match(/^AUTHENTICATION_API_KEY=(.+)$/m);
  const passMatch = install.stdout.match(/^HUB_ADMIN_PASSWORD=(.+)$/m);
  if (apiMatch && passMatch) {
    writeFileSync(SECRETS_OUT, JSON.stringify({ AUTHENTICATION_API_KEY: apiMatch[1].trim(), HUB_ADMIN_PASSWORD: passMatch[1].trim(), host: VPS_HOST }, null, 2));
    report.secretsSaved = true;
    console.log("\n[secrets saved to deploy/.vps-deploy-secrets.json]");
  } else report.errors.push("Could not parse install secrets");

  console.log("\n=== OpenClaw via tar ===");
  const tarLocal = join(LOCAL_REPO, "deploy", ".openclaw-upload.tgz");
  const tarCmd = spawnSync("tar", ["-czf", tarLocal, "-C", "C:/Users/DELL", ".openclaw"], { shell: true, stdio: "inherit" });
  if (tarCmd.status !== 0) report.errors.push("local tar failed");
  else {
    await sftpPut(tarLocal, "/tmp/openclaw.tgz");
    await sshExec("rm -rf /home/jabhub/.openclaw && mkdir -p /home/jabhub && tar -xzf /tmp/openclaw.tgz -C /home/jabhub && mv /home/jabhub/.openclaw /home/jabhub/.openclaw 2>/dev/null || true; tar -xzf /tmp/openclaw.tgz -C /home/jabhub && chown -R jabhub:jabhub /home/jabhub/.openclaw && rm -f /tmp/openclaw.tgz");
  }

  console.log("\n=== Merge marketing env ===");
  const envVars = parseEnvKeys(join(LOCAL_REPO, ".env"));
  report.marketingKeysSet = Object.keys(envVars);
  if (report.marketingKeysSet.length) {
    const b64 = Buffer.from(report.marketingKeysSet.map((k) => k + "=" + envVars[k]).join("\n"), "utf8").toString("base64");
    await sshExec(`python3 -c "import base64,re,pathlib; extra=base64.b64decode('${b64}').decode(); p=pathlib.Path('/opt/jab-hub/.env'); t=p.read_text() if p.exists() else ''; keys={};
for line in extra.splitlines():
  k,v=line.split('=',1); keys[k]=v
for k,v in keys.items():
  pat=re.compile('^'+re.escape(k)+'=.*$', re.M)
  t=pat.sub(k+'='+v,t) if pat.search(t) else t.rstrip()+'\\n'+k+'='+v+'\\n'
p.write_text(t)"`);
    console.log("Merged keys:", report.marketingKeysSet.join(", "));
  }

  console.log("\n=== Restart core services ===");
  await sshExec("systemctl restart jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard");

  console.log("\n=== Marketing systemd ===");
  const unitB64 = Buffer.from(`[Unit]
Description=JAB Hub proactive marketing agent
After=network.target

[Service]
Type=simple
User=jabhub
WorkingDirectory=/opt/jab-hub
EnvironmentFile=/opt/jab-hub/.env
ExecStart=/usr/bin/node /opt/jab-hub/scripts/proactive-marketing-agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`, "utf8").toString("base64");
  await sshExec(`echo '${unitB64}' | base64 -d > /etc/systemd/system/jab-hub-marketing.service && systemctl daemon-reload && systemctl enable --now jab-hub-marketing");

  console.log("\n=== WhatsApp instance + QR ===");
  await sshExec("cd /opt/jab-hub && sudo -u jabhub bash deploy/create-instance.sh jab-whatsapp 2>&1", 300000);
  const qr = await sshExec("cd /opt/jab-hub && sudo -u jabhub bash deploy/get-qr.sh jab-whatsapp 2>&1", 120000);
  report.qrPath = (qr.stdout.match(/(\/tmp\/[^\s]+\.png)/) || [])[1] || "/tmp/jab-whatsapp-qr.png";

  console.log("\n=== verify.sh ===");
  const verify = await sshExec("cd /opt/jab-hub && bash deploy/verify.sh 2>&1", 180000);
  if (verify.code !== 0) report.errors.push("verify.sh exit " + verify.code);

  const statusLines = await sshExec("for u in jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard jab-hub-marketing docker; do echo $u:$(systemctl is-active $u 2>/dev/null || echo inactive); done");
  for (const line of statusLines.stdout.split("\n")) {
    const m = line.match(/^([^:]+):(.+)$/);
    if (m) report.services[m[1].trim()] = m[2].trim();
  }

  console.log("\n=== DEPLOY REPORT ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { report.errors.push(String(e.message || e)); console.error(e); console.log(JSON.stringify(report, null, 2)); process.exit(1); });
