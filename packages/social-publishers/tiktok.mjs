/**
 * TikTok Content Posting API (direct post / inbox — requires approved app).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export async function publishTikTok({ creds, caption, videoPath, imagePath }) {
  if (!creds.accessToken) throw new Error("TIKTOK_ACCESS_TOKEN missing");
  const mediaPath = videoPath || imagePath;
  if (!mediaPath) throw new Error("TikTok needs video or image");

  // Init upload
  const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify({
      post_info: {
        title: String(caption || "").slice(0, 150),
        privacy_level: process.env.TIKTOK_PRIVACY_LEVEL || "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: (await readFile(mediaPath)).length,
        chunk_size: (await readFile(mediaPath)).length,
        total_chunk_count: 1
      }
    })
  });
  const initJson = await initRes.json().catch(() => ({}));
  if (!initRes.ok || initJson.error?.code) {
    throw new Error(
      initJson?.error?.message ||
        initJson?.message ||
        `TikTok init failed ${initRes.status} (app review / scopes may be required)`
    );
  }
  const uploadUrl = initJson?.data?.upload_url;
  const publishId = initJson?.data?.publish_id;
  if (!uploadUrl) throw new Error("TikTok init returned no upload_url");

  const buf = await readFile(mediaPath);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": videoPath ? "video/mp4" : "image/png",
      "Content-Length": String(buf.length)
    },
    body: buf
  });
  if (!put.ok) throw new Error(`TikTok upload failed ${put.status}`);

  return { ok: true, externalId: publishId || path.basename(mediaPath), kind: videoPath ? "video" : "image" };
}
