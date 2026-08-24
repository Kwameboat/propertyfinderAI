const { Client } = require("ssh2");
const VPS_PASSWORD = process.env.VPS_PASSWORD;
function sshExec(cmd, t=120000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let o="", e="";
    const timer=setTimeout(()=>{conn.end();reject(new Error("timeout"));},t);
    conn.on("ready",()=>conn.exec(cmd,(err,s)=>{
      if(err){clearTimeout(timer);conn.end();return reject(err);}
      s.on("close",()=>{clearTimeout(timer);conn.end();resolve(o);});
      s.on("data",d=>o+=d.toString());
      s.stderr.on("data",d=>e+=d.toString());
    })).on("error",reject).connect({host:"169.58.81.179",port:22,username:"root",password:VPS_PASSWORD,readyTimeout:60000});
  });
}
const fixNode = `
const fs=require('fs');
const {execSync}=require('child_process');
const key=execSync('docker exec jabhub_evolution_api printenv AUTHENTICATION_API_KEY',{encoding:'utf8'}).trim();
const envPath='/opt/jab-hub/.env';
let raw=fs.readFileSync(envPath);
if(raw[0]===0xef&&raw[1]===0xbb&&raw[2]===0xbf) raw=raw.subarray(3);
let text=raw.toString('utf8');
const lines=text.split(/\\n/).filter(l=>!l.startsWith('AUTHENTICATION_API_KEY='));
lines.push('AUTHENTICATION_API_KEY='+key);
text=lines.join('\\n');
if(!text.endsWith('\\n')) text+='\\n';
fs.writeFileSync(envPath,text,{mode:0o600});
const cfgPath='/home/jabhub/.openclaw/openclaw.json';
const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
cfg.skills=cfg.skills||{}; cfg.skills.entries=cfg.skills.entries||{};
cfg.skills.entries['evolution-api-v2']=cfg.skills.entries['evolution-api-v2']||{};
cfg.skills.entries['evolution-api-v2'].env=cfg.skills.entries['evolution-api-v2'].env||{};
cfg.skills.entries['evolution-api-v2'].env.EVO_GLOBAL_KEY=key;
cfg.skills.entries['evolution-api-v2'].env.EVO_API_URL='http://127.0.0.1:8080';
cfg.env=cfg.env||{}; cfg.env.vars=cfg.env.vars||{};
delete cfg.env.vars.EVO_GLOBAL_KEY;
fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2)+'\\n');
const envAuth=(text.match(/^AUTHENTICATION_API_KEY=(.*)$/m)||[])[1]||'';
console.log('KEY_LEN',key.length);
console.log('ENV_WRITTEN_LEN',envAuth.trim().length);
console.log('SKILL_EVO_LEN',(cfg.skills.entries['evolution-api-v2'].env.EVO_GLOBAL_KEY||'').length);
console.log('MATCH', envAuth.trim()===key);
`;
(async()=>{
  await sshExec("bash -lc "+JSON.stringify("node -e "+JSON.stringify(fixNode)));
  await sshExec("bash -lc 'grep -q ^SERVER_URL= /opt/jab-hub/.env && sed -i \"s|^SERVER_URL=.*|SERVER_URL=http://169.58.81.179:8080|\" /opt/jab-hub/.env || echo SERVER_URL=http://169.58.81.179:8080 >> /opt/jab-hub/.env; for v in WEBHOOK_GLOBAL_URL WEBHOOK_URL; do grep -q ^$v= /opt/jab-hub/.env && sed -i \"s|^$v=.*|$v=http://host.docker.internal:8787/evolution|\" /opt/jab-hub/.env; done; chown jabhub:jabhub /home/jabhub/.openclaw/openclaw.json'");
  await sshExec("systemctl restart jab-hub-bridge jab-openclaw-gateway || systemctl restart jab-hub-bridge");
  await new Promise(r=>setTimeout(r,8000));
  const verify = await sshExec("bash -lc "+JSON.stringify("node -e \"const {execSync}=require('child_process');const k=execSync('grep -E \\\"^AUTHENTICATION_API_KEY=\\\" /opt/jab-hub/.env | head -1 | cut -d= -f2-',{encoding:'utf8'}).trim();const c=execSync('curl -s -o /dev/null -w %{http_code} -H \\\"apikey: '+k+'\\\" http://127.0.0.1:8080/instance/fetchInstances',{encoding:'utf8'}).trim();console.log('CURL',c);\""));
  const journal = await sshExec("journalctl -u jab-hub-bridge -n 15 --no-pager | grep -E '401|startupSyncError|syncError|Auto-sync|listening' || true");
  console.log(verify.trim());
  console.log(journal.trim());
})().catch(e=>{console.error(e.message);process.exit(1);});
