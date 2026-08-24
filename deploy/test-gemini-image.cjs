const fs = require("fs");
const path = require("path");
const { Client } = require("ssh2");
const PASS = process.env.VPS_PASSWORD || "";

function sshExec(conn, cmd) {
  return new Promise((res, rej) => {
    let out = "",
      err = "";
    conn.exec(cmd, (e, stream) => {
      if (e) return rej(e);
      stream.on("data", (d) => (out += d));
      stream.stderr.on("data", (d) => (err += d));
      stream.on("close", (code) => res({ code, out, err }));
    });
  });
}

(async () => {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on("ready", resolve)
      .on("error", reject)
      .connect({ host: "169.58.81.179", username: "root", password: PASS, readyTimeout: 90000 });
  });

  const script = `
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/opt/jab-hub/.env','utf8').split(/\\r?\\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const key = env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || '';
console.log('key_len', key.length);
async function tryModel(model, body) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const text = await res.text();
  let hasImg = false;
  try {
    const j = JSON.parse(text);
    const parts = j?.candidates?.[0]?.content?.parts || [];
    hasImg = parts.some(p => p.inlineData?.data || p.inline_data?.data);
  } catch {}
  console.log('MODEL', model, res.status, 'img', hasImg, text.slice(0,180).replace(/\\n/g,' '));
}
async function tryImagen(model) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':predict?key=' + encodeURIComponent(key);
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ instances:[{prompt:'bold dark social media recruitment flyer for security guards dubai, professional poster, circular photo insets, contact bar'}], parameters:{sampleCount:1, aspectRatio:'1:1'} }) });
  const text = await res.text();
  console.log('IMAGEN', model, res.status, text.slice(0,180).replace(/\\n/g,' '));
}
(async()=>{
  if(!key){ console.log('NO_KEY'); process.exit(1);} 
  await tryImagen('imagen-3.0-generate-002');
  await tryImagen('imagen-4.0-generate-001');
  for (const m of ['gemini-2.0-flash-preview-image-generation','gemini-2.5-flash-image-preview','gemini-2.0-flash-exp']) {
    await tryModel(m, { contents:[{role:'user', parts:[{text:'Create a bold Instagram square poster: SECURITY GUARDS WANTED IN DUBAI, dark background, circular photos of guards, WhatsApp contact bar. No watermark.'}]}], generationConfig:{ responseModalities:['TEXT','IMAGE'] } });
  }
})().catch(e=>{ console.error(e); process.exit(1);});
`;
  const b64 = Buffer.from(script).toString("base64");
  const r = await sshExec(
    conn,
    `echo ${b64} | base64 -d > /tmp/test-img.js && node /tmp/test-img.js`
  );
  console.log(r.out || r.err);
  conn.end();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
