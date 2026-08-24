/**
 * LinkedIn UGC posts (image or text). Author URN = person or organization.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

async function registerUpload(creds, recipe = "feedshare-image") {
  const response = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: [`urn:li:digitalmediaRecipe:${recipe}`],
        owner: creds.authorUrn,
        serviceRelationships: [
          { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }
        ]
      }
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.message || `LinkedIn registerUpload ${response.status}`);
  const uploadUrl =
    json?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]
      ?.uploadUrl;
  const asset = json?.value?.asset;
  if (!uploadUrl || !asset) throw new Error("LinkedIn registerUpload missing uploadUrl/asset");
  return { uploadUrl, asset };
}

export async function publishLinkedIn({ creds, caption, imagePath, videoPath }) {
  if (!creds.accessToken || !creds.authorUrn) {
    throw new Error("LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN required");
  }

  let assetUrn = null;
  const mediaPath = imagePath || videoPath;
  if (mediaPath) {
    const recipe = videoPath ? "feedshare-video" : "feedshare-image";
    const { uploadUrl, asset } = await registerUpload(creds, recipe);
    const buf = await readFile(mediaPath);
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": videoPath ? "video/mp4" : "image/png"
      },
      body: buf
    });
    if (!put.ok) throw new Error(`LinkedIn media upload failed ${put.status}`);
    assetUrn = asset;
  }

  const shareContent = {
    shareCommentary: { text: caption || "" },
    shareMediaCategory: assetUrn ? (videoPath ? "VIDEO" : "IMAGE") : "NONE"
  };
  if (assetUrn) {
    shareContent.media = [
      {
        status: "READY",
        media: assetUrn,
        title: { text: path.basename(mediaPath || "media") }
      }
    ];
  }

  const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0"
    },
    body: JSON.stringify({
      author: creds.authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": shareContent
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.message || `LinkedIn post failed ${response.status}`);
  return { ok: true, externalId: json.id, kind: assetUrn ? "media" : "text" };
}
