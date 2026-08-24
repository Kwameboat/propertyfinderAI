/**
 * Browser OAuth for agency social accounts (no manual access-token paste).
 * Requires one-time developer App ID/Secret per network in .env.
 */

import { createHmac, randomBytes, createHash } from "node:crypto";
import { upsertSocialAccount } from "./hub-db/social.mjs";

function env(key, ...alts) {
  for (const k of [key, ...alts]) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

export function publicHubBase() {
  return String(process.env.JAB_HUB_PUBLIC_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
}

export function oauthCallbackUrl(platform) {
  return `${publicHubBase()}/api/social/oauth/${platform}/callback`;
}

export function oauthAppConfig() {
  const metaId = env("META_APP_ID", "FACEBOOK_APP_ID");
  const metaSecret = env("META_APP_SECRET", "FACEBOOK_APP_SECRET");
  const googleId = env("GOOGLE_CLIENT_ID", "YOUTUBE_CLIENT_ID");
  const googleSecret = env("GOOGLE_CLIENT_SECRET", "YOUTUBE_CLIENT_SECRET");
  return {
    instagram: { ready: Boolean(metaId && metaSecret), appId: metaId, label: "Meta (Instagram)" },
    facebook: { ready: Boolean(metaId && metaSecret), appId: metaId, label: "Meta (Facebook)" },
    tiktok: {
      ready: Boolean(env("TIKTOK_CLIENT_KEY") && env("TIKTOK_CLIENT_SECRET")),
      appId: env("TIKTOK_CLIENT_KEY"),
      label: "TikTok"
    },
    x: {
      ready: Boolean(env("X_CLIENT_ID", "X_API_KEY") && env("X_CLIENT_SECRET", "X_API_SECRET")),
      appId: env("X_CLIENT_ID", "X_API_KEY"),
      label: "X"
    },
    linkedin: {
      ready: Boolean(env("LINKEDIN_CLIENT_ID") && env("LINKEDIN_CLIENT_SECRET")),
      appId: env("LINKEDIN_CLIENT_ID"),
      label: "LinkedIn"
    },
    youtube: {
      ready: Boolean(googleId && googleSecret),
      appId: googleId,
      label: "YouTube (Google)"
    }
  };
}

function stateSecret() {
  return createHash("sha256")
    .update(env("JAB_SOCIAL_TOKEN_SECRET", "HUB_ADMIN_PASSWORD") || "jab-social-oauth")
    .digest();
}

export function signOAuthState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, n: randomBytes(8).toString("hex") })).toString(
    "base64url"
  );
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOAuthState(raw, maxAgeMs = 15 * 60 * 1000) {
  const [body, sig] = String(raw || "").split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  if (expect !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data?.ts || Date.now() - Number(data.ts) > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}

export function buildOAuthAuthorizeUrl(platform, state) {
  const p = String(platform || "").toLowerCase();
  const redirect = oauthCallbackUrl(p === "instagram" ? "meta" : p === "facebook" ? "meta" : p);
  // Instagram + Facebook share Meta OAuth under /meta/
  const metaRedirect = oauthCallbackUrl("meta");

  if (p === "instagram" || p === "facebook") {
    const appId = env("META_APP_ID", "FACEBOOK_APP_ID");
    if (!appId) throw new Error("Set META_APP_ID and META_APP_SECRET in Hub .env first");
    const scopes = [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "pages_manage_metadata",
      "business_management",
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_insights"
    ].join(",");
    const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    u.searchParams.set("client_id", appId);
    u.searchParams.set("redirect_uri", metaRedirect);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", scopes);
    u.searchParams.set("response_type", "code");
    return u.toString();
  }

  if (p === "tiktok") {
    const key = env("TIKTOK_CLIENT_KEY");
    if (!key) throw new Error("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET first");
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", key);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "user.info.basic,video.publish,video.upload");
    return u.toString();
  }

  if (p === "x") {
    const clientId = env("X_CLIENT_ID", "X_API_KEY");
    if (!clientId) throw new Error("Set X_CLIENT_ID and X_CLIENT_SECRET first");
    const u = new URL("https://twitter.com/i/oauth2/authorize");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("scope", "tweet.read tweet.write users.read offline.access media.write");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", "challenge");
    u.searchParams.set("code_challenge_method", "plain");
    return u.toString();
  }

  if (p === "linkedin") {
    const clientId = env("LINKEDIN_CLIENT_ID");
    if (!clientId) throw new Error("Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET first");
    const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", "openid profile w_member_social");
    return u.toString();
  }

  if (p === "youtube") {
    const clientId = env("GOOGLE_CLIENT_ID", "YOUTUBE_CLIENT_ID");
    if (!clientId) throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first");
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube");
    u.searchParams.set("state", state);
    return u.toString();
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

async function exchangeMetaCode(code) {
  const appId = env("META_APP_ID", "FACEBOOK_APP_ID");
  const appSecret = env("META_APP_SECRET", "FACEBOOK_APP_SECRET");
  const redirect = oauthCallbackUrl("meta");
  const tokenUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirect);
  tokenUrl.searchParams.set("code", code);
  const shortRes = await fetch(tokenUrl);
  const shortJson = await shortRes.json();
  if (!shortRes.ok || !shortJson.access_token) {
    throw new Error(shortJson?.error?.message || "Meta token exchange failed");
  }
  const longUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortJson.access_token);
  const longRes = await fetch(longUrl);
  const longJson = await longRes.json();
  const userToken = longJson.access_token || shortJson.access_token;

  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`
  );
  const pagesJson = await pagesRes.json();
  if (!pagesRes.ok) throw new Error(pagesJson?.error?.message || "Could not list Facebook Pages");
  return { userToken, pages: pagesJson.data || [] };
}

export async function completeMetaOAuth(db, code) {
  const { pages } = await exchangeMetaCode(code);
  if (!pages.length) {
    throw new Error(
      "No Facebook Pages found. Create a Facebook Page, link Instagram as Professional, then try again."
    );
  }
  const connected = [];
  for (const page of pages) {
    const pageToken = page.access_token;
    const pageId = page.id;
    const pageName = page.name || pageId;
    upsertSocialAccount(db, {
      platform: "facebook",
      handle: pageName,
      externalId: pageId,
      accessToken: pageToken,
      status: "connected",
      meta: { pageId, pageName }
    });
    connected.push({ platform: "facebook", handle: pageName, externalId: pageId });

    const ig = page.instagram_business_account;
    if (ig?.id) {
      upsertSocialAccount(db, {
        platform: "instagram",
        handle: ig.username ? `@${ig.username}` : ig.id,
        externalId: ig.id,
        accessToken: pageToken,
        status: "connected",
        meta: { pageId, igUserId: ig.id, igUsername: ig.username || "" }
      });
      connected.push({
        platform: "instagram",
        handle: ig.username ? `@${ig.username}` : ig.id,
        externalId: ig.id
      });
    }
  }
  return connected;
}

export async function completeTikTokOAuth(db, code) {
  const redirect = oauthCallbackUrl("tiktok");
  const body = new URLSearchParams({
    client_key: env("TIKTOK_CLIENT_KEY"),
    client_secret: env("TIKTOK_CLIENT_SECRET"),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirect
  });
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json();
  const data = json.data || json;
  if (!res.ok || !data.access_token) {
    throw new Error(json?.error_description || json?.message || "TikTok OAuth failed");
  }
  upsertSocialAccount(db, {
    platform: "tiktok",
    handle: data.open_id || "tiktok",
    externalId: data.open_id || "tiktok",
    accessToken: data.access_token,
    status: "connected",
    meta: {
      openId: data.open_id || "",
      refreshToken: data.refresh_token || ""
    }
  });
  return [{ platform: "tiktok", handle: data.open_id || "tiktok" }];
}

export async function completeXOAuth(db, code) {
  const clientId = env("X_CLIENT_ID", "X_API_KEY");
  const clientSecret = env("X_CLIENT_SECRET", "X_API_SECRET");
  const redirect = oauthCallbackUrl("x");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirect,
    code_verifier: "challenge"
  });
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json?.error_description || json?.error || "X OAuth failed");
  }
  let handle = "x";
  try {
    const me = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${json.access_token}` }
    });
    const meJson = await me.json();
    handle = meJson?.data?.username ? `@${meJson.data.username}` : handle;
  } catch {
    /* optional */
  }
  upsertSocialAccount(db, {
    platform: "x",
    handle,
    externalId: handle,
    accessToken: json.access_token,
    status: "connected",
    meta: {
      refreshToken: json.refresh_token || "",
      apiKey: clientId,
      apiSecret: clientSecret,
      // OAuth2 bearer path — publishers may need OAuth1 for media; store refresh for later
      oauth2: true
    }
  });
  return [{ platform: "x", handle }];
}

