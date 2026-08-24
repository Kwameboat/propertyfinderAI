const { Client } = require("ssh2");
const VPS_PASSWORD = process.env.VPS_PASSWORD;
function sshExec(cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let o = "";
    conn.on("ready", () => conn.exec(cmd, (e, s) => {
      if (e) return reject(e);
      s.on("close", () => { conn.end(); resolve(o); });
      s.on("data", d => o += d.toString());
    })).on("error", reject).connect({ host:"169.58.81.179", port:22, username:"root", password:VPS_PASSWORD, readyTimeout:60000 });
  });
}
(async () => {
  const o = await sshExec(`sudo -u jabhub bash -lc ` + JSON.stringify(`node -e "
const fs=require('fs');const {execSync}=require('child_process');
const cfgPath=process.env.HOME+'/.openclaw/openclaw.json';
const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
const sk=cfg.skills?.entries?.['evolution-api-v2']?.env||{};
const evo=execSync('docker exec jabhub_evolution_api printenv AUTHENTICATION_API_KEY',{encoding:'utf8'}).trim();
console.log('cfg',cfgPath);
console.log('skill_len', (sk.EVO_GLOBAL_KEY||'').length);
console.log('evo_len', evo.length);
console.log('skill_match', sk.EVO_GLOBAL_KEY===evo);
console.log('skill_url', sk.EVO_API_URL||'');
const hub=fs.readFileSync('/opt/jab-hub/.env','utf8');
const m=hub.match(/^AUTHENTICATION_API_KEY=(.*)$/m);
console.log('hub_len', (m?m[1].trim():'').length);
"`));
  console.log(o.trim());
  const j = await sshExec("journalctl -u jab-hub-bridge -n 8 --no-pager");
  console.log('---journal---');
  console.log(j.replace(/apikey[^\n]*/gi,'[redacted]'));
})().catch(e => { console.error(e.message); process.exit(1); });
