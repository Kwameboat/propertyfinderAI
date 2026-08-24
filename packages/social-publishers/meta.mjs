/**
 * Meta Graph — Instagram Content Publishing + Facebook Page photo/video.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const GRAPH = "https://graph.facebook.com/v21.0";

async function graphForm(url, fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
  }
  const response = await fetch(url, { method: "POST", body });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) {
    throw new Error(json?.error?.message || `Meta Graph ${response.status}`);
  }
  return json;
}

async function resolveIgUserId(creds) {
  if (creds.igUserId) return creds.igUserId;
  if (!creds.pageId || !creds.accessToken) return "";
  const url = `${GRAPH}/${creds.pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(creds.accessToken)}`;
  const response = await fetch(url);
  const json = await response.json();
  return json?.instagram_business_account?.id || "";
}

/**
 * Instagram requires a publicly reachable image URL for container creation.
 * When only a local path exists, we upload to Facebook Page first then use that URL,
 * or fail with a clear message for dry-run / media hosting.
 */
export async function publishInstagram({ creds, caption, imagePath, videoPath, publicMediaBase = "" }) {
  const igUserId = await resolveIgUserId(creds);
  if (!igUserId) throw new Error("Instagram business account id missing (META_IG_USER_ID or linked Page)");
  if (!creds.accessToken) throw new Error("META_ACCESS_TOKEN missing");

  if (videoPath && publicMediaBase) {
    const videoUrl = `${publicMediaBase.replace(/\/$/, "")}/${path.basename(videoPath)}`;
    const container = await graphForm(`${GRAPH}/${igUserId}/media`, {
      media_type: "REELS",
      video_url: videoUrl,
      caption: caption || "",
      access_token: creds.accessToken
    });
    const published = await graphForm(`${GRAPH}/${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: creds.accessToken
    });
    return { ok: true, externalId: published.id, kind: "reel" };
  }

  if (imagePath && publicMediaBase) {
    const imageUrl = `${publicMediaBase.replace(/\/$/, "")}/${path.basename(imagePath)}`;
    const container = await graphForm(`${GRAPH}/${igUserId}/media`, {
      image_url: imageUrl,
      caption: caption || "",
      access_token: creds.accessToken
    });
    const published = await graphForm(`${GRAPH}/${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: creds.accessToken
    });
    return { ok: true, externalId: published.id, kind: "image" };
  }

  throw new Error(
    "Instagram needs publicly reachable media. Set JAB_SOCIAL_PUBLIC_MEDIA_BASE (HTTPS URL serving social/ files) or use Facebook upload path."
  );
}

export async function publishFacebook({ creds, caption, imagePath, videoPath }) {
  if (!creds.pageId || !creds.accessToken) throw new Error("Facebook page id/token missing");

  if (videoPath) {
    const buf = await readFile(videoPath);
    const form = new FormData();
    form.append("description", caption || "");
    form.append("access_token", creds.accessToken);
    form.append("source", new Blob([buf], { type: "video/mp4" }), path.basename(videoPath));
    const response = await fetch(`${GRAPH}/${creds.pageId}/videos`, { method: "POST", body: form });
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(json?.error?.message || "FB video upload failed");
    return { ok: true, externalId: json.id, kind: "video" };
  }

  if (imagePath) {
    const buf = await readFile(imagePath);
    const form = new FormData();
    form.append("caption", caption || "");
    form.append("access_token", creds.accessToken);
    form.append("source", new Blob([buf], { type: "image/png" }), path.basename(imagePath));
    const response = await fetch(`${GRAPH}/${creds.pageId}/photos`, { method: "POST", body: form });
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(json?.error?.message || "FB photo upload failed");
    return { ok: true, externalId: json.id || json.post_id, kind: "photo" };
  }

  const json = await graphForm(`${GRAPH}/${creds.pageId}/feed`, {
    message: caption || "",
    access_token: creds.accessToken
  });
  return { ok: true, externalId: json.id, kind: "text" };
}
