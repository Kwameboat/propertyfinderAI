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
  const script = `node -e "const fs=require('fs'); const p='/home/jabhub/.openclaw/openclaw.json'; let c={}; try{c=JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){}; const sk=c.skills?.entries?.['evolution-api-v2']?.env||{}; const v1=sk.EVO_GLOBAL_KEY||''; const v2=c.env?.vars?.EVO_GLOBAL_KEY||''; const raw=fs.readFileSync('/opt/jab-hub/.env','utf8'); let auth=''; for (const line of raw.split(/\\n/)) { if (line.startsWith('AUTHENTICATION_API_KEY=')) auth=line.slice(24).trim(); } console.log('SKILL_EVO_LEN', v1.length); console.log('CONFIG_EVO_LEN', v2.length); console.log('ENV_AUTH_LEN', auth.length); console.log('SKILL_URL', sk.EVO_API_URL||''); const evo=process.env.NOTNEEDED;" 2>/dev/null`;
  const o = await sshExec("sudo -u jabhub bash -lc " + JSON.stringify("node -e \"const fs=require('fs');const p='/home/jabhub/.openclaw/openclaw.json';let c={};try{c=JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){};const sk=c.skills?.entries?.['evolution-api-v2']?.env||{};const v1=sk.EVO_GLOBAL_KEY||'';const v2=(c.env&&c.env.vars&&c.env.vars.EVO_GLOBAL_KEY)||'';const raw=fs.readFileSync('/opt/jab-hub/.env','utf8');let auth='';for(const line of raw.split(/\\\\n/)){if(line.startsWith('AUTHENTICATION_API_KEY='))auth=line.slice(24).trim();}console.log('SKILL_EVO_LEN',v1.length);console.log('CONFIG_EVO_LEN',v2.length);console.log('ENV_AUTH_LEN',auth.length);console.log('SKILL_URL',sk.EVO_API_URL||'none');\""));
  console.log(o.trim());
  const o2 = await sshExec("docker exec jabhub_evolution_api node -e \"console.log('EVO_CONTAINER_LEN', (process.env.AUTHENTICATION_API_KEY||'').length)\"");
  console.log(o2.trim());
})().catch(e => { console.error(e.message); process.exit(1); });
