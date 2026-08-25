/**
 * Listing photo URLs — upgrade portal thumbs and send remote JPEGs
 * through the Hub sharpener (`/api/rent/photo`).
 */

import { isLocalGhanaMedia } from "./listing-images.mjs";

const ENHANCE_CDN =
  /images\.ghanapropertycentre\.com|jijistatic|img\.jiji|pictures-ghana|meqasa\.com|images\.bayut|propertyfinder|dubizzle|cloudfront\.net/i;

export function isAlreadyEnhancedPhoto(url = "") {
  const u = String(url || "");
  return (
    /\/api\/rent\/photo(?:\?|$)/i.test(u) ||
    /\/uploads\/enhanced\//i.test(u)
  );
}

export function jijiDecodedSize(url = "") {
  const m = String(url).match(/_([A-Za-z0-9+/=]+)\.(?:jpe?g|png|webp)(?:\?|$)/i);
  if (!m) return 0;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const w = Number(String(decoded).split("-")[0]);
    return Number.isFinite(w) ? w : 0;
  } catch {
    return 0;
  }
}

/** Prefer full-size GPC photos over SERP thumbs. Jiji CDN hashes block size swaps. */
export function upgradePortalImageUrl(url = "") {
  const u = String(url || "").trim().split("?")[0];
  if (!u) return u;
  if (/images\.ghanapropertycentre\.com\/properties\/images\/thumbs\//i.test(u)) {
    return u.replace(/\/properties\/images\/thumbs\//i, "/properties/images/");
  }
  return u;
}

export function isEnhanceableRemotePhoto(url = "") {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (/\.svg(?:\?|$)/i.test(u)) return false;
  return ENHANCE_CDN.test(u);
}

export function listingPhotoSrc(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  if (isAlreadyEnhancedPhoto(raw)) return raw;
  if (isLocalGhanaMedia(raw) || raw.startsWith("/uploads/") || raw.startsWith("/gh-media/")) {
    return raw;
  }
  const upgraded = upgradePortalImageUrl(raw);
  if (!isEnhanceableRemotePhoto(upgraded)) return upgraded;
  return `/api/rent/photo?u=${encodeURIComponent(upgraded)}`;
}

export function listingPhotoSrcs(urls = []) {
  return [...new Set((urls || []).map(String).filter(Boolean).map(listingPhotoSrc))];
}
