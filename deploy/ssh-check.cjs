const { Client } = require("ssh2");
const c = new Client();
c.on("ready", () => {
  c.exec("ls -la /root/jab-hub/deploy/install.sh 2>/dev/null; du -sh /root/jab-hub /home/jabhub/.openclaw 2>/dev/null; systemctl is-active jab-hub-dashboard 2>/dev/null || echo not-installed", (e, s) => {
    s.on("data", (d) => process.stdout.write(d));
    s.on("close", () => c.end());
  });
}).connect({ host: "169.58.81.179", username: "root", password: process.env.VPS_PASSWORD });
