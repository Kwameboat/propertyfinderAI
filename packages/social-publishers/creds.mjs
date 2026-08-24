/**
 * Resolve social account credentials from DB row or process.env.
 */

import {
  getSocialAccountByPlatform,
  decryptSocialToken,
  SOCIAL_PLATFORMS
} from "../hub-db/social.mjs";

export { SOCIAL_PLATFORMS };

export function resolveAccountCreds(db, platform) {
  const plat = String(platform || "").toLowerCase();
  const row = db ? getSocialAccountByPlatform(db, plat) : null;
  const tokenFromDb = row?.token_enc ? decryptSocialToken(row.token_enc) : "";
  const meta = (() => {
    try {
      return JSON.parse(row?.meta_json || "{}");
    } catch {
      return {};
    }
  })();

  const env = process.env;
  switch (plat) {
    case "instagram":
      return {
        platform: plat,
        handle: row?.handle || env.META_IG_HANDLE || "instagram",
        accessToken: tokenFromDb || env.META_ACCESS_TOKEN || "",
        pageId: meta.pageId || env.META_PAGE_ID || "",
        igUserId: meta.igUserId || env.META_IG_USER_ID || "",
        status: row?.status || (env.META_ACCESS_TOKEN ? "connected" : "disconnected")
      };
    case "facebook":
      return {
        platform: plat,
        handle: row?.handle || env.META_PAGE_NAME || "facebook",
        accessToken: tokenFromDb || env.META_ACCESS_TOKEN || "",
        pageId: meta.pageId || env.META_PAGE_ID || "",
        status: row?.status || (env.META_ACCESS_TOKEN && env.META_PAGE_ID ? "connected" : "disconnected")
      };
    case "tiktok":
      return {
        platform: plat,
        handle: row?.handle || env.TIKTOK_HANDLE || "tiktok",
        accessToken: tokenFromDb || env.TIKTOK_ACCESS_TOKEN || "",
        openId: meta.openId || env.TIKTOK_OPEN_ID || "",
        status: row?.status || (env.TIKTOK_ACCESS_TOKEN ? "connected" : "disconnected")
      };
    case "x":
      return {
        platform: plat,
        handle: row?.handle || env.X_HANDLE || "x",
        accessToken: tokenFromDb || env.X_ACCESS_TOKEN || "",
        accessSecret: meta.accessSecret || env.X_ACCESS_SECRET || "",
        apiKey: meta.apiKey || env.X_API_KEY || "",
        apiSecret: meta.apiSecret || env.X_API_SECRET || "",
        bearer: env.X_BEARER_TOKEN || "",
        status:
          row?.status ||
          (env.X_ACCESS_TOKEN || env.X_BEARER_TOKEN ? "connected" : "disconnected")
      };
    case "linkedin":
      return {
        platform: plat,
        handle: row?.handle || env.LINKEDIN_HANDLE || "linkedin",
        accessToken: tokenFromDb || env.LINKEDIN_ACCESS_TOKEN || "",
        authorUrn: meta.authorUrn || env.LINKEDIN_AUTHOR_URN || "",
        status:
          row?.status ||
          (env.LINKEDIN_ACCESS_TOKEN && env.LINKEDIN_AUTHOR_URN ? "connected" : "disconnected")
      };
    case "youtube":
      return {
        platform: plat,
        handle: row?.handle || env.YOUTUBE_HANDLE || "youtube",
        accessToken: tokenFromDb || env.YOUTUBE_ACCESS_TOKEN || "",
        refreshToken: meta.refreshToken || env.YOUTUBE_REFRESH_TOKEN || "",
        clientId: meta.clientId || env.YOUTUBE_CLIENT_ID || "",
        clientSecret: meta.clientSecret || env.YOUTUBE_CLIENT_SECRET || "",
        status:
          row?.status ||
          (env.YOUTUBE_REFRESH_TOKEN || env.YOUTUBE_ACCESS_TOKEN ? "connected" : "disconnected")
      };
    default:
      return { platform: plat, status: "disconnected", accessToken: "" };
  }
}

export function isAccountReady(creds) {
  if (!creds || creds.status === "disconnected") return false;
  switch (creds.platform) {
    case "instagram":
      return Boolean(creds.accessToken && (creds.igUserId || creds.pageId));
    case "facebook":
      return Boolean(creds.accessToken && creds.pageId);
    case "tiktok":
      return Boolean(creds.accessToken);
    case "x":
      return Boolean(
        (creds.accessToken && creds.accessSecret && creds.apiKey && creds.apiSecret) ||
          creds.accessToken ||
          creds.bearer
      );
    case "linkedin":
      return Boolean(creds.accessToken && creds.authorUrn);
    case "youtube":
      return Boolean(creds.accessToken || (creds.refreshToken && creds.clientId));
    default:
      return false;
  }
}
