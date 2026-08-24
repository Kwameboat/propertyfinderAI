const fs = require("fs");
const { Client } = require("ssh2");
const VPS_PASSWORD = process.env.VPS_PASSWORD;
const script = `const fs=require("fs");
const {execSync}=require("child_process");
const key=execSync("docker exec jabhub_evolution_api printenv AUTHENTICATION_API_KEY",{encoding:"utf8"}).trim();
const envPath="/opt/jab-hub/.env";
let raw=fs.readFileSync(envPath);
if (raw[0]===0xef && raw[1]===0xbb && raw[2]===0xbf) raw=raw.subarray(3);
let lines=raw.toString("utf8").split(/\\n/").filter(l=>l && !l.startsWith("AUTHENTICATION_API_KEY="));
lines.push("AUTHENTICATION_API_KEY="+key);
let text=lines.join("\\n")+"\\n";
fs.writeFileSync(envPath,text,{mode:0o600});
const cfgPath="/home/jabhub/.openclaw/openclaw.json";
const cfg=JSON.parse(fs.readFileSync(cfgPath,"utf8"));
cfg.skills=cfg.skills||{}; cfg.skills.entries=cfg.skills.entries||{};
const ent=cfg.skills.entries["evolution-api-v2"]||{};
ent.env=ent.env||{};
ent.env.EVO_GLOBAL_KEY=key;
ent.env.EVO_API_URL="http://127.0.0.1:8080";
cfg.skills.entries["evolution-api-v2"]=ent;
if (cfg.env && cfg.env.vars) delete cfg.env.vars.EVO_GLOBAL_KEY;
fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2)+"\\n");
const sk=cfg.skills.entries["evolution-api-v2"].env;
console.log("KEY_LEN",key.length);
console.log("SKILL_LEN",(sk.EVO_GLOBAL_KEY||"").length);
console.log("MATCH",sk.EVO_GLOBAL_KEY===key);
const code=execSync('curl -s -o /dev/null -w "%{http_code}" -H "apikey: '+key+'" http://127.0.0.1:8080/instance/fetchInstances',{encoding:"utf8"}).trim();
console.log("CURL",code);
`;
fs.writeFileSync("remote-fix-openclaw.js", script);
function withConn(fn) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => fn(conn).then(resolve, reject).finally(() => conn.end()))
      .on("error", reject)
      .connect({ host:"169.58.81.179", port:22, username:"root", password:VPS_PASSWORD, readyTimeout:60000 });
  });
}
function sshExec(cmd) {
  return withConn(conn => new Promise((res, rej) => {
    let o="";
    conn.exec(cmd, (e,s)=>{ if(e)return rej(e); s.on("close",()=>res(o)); s.on("data",d=>o+=d); });
  }));
}
function sftpPut(local, remote) {
  return withConn(conn => new Promise((res, rej) => {
    conn.sftp((e,sftp)=>{ if(e)return rej(e); sftp.fastPut(local,remote,err=>err?rej(err):res()); });
  }));
}
(async()=>{
  await sftpPut("remote-fix-openclaw.js","/tmp/remote-fix-openclaw.js");
  console.log((await sshExec("node /tmp/remote-fix-openclaw.js && chown jabhub:jabhub /home/jabhub/.openclaw/openclaw.json && systemctl restart jab-hub-bridge jab-openclaw-gateway; sleep 8; journalctl -u jab-hub-bridge -n 12 --no-pager | grep -E '401|startupSync|syncError|listening' || true")).trim());
  rm: try { fs.unlinkSync("remote-fix-openclaw.js"); } catch {}
})().catch(e=>{console.error(e.message);process.exit(1);});
