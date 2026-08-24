const { Client } = require("ssh2");
const VPS_PASSWORD = process.env.VPS_PASSWORD;
function sshExec(cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    conn.on("ready", () => conn.exec(cmd, (e, s) => {
      if (e) return reject(e);
      s.on("close", () => { conn.end(); resolve(stdout); });
      s.on("data", d => stdout += d.toString());
    })).on("error", reject).connect({ host:"169.58.81.179", port:22, username:"root", password:VPS_PASSWORD, readyTimeout:60000 });
  });
}
async function run() {
  const steps = [
    "sed -i '1s/^\\xEF\\xBB\\xBF//' /opt/jab-hub/.env; xxd /opt/jab-hub/.env | head -1",
    "ENV_KEY=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | head -1 | cut -d= -f2- | tr -d '\\r' | sed 's/^[\"'\"'\"]//;s/[\"'\"'\"]$//'); EVO_KEY=$(docker exec jabhub_evolution_api printenv AUTHENTICATION_API_KEY); echo ENV_LEN $(printf %s \"$ENV_KEY\" | wc -c); echo EVO_LEN $(printf %s \"$EVO_KEY\" | wc -c); if [ \"$ENV_KEY\" = \"$EVO_KEY\" ]; then echo MATCH yes; else echo MATCH no; fi",
  ];
  for (const s of steps) {
    const o = await sshExec("bash -lc " + JSON.stringify(s));
    console.log("---", o.trim());
  }
}
run().catch(e => { console.error(e.message); process.exit(1); });
