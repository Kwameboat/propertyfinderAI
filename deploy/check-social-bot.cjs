const { Client } = require("ssh2");
const TOKEN = process.env.TELEGRAM_SOCIAL_BOT_TOKEN || "";
const PASS = process.env.VPS_PASSWORD || "";

if (!TOKEN || !PASS) {
  console.error("missing env");
  process.exit(1);
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

(async () => {
  const tg = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?limit=30`).then((r) =>
    r.json()
  );
  console.log("TG_OK", tg.ok, "count", (tg.result || []).length);
  for (const u of (tg.result || []).slice(-12)) {
    if (u.message) {
      console.log(
        "MSG",
        JSON.stringify({
          from: u.message.from?.id,
          username: u.message.from?.username,
          text: String(u.message.text || u.message.caption || "").slice(0, 240),
          hasPhoto: Boolean(u.message.photo),
          date: u.message.date
        })
      );
    }
    if (u.callback_query) {
      console.log(
        "CB",
        JSON.stringify({ data: u.callback_query.data, from: u.callback_query.from?.id })
      );
    }
  }

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on("ready", () => resolve())
      .on("error", reject)
      .connect({ host: "169.58.81.179", username: "root", password: PASS, readyTimeout: 90000 });
  });

  const remote = `
import('/opt/jab-hub/packages/hub-db/index.mjs').then(m => {
  const { db } = m.openHubDb();
  const posts = m.listSocialPosts(db, { limit: 8 });
  console.log('POST_COUNT', posts.length);
  for (const p of posts) {
    console.log('POST', JSON.stringify({
      id: p.id,
      status: p.status,
      brief: String(p.brief || '').slice(0, 160),
      platforms: p.platforms,
      caption: String(p.captions?.default || '').slice(0, 300),
      hashtags: p.captions?.hashtags || [],
      imageMethod: p.media?.imageMethod || null,
      square: p.media?.squarePath || null,
      story: p.media?.storyPath || null,
      video: p.media?.videoPath || null,
      dry_run: p.dry_run,
      created_at: p.created_at
    }));
  }
  console.log('STATS', JSON.stringify(m.getSocialStats(db)));
}).catch(e => { console.error(e); process.exit(1); });
`;
  const b64 = Buffer.from(remote).toString("base64");
  const out = await sshExec(
    conn,
    `echo ${b64} | base64 -d > /tmp/check-social.js && sudo -u jabhub env JAB_HUB_DATA_DIR=/var/lib/jab-hub node /tmp/check-social.js`
  );
  console.log(out.trim());

  const files = await sshExec(
    conn,
    "ls -lt /var/lib/jab-hub/social 2>/dev/null | head -20 || echo 'no social media dir'"
  );
  console.log("MEDIA_DIR\n" + files.trim());

  const logs = await sshExec(conn, "journalctl -u jab-hub-social -n 40 --no-pager");
  console.log(
    "LOGS\n" +
      logs
        .split("\n")
        .filter((l) => /social|draft|POST|error|Error|poll/i.test(l))
        .slice(-25)
        .join("\n")
  );

  conn.end();
})().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
