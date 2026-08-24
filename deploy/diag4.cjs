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
  const cmd = [
    "ENV_KEY=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | head -1 | cut -d= -f2- | tr -d '\\r' | sed 's/^[\"'\"'\"]//;s/[\"'\"'\"]$//')",
    "EVO_KEY=$(docker exec jabhub_evolution_api printenv AUTHENTICATION_API_KEY)",
    "echo ENV_LEN $(printf '%s' \"$ENV_KEY\" | wc -c)",
    "echo EVO_LEN $(printf '%s' \"$EVO_KEY\" | wc -c)",
    "[ \"$ENV_KEY\" = \"$EVO_KEY\" ] && echo MATCH yes || echo MATCH no",
    "CODE=$(curl -s -o /dev/null -w '%{http_code}' -H \"apikey: $ENV_KEY\" http://127.0.0.1:8080/instance/fetchInstances)",
    "echo CURL_ENV $CODE",
    "CODE2=$(curl -s -o /dev/null -w '%{http_code}' -H \"apikey: $EVO_KEY\" http://127.0.0.1:8080/instance/fetchInstances)",
    "echo CURL_EVO $CODE2",
    "grep -E '^(SERVER_URL|EVO_API_URL|EVO_GLOBAL_KEY)=' /opt/jab-hub/.env | cut -d= -f1",
    "sudo -u jabhub bash -lc 'source /opt/jab-hub/.env 2>/dev/null; echo PROC_LEN $(printf \"%s\" \"$AUTHENTICATION_API_KEY\" | wc -c)'",
    "systemctl show jab-hub-bridge -p Environment --no-pager | tr ' ' '\\n' | grep -E '^AUTHENTICATION_API_KEY=' | wc -c",
  ].join("; ");
  console.log(await sshExec("bash -lc " + JSON.stringify(cmd)));
})().catch(e => { console.error(e.message); process.exit(1); });
