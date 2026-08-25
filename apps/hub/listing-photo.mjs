/**
 * Fetch a portal listing photo, upscale small Jiji JPEGs, and sharpen.
 * Cached under uploads/enhanced/*.webp
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isEnhanceableRemotePhoto, upgradePortalImageUrl } from "../../packages/real-estate/listing-photo-url.mjs";

const require = createRequire(import.meta.url);
const MAX_BYTES = 6_000_000;
const FETCH_MS = 25000;
const inflight = new Map();

function loadSharp() {
  try {
    return require("sharp");
  } catch {
    return null;
  }
}

function cachePathFor(uploadsDir, url) {
  const key = createHash("sha256").update(url).digest("hex").slice(0, 24);
  return path.join(uploadsDir, "enhanced", `${key}.webp`);
}

function fetchHeaders(url) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9"
  };
  if (/jiji|jijistatic|pictures-ghana/i.test(url)) headers.Referer = "https://jiji.com.gh/";
  else if (/ghanapropertycentre/i.test(url)) headers.Referer = "https://ghanapropertycentre.com/";
  else if (/meqasa/i.test(url)) headers.Referer = "https://meqasa.com/";
  return headers;
}

async function fetchRemoteBytes(url) {
  const res = await fetch(url, {
    headers: fetchHeaders(url),
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_MS)
  });
  if (!res.ok) throw new Error(`photo fetch ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("photo too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("photo too large");
  return buf;
}

export async function enhanceImageBuffer(buf, { strong = true } = {}) {
  const sharp = loadSharp();
  if (!sharp) return null;
  const image = sharp(buf, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const srcW = Number(meta.width) || 400;
  let scale = 1;
  if (srcW < 480) scale = 3;
  else if (srcW < 900) scale = 2;
  const width = Math.min(1600, Math.max(srcW, Math.round(srcW * scale)));
  let pipeline = image.resize({
    width,
    withoutEnlargement: false,
    kernel: sharp.kernel.lanczos3
  });
  if (strong) {
    pipeline = pipeline
      .modulate({ brightness: 1.06, saturation: 1.14 })
      .sharpen({ sigma: 1.8, m1: 2.2, m2: 0.7 });
  } else {
    pipeline = pipeline.sharpen({ sigma: 1.1, m1: 1.2, m2: 0.5 });
  }
  return pipeline.webp({ quality: 86, effort: 4 }).toBuffer();
}

export async function enhanceListingPhoto(sourceUrl, { uploadsDir } = {}) {
  const upgraded = upgradePortalImageUrl(sourceUrl);
  if (!uploadsDir || !isEnhanceableRemotePhoto(upgraded)) return null;
  const dest = cachePathFor(uploadsDir, upgraded);
  try {
    const info = await stat(dest);
    if (info.size > 0) return dest;
  } catch {
    /* miss */
  }
  if (inflight.has(dest)) return inflight.get(dest);

  const job = (async () => {
    await mkdir(path.dirname(dest), { recursive: true });
    const raw = await fetchRemoteBytes(upgraded);
    const strong = /jiji|jijistatic|pictures-ghana/i.test(upgraded) || (raw.length < 40_000);
    const out = await enhanceImageBuffer(raw, { strong });
    if (!out?.length) return null;
    await writeFile(dest, out);
    return dest;
  })();

  inflight.set(dest, job);
  try {
    return await job;
  } finally {
    inflight.delete(dest);
  }
}

export async function enhanceOwnerPhotoBuffer(buf) {
  const out = await enhanceImageBuffer(buf, { strong: true });
  return out || buf;
}
