const fs=require("fs");const {Client}=require("ssh2");const PW=process.env.VPS_PASSWORD;const sh=fs.readFileSync(__dirname+"/vps-wa-verify-remote.sh","utf8");
function run(script){return new Promise((res,rej)=>{const c=new Client();let o="",e="";c.on("ready",()=>{c.exec("bash -s",(err,s)=>{if(err)return rej(err);s.on("close",code=>{c.end();res({code,o,e});});s.on("data",d=>o+=d);s.stderr.on("data",d=>e+=d);s.end(script);});}).on("error",rej).connect({host:"169.58.81.179",username:"root",password:PW,readyTimeout:120000});});}
const red=s=>String(s).replace(/(apikey|token|secret|password|Bearer)[=: ]["']?[^\s"']+/gi,"$1[REDACTED]");
run(sh).then(r=>{console.log(red(r.o));if(r.e)console.error(red(r.e));}).catch(e=>{console.error(e.message);process.exit(1);});

