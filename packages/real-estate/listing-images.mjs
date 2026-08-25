/**
 * Fetch property listing images from portal pages (Jina Reader + URL patterns).
 */

const CDN_HINTS = /images\.bayut|propertyfinder|dubizzle|cloudinary|akamai|amazonaws/i;
const LISTING_IMAGE = /\/listing\/|images\.bayut\.com\/|media\/images\/listing|\/photos?\//i;
const JUNK_IMAGE =
  /nav_header|mf-logo|serp-hero|placeholder|banner\.webp|static\/nav|growth\.propertyfinder|\.svg(?:\?|$)|favicon|apple-touch|1x1|sprite|avatar|logo|unsplash|pexels|pixabay|shutterstock|gettyimages|stock-photo|placeholder\.com|via\.placeholder/i;

export function extractImagesFromText(text = "") {
  const src = String(text || "");
  const found = new Set();

  const patterns = [
    /!\[[^\]]*\]\((https?:\/\/[^)\s"'<>]+)\)/gi,
    /(?:data-src|src)=["'](https?:\/\/[^"']+)["']/gi,
    /"(?:image|photo|thumbnail|cover(?:Photo)?|url)":\s*"(https?:\/\/[^"]+)"/gi,
    /(https?:\/\/images\.bayut\.com\/[^\s"'<>]+)/gi,
    /(https?:\/\/static\.shared\.propertyfinder\.ae\/[^\s"'<>]+)/gi,
    /(https?:\/\/www\.propertyfinder\.ae\/property\/[^\s"'<>]+)/gi,
    /(https?:\/\/[^\s"'<>]*propertyfinder[^\s"'<>]*(?:\/images\/|\/property\/|photo|media\/images\/listing)[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*dubizzle[^\s"'<>]*(?:\.jpg|\.jpeg|\.png|\.webp|listing)[^\s"'<>]*)/gi
  ];

  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const url = (m[1] || m[0] || "").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
      if (isValidListingImage(url)) found.add(url);
    }
  }

  return [...found].slice(0, 12);
}

const PORTAL_HOST =
  /(?:^|\.)(?:bayut\.com|bayutcdn\.com|propertyfinder\.ae|propertyfinder\.com|dubizzle\.com|dubizzle\.ae)$/i;
const PORTAL_LISTING_CDN =
  /images\.bayut\.com|bayutcdn|static\.shared\.propertyfinder|static\.propertyfinder|propertyfinder\.ae\/(?:property|images|photos?|picture)|media\.images\.listing|\/listing\/|dubizzle\.(?:com|ae).*\/(?:photos?|images?|pictures?)/i;

export function isValidListingImage(url = "") {
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (JUNK_IMAGE.test(u)) return false;
  if (/logo|icon|pixel|badge/i.test(u) && !LISTING_IMAGE.test(u)) return false;
  if (/\.(?:svg|gif)(?:\?|$)/i.test(u)) return false;
  if (LISTING_IMAGE.test(u)) return true;
  if (PORTAL_LISTING_CDN.test(u)) return true;
  if (/\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(u) && CDN_HINTS.test(u)) return true;
  return false;
}

/** Stricter gate — real portal listing photos only (blocks stock/generic JPGs). */
export function isValidPortalListingImage(url = "") {
  if (!isValidListingImage(url)) return false;
  const u = String(url);
  if (PORTAL_LISTING_CDN.test(u)) return true;
  if (LISTING_IMAGE.test(u) && CDN_HINTS.test(u)) return true;
  try {
    const host = new URL(u).hostname;
    if (PORTAL_HOST.test(host) && /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(u)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function filterValidPortalImages(images = []) {
  return [...new Set((images || []).filter(Boolean).map(String))].filter(isValidPortalListingImage);
}

/** Keep whichever image set actually has portal photos. */
export function preferListingImages(primary = [], fallback = []) {
  const a = filterValidPortalImages(primary);
  const b = filterValidPortalImages(fallback);
  if (a.length >= b.length && a.length) return a;
  if (b.length) return b;
  const looseA = [...new Set((primary || []).filter(Boolean).map(String))].filter(isValidListingImage);
  const looseB = [...new Set((fallback || []).filter(Boolean).map(String))].filter(isValidListingImage);
  return looseA.length >= looseB.length ? looseA : looseB;
}

export async function fetchListingImages(sourceUrl = "", { markdown = "" } = {}) {
  let images = extractImagesFromText(markdown);
  if (images.length >= 2) return images;

  const url = String(sourceUrl || "").trim();
  if (!url) return images;

  try {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: "text/markdown",
        "X-Return-Format": "markdown"
      },
      signal: AbortSignal.timeout(45000)
    });
    if (res.ok) {
      const md = await res.text();
      images = [...new Set([...images, ...extractImagesFromText(md)])].slice(0, 12);
    }
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), fetchListingImagesError: error.message, url: url.slice(0, 80) }));
  }

  return images.filter(isValidListingImage).slice(0, 12);
}

export async function enrichListingsWithImages(listings = [], { minImages = 1 } = {}) {
  const out = [];
  for (const listing of listings) {
    const existing = filterValidPortalImages([
      ...(Array.isArray(listing.images) ? listing.images : []),
      listing.image
    ].filter(Boolean));
    if (existing.length >= minImages) {
      out.push({ ...listing, images: existing });
      continue;
    }
    const fetched = await fetchListingImages(listing.source_url, {});
    const merged = filterValidPortalImages([...existing, ...fetched]).slice(0, 12);
    out.push({ ...listing, images: merged });
  }
  return out;
}

export function isLocalGhanaMedia(url = "") {
  return /^\/gh-media\/[A-Za-z0-9._-]+\.(?:svg|png|jpe?g|webp)$/i.test(String(url).trim());
}

export function isChatListingImage(url = "") {
  return isLocalGhanaMedia(url) || isValidListingImage(url);
}

export function listingHasRealPhotos(listing = {}) {
  const imgs = filterValidPortalImages(listing.images || (listing.image ? [listing.image] : []));
  return imgs.length > 0;
}

export function listingHasPhotos(listing = {}) {
  return listingHasRealPhotos(listing);
}
