const fs=require("fs");
const p="/opt/jab-hub/.env";
let t=fs.readFileSync(p,"utf8").replace(/^\uFEFF/gm,"");
if (!/^SERVER_URL=/m.test(t)) t+="SERVER_URL=http://169.58.81.179:8080\n";
else t=t.replace(/^SERVER_URL=.*/m,"SERVER_URL=http://169.58.81.179:8080");
const want="http://host.docker.internal:8787/evolution";
for (const v of ["WEBHOOK_GLOBAL_URL","WEBHOOK_URL"]) {
  if (/^${v}=/m.test(t)) t=t.replace(new RegExp("^"+v+"=.*","m"), v+"="+want);
}
fs.writeFileSync(p,t);
console.log("SERVER_OK", /^SERVER_URL=http:\/\/169\.58\.81\.179:8080/m.test(t));
console.log("BOM_COUNT", (t.match(/\uFEFF/g)||[]).length);