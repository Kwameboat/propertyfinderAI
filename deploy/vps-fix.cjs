const { Client } = require("ssh2");
const { existsSync, readFileSync, writeFileSync } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");
const HOST = "169.58.81.179"; const PW = process.env.VPS_PASSWORD; const REPO = "C:/Users/DELL/jab-hub";
const SECRETS = join(REPO, "deploy", ".vps-deploy-secrets.json");
const report = { os:"Ubuntu 24.04.4 LTS", ram:"7.8Gi total", disk:"96G total 94G free", installOk:false, hubUrl:"http://169.58.81.179:3000", evolutionManagerUrl:"http://169.58.81.179:8080/manager", services:{}, qrPath:null, errors:[], secretsSaved:false, marketingKeysSet:[], cloneUsed:"scp" };
function run(cmd,t=900000){return new Promise((res,rej)=>{const c=new Client();let out="";const tm=setTimeout(()=>{c.end();rej(new Error("timeout"));},t);c.on("ready",()=>c.exec(cmd,(e,s)=>{s.on("data",d=>{out+=d;process.stdout.write(d);});s.on("close",code=>{clearTimeout(tm);c.end();res({code,out});});})).on("error",e=>{clearTimeout(tm);rej(e);}).connect({host:HOST,username:"root",password:PW,readyTimeout:60000});});}
function put(l,r){return new Promise((res,rej)=>{const c=new Client();c.on("ready",()=>c.sftp((e,sftp)=>{if(e){c.end();return rej(e);}sftp.fastPut(l,r,er=>{c.end();er?rej(er):res();});})).on("error",rej).connect({host:HOST,username:"root",password:PW,readyTimeout:120000});});}
(async()=>{if(!PW){console.error("no VPS_PASSWORD");process.exit(1);}
await run("find /root/jab-hub -type f -name *.sh -exec sed -i s/\\r$// {} +");
await run("find /root/jab-hub -type f -name *.mjs -exec sed -i s/\\r$// {} +");
const install=await run("cd /root/jab-hub && VPS_IP=169.58.81.179 bash deploy/install.sh 2>&1");
report.installOk=install.code===0;if(install.code)report.errors.push("install "+install.code);
const am=install.out.match(/^AUTHENTICATION_API_KEY=(.+)$/m);const pm=install.out.match(/^HUB_ADMIN_PASSWORD=(.+)$/m);
if(am&&pm){writeFileSync(SECRETS,JSON.stringify({AUTHENTICATION_API_KEY:am[1].trim(),HUB_ADMIN_PASSWORD:pm[1].trim(),host:HOST},null,2));report.secretsSaved=true;console.log("[secrets saved]");}else report.errors.push("no secrets");
const tarLocal=join(REPO,"deploy",".openclaw-upload.tgz");spawnSync("tar",["-czf",tarLocal,"-C","C:/Users/DELL",".openclaw"],{shell:true,stdio:"inherit"});
await put(tarLocal,"/tmp/openclaw.tgz");await run("rm -rf /home/jabhub/.openclaw && mkdir -p /home/jabhub && tar -xzf /tmp/openclaw.tgz -C /home/jabhub && chown -R jabhub:jabhub /home/jabhub/.openclaw && rm -f /tmp/openclaw.tgz");
await run("systemctl restart jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard");
await run("systemctl daemon-reload");await run("systemctl enable --now jab-hub-marketing 2>&1 || true");
await run("cd /opt/jab-hub && sudo -u jabhub bash deploy/create-instance.sh jab-whatsapp 2>&1",300000);
const qr=await run("cd /opt/jab-hub && sudo -u jabhub bash deploy/get-qr.sh jab-whatsapp 2>&1",120000);report.qrPath="/tmp/jab-whatsapp-qr.png"; if(qr.out.includes("/tmp/")) report.qrPath=qr.out.split("\\n").find(l=>l.includes(".png")&&l.includes("/tmp/"))||report.qrPath;
const verify=await run("cd /opt/jab-hub && bash deploy/verify.sh 2>&1",180000);if(verify.code)report.errors.push("verify "+verify.code);
const st=await run("for u in jab-openclaw-gateway jab-hub-bridge jab-hub-dashboard jab-hub-marketing docker; do echo $u:$(systemctl is-active $u 2>/dev/null || echo inactive); done");
for(const line of st.out.split("\\n")){const m=line.match(/^([^:]+):(.+)$/);if(m)report.services[m[1].trim()]=m[2].trim();}
console.log(JSON.stringify(report,null,2));})().catch(e=>{console.error(e);process.exit(1);});