export async function completeLinkedInOAuth(db, code) {
  const redirect = oauthCallbackUrl("linkedin");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    client_id: env("LINKEDIN_CLIENT_ID"),
    client_secret: env("LINKEDIN_CLIENT_SECRET")
  });
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json?.error_description || "LinkedIn OAuth failed");
  }
  const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${json.access_token}` }
  });
  const me = await meRes.json().catch(() => ({}));
  const sub = me.sub || "linkedin";
  const authorUrn = `urn:li:person:${sub}`;
  upsertSocialAccount(db, {
    platform: "linkedin",
    handle: me.name || me.email || sub,
    externalId: sub,
    accessToken: json.access_token,
    status: "connected",
    meta: { authorUrn, refreshToken: json.refresh_token || "" }
  });
  return [{ platform: "linkedin", handle: me.name || sub }];
}

export async function completeYouTubeOAuth(db, code) {
  const clientId = env("GOOGLE_CLIENT_ID", "YOUTUBE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET", "YOUTUBE_CLIENT_SECRET");
  const redirect = oauthCallbackUrl("youtube");
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirect,
    grant_type: "authorization_code"
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json?.error_description || "YouTube OAuth failed");
  }
  upsertSocialAccount(db, {
    platform: "youtube",
    handle: "youtube",
    externalId: "youtube",
    accessToken: json.access_token,
    status: "connected",
    meta: {
      refreshToken: json.refresh_token || "",
      clientId,
      clientSecret
    }
  });
  return [{ platform: "youtube", handle: "youtube" }];
}

export async function completeOAuthForPlatform(db, platform, code) {
  const p = String(platform || "").toLowerCase();
  if (p === "meta" || p === "instagram" || p === "facebook") return completeMetaOAuth(db, code);
  if (p === "tiktok") return completeTikTokOAuth(db, code);
  if (p === "x") return completeXOAuth(db, code);
  if (p === "linkedin") return completeLinkedInOAuth(db, code);
  if (p === "youtube") return completeYouTubeOAuth(db, code);
  throw new Error(`Unknown OAuth platform ${platform}`);
}
