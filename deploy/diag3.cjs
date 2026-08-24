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
(async () => {
  const o = await sshExec(`bash -lc ` + JSON.stringify([
    "grep -n AUTHENTICATION /opt/jab-hub/.env | sed 's/=.*/=<len>$(echo -n \"$(cut -d= -f2- <<<\"$(grep AUTHENTICATION /opt/jab-hub/.env | head -1)\")\" | wc -c)/'",
    "docker exec jabhub_evolution_api printenv | grep AUTHENTICATION | sed 's/=.*/=<hidden>/'",
    "systemctl show jab-hub-bridge -p Environment --no-pager | tr ' ' '\\n' | grep AUTHENTICATION | sed 's/=.*/=<present>/'",
    "xxd /opt/jab-hub/.env | head -3",
  ].join("; ")));
  console.log(o);
})().catch(e => { console.error(e.message); process.exit(1); });
