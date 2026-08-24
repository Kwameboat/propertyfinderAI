/**
 * X (Twitter) API v2 — OAuth2 Connect (text) or OAuth 1.0a (media).
 */

import { readFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";

function percentEncode(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthHeader({ method, url, creds, extraParams = {} }) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0"
  };
  const params = { ...oauth, ...extraParams };
  const base = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(base)}`;
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(baseString).digest("base64");
  const header =
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
      .join(", ");
  return header;
}

async function uploadMedia(creds, filePath) {
  const buf = await readFile(filePath);
  const url = "https://upload.twitter.com/1.1/media/upload.json";
  const form = new FormData();
  form.append("media", new Blob([buf]), path.basename(filePath));
  const auth = oauthHeader({ method: "POST", url, creds });
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth },
    body: form
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.errors?.[0]?.message || `X media upload ${response.status}`);
  return json.media_id_string;
}

function hasOAuth1(creds) {
  return Boolean(creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessSecret);
}

export async function publishX({ creds, caption, imagePath, videoPath }) {
  if (!hasOAuth1(creds)) {
    if (!creds.accessToken) throw new Error("X not connected — use Hub → Social → Connect with X");
    if (imagePath || videoPath) {
      throw new Error(
        "X media needs full API keys. Text-only works after Connect with X; for images use Instagram/Facebook for now."
      );
    }
    const response = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: String(caption || "").slice(0, 280) })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json?.detail || json?.title || `X tweet failed ${response.status}`);
    return { ok: true, externalId: json?.data?.id, kind: "text" };
  }

  let mediaIds = [];
  const mediaPath = imagePath || videoPath;
  if (mediaPath) {
    mediaIds = [await uploadMedia(creds, mediaPath)];
  }
  const url = "https://api.twitter.com/2/tweets";
  const body = { text: String(caption || "").slice(0, 280) };
  if (mediaIds.length) body.media = { media_ids: mediaIds };
  const auth = oauthHeader({ method: "POST", url, creds });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.detail || json?.title || `X tweet failed ${response.status}`);
  return { ok: true, externalId: json?.data?.id, kind: mediaIds.length ? "media" : "text" };
}
