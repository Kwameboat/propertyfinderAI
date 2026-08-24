const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("ssh2");
const HOST = "169.58.81.179";
const PASS = process.env.VPS_PASSWORD;
const BASE = "/opt/jab-hub";
const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "packages/social-media-gen.mjs",
  "packages/social-prompt.mjs",
  "scripts/proactive-social-agent.mjs"
];
if (!PASS) {
  console.error("FAIL: VPS_PASSWORD not set");
  process.exit(1);
}
const tgz = path.join(__dirname, ".flyer-fix.tgz");
const list = path.join(__dirname, ".flyer-fix-list.txt");
fs.writeFileSync(list, FILES.join("\n") + "\n");
execSync(`tar -czf "${tgz}" -T "${list}"`, { cwd: ROOT, stdio: "inherit", shell: true });

function withConn(fn) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => fn(conn).then(resolve, reject).finally(() => conn.end()))
      .on("error", reject)
      .connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 180000 });
  });
}
function sshExec(conn, cmd) {
  return new Promise((res, rej) => {
    let out = "",
      err = "";
    conn.exec(cmd, (e, stream) => {
      if (e) return rej(e);
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (err += d));
      stream.on("close", (code) =>
        code !== 0 ? rej(new Error((err || out || "exit " + code).trim().slice(0, 4000))) : res(out)
      );
    });
  });
}
function sftpPut(conn, local, remote) {
  return new Promise((res, rej) => {
    conn.sftp((e, sftp) => {
      if (e) return rej(e);
      sftp.fastPut(local, remote, (err) => (err ? rej(err) : res()));
    });
  });
}

(async () => {
  await withConn(async (conn) => {
    await sftpPut(conn, tgz, "/tmp/jab-flyer.tgz");
    await sshExec(
      conn,
      `cd ${BASE} && tar -xzf /tmp/jab-flyer.tgz && chown -R jabhub:jabhub packages/social-media-gen.mjs packages/social-prompt.mjs scripts/proactive-social-agent.mjs && rm -f /tmp/jab-flyer.tgz`
    );
    await sshExec(
      conn,
      "grep -q '^JAB_SOCIAL_IMAGE_MODEL=' /opt/jab-hub/.env && sed -i 's/^JAB_SOCIAL_IMAGE_MODEL=.*/JAB_SOCIAL_IMAGE_MODEL=gemini-2.5-flash-image/' /opt/jab-hub/.env || echo 'JAB_SOCIAL_IMAGE_MODEL=gemini-2.5-flash-image' >> /opt/jab-hub/.env"
    );
    // quick live image smoke
    const smoke = `
const fs=require('fs');
const env=Object.fromEntries(fs.readFileSync('/opt/jab-hub/.env','utf8').split(/\\r?\\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const key=env.GEMINI_API_KEY||env.GOOGLE_GENERATIVE_AI_API_KEY;
const model='gemini-2.5-flash-image';
const url='https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+encodeURIComponent(key);
fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{role:'user',parts:[{text:'Create a finished Instagram square recruitment flyer: SECURITY GUARDS & CLEANERS WANTED IN DUBAI. Black background, bold left headlines, two circular photorealistic photo insets with white borders on the right (guards and cleaner), CONTACT US WhatsApp bar bottom left with numbers 0537832386 and 0554794957. PosterMyWall style, no watermark.'}]}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'1:1'}}})}).then(async r=>{const t=await r.text(); let has=false; try{const j=JSON.parse(t); const parts=j?.candidates?.[0]?.content?.parts||[]; const img=parts.find(p=>p.inlineData?.data||p.inline_data?.data); if(img){const b=img.inlineData||img.inline_data; fs.writeFileSync('/var/lib/jab-hub/social/smoke-poster.png', Buffer.from(b.data,'base64')); has=true;} }catch(e){} console.log('status', r.status, 'img', has, t.slice(0,160).replace(/\\n/g,' '));}).catch(e=>{console.error(e); process.exit(1);});
`;
    const b64 = Buffer.from(smoke).toString("base64");
    console.log(
      "SMOKE\n" +
        (
          await sshExec(
            conn,
            `echo ${b64} | base64 -d > /tmp/smoke-img.js && node /tmp/smoke-img.js`
          )
        ).trim()
    );
    await sshExec(conn, "systemctl restart jab-hub-social");
    console.log("ACTIVE", (await sshExec(conn, "systemctl is-active jab-hub-social")).trim());
    console.log("RESULT: SUCCESS");
  });
  try {
    fs.unlinkSync(tgz);
    fs.unlinkSync(list);
  } catch {}
})().catch((e) => {
  console.error("RESULT: FAIL");
  console.error(String(e.message || e));
  process.exit(1);
});
