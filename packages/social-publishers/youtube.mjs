/**
 * YouTube Data API — upload Shorts (vertical MP4).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

async function refreshAccessToken(creds) {
  if (creds.accessToken && !creds.refreshToken) return creds.accessToken;
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
    if (creds.accessToken) return creds.accessToken;
    throw new Error("YouTube needs YOUTUBE_CLIENT_ID/SECRET + YOUTUBE_REFRESH_TOKEN");
  }
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error_description || "YouTube token refresh failed");
  return json.access_token;
}

export async function publishYouTube({ creds, caption, videoPath }) {
  if (!videoPath) throw new Error("YouTube Shorts needs a video file");
  const accessToken = await refreshAccessToken(creds);
  const title = String(caption || "Short").split("\n")[0].slice(0, 90);
  const description = String(caption || "").slice(0, 4000);

  const metadata = {
    snippet: {
      title: title.includes("#Shorts") ? title : `${title} #Shorts`,
      description,
      categoryId: "22"
    },
    status: {
      privacyStatus: process.env.YOUTUBE_PRIVACY || "public",
      selfDeclaredMadeForKids: false
    }
  };

  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4"
      },
      body: JSON.stringify(metadata)
    }
  );
  if (!init.ok) {
    const t = await init.text();
    throw new Error(`YouTube init failed ${init.status}: ${t.slice(0, 200)}`);
  }
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube missing resumable upload URL");

  const buf = await readFile(videoPath);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(buf.length)
    },
    body: buf
  });
  const json = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(json?.error?.message || `YouTube upload failed ${put.status}`);
  return { ok: true, externalId: json.id, kind: "short", note: path.basename(videoPath) };
}
