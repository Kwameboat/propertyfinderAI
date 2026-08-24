const { Client } = require("ssh2");
const VPS_PASSWORD = process.env.VPS_PASSWORD;
function sshExec(cmd, timeoutMs=120000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout="", stderr="";
    const t=setTimeout(()=>{conn.end();reject(new Error("timeout"));},timeoutMs);
    conn.on("ready",()=>conn.exec(cmd,(e,s)=>{
      if(e){clearTimeout(t);conn.end();return reject(e);}
      s.on("close",()=>{clearTimeout(t);conn.end();resolve({stdout,stderr});});
      s.on("data",d=>stdout+=d.toString());
      s.stderr.on("data",d=>stderr+=d.toString());
    })).on("error",reject).connect({host:"169.58.81.179",port:22,username:"root",password:VPS_PASSWORD,readyTimeout:60000});
  });
}
const sh = `
python3 <<'PY'
from pathlib import Path
p = Path("/opt/jab-hub/.env")
raw = p.read_bytes()
if raw.startswith(b"\\xef\\xbb\\xbf"):
    raw = raw[3:]
    p.write_bytes(raw)
    print("BOM_STRIPPED=yes")
else:
    print("BOM_STRIPPED=no")
text = raw.decode("utf-8", errors="replace")
key = ""
for line in text.splitlines():
    if line.startswith("AUTHENTICATION_API_KEY="):
        key = line.split("=",1)[1].strip().strip('"').strip("'")
        break
print("ENV_KEY_LEN", len(key))
PY
CONT=jabhub_evolution_api
EVO_KEY=$(docker exec $CONT printenv AUTHENTICATION_API_KEY 2>/dev/null || true)
printf 'EVO_KEY_LEN %s\\n' "$(printf '%s' "$EVO_KEY" | wc -c)"
ENV_KEY=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | head -1 | cut -d= -f2- | tr -d '\\r' | sed 's/^["'\\''']//;s/["'\\''']$//')
if [ "$ENV_KEY" = "$EVO_KEY" ] && [ -n "$ENV_KEY" ]; then echo MATCH=yes; else echo MATCH=no; fi
if [ "$ENV_KEY" != "$EVO_KEY" ]; then
  grep -v '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env > /tmp/jab-env.tmp
  printf 'AUTHENTICATION_API_KEY=%s\\n' "$EVO_KEY" >> /tmp/jab-env.tmp
  mv /tmp/jab-env.tmp /opt/jab-hub/.env
  chmod 600 /opt/jab-hub/.env
  echo FIXED_ENV_TO_EVO=yes
fi
cd /opt/jab-hub
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --force-recreate api
systemctl restart jab-hub-bridge jab-openclaw-gateway || systemctl restart jab-hub-bridge
sleep 6
KEY=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | head -1 | cut -d= -f2- | tr -d '\\r' | sed 's/^["'\\''']//;s/["'\\''']$//')
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $KEY" http://127.0.0.1:8080/instance/fetchInstances)
echo CURL_CODE=$CODE
journalctl -u jab-hub-bridge -n 12 --no-pager | grep -E '401|startupSyncError|syncError|listening' || true
ENV_KEY2=$(grep -E '^AUTHENTICATION_API_KEY=' /opt/jab-hub/.env | head -1 | cut -d= -f2- | tr -d '\\r' | sed 's/^["'\\''']//;s/["'\\''']$//')
EVO_KEY2=$(docker exec jabhub_evolution_api printenv AUTHENTICATION_API_KEY 2>/dev/null || true)
if [ "$ENV_KEY2" = "$EVO_KEY2" ]; then echo FINAL_MATCH=yes; else echo FINAL_MATCH=no; fi
echo FINAL_ENV_LEN $(printf '%s' "$ENV_KEY2" | wc -c)
echo FINAL_EVO_LEN $(printf '%s' "$EVO_KEY2" | wc -c)
`;
(async()=>{
  const {stdout,stderr}=await sshExec("bash -lc "+JSON.stringify(sh));
  console.log(stdout);
  if(stderr) console.error(stderr.slice(0,500));
})().catch(e=>{console.error(e.message);process.exit(1);});
