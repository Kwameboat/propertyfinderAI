/**
 * Free stock photo sourcing for flyers.
 * Prefers Pexels / Unsplash when keys exist; Wikimedia Commons as no-key fallback.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function pexelsKey() {
  return String(process.env.PEXELS_API_KEY || "").trim();
}
function unsplashKey() {
  return String(process.env.UNSPLASH_ACCESS_KEY || "").trim();
}

async function searchPexels(query, { perPage = 4 } = {}) {
  const key = pexelsKey();
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`;
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.photos || []).map((p) => ({
    source: "pexels",
    id: String(p.id),
    url: p.src?.large2x || p.src?.large || p.src?.original,
    photographer: p.photographer || "",
    pageUrl: p.url || ""
  })).filter((p) => p.url);
}

async function searchUnsplash(query, { perPage = 4 } = {}) {
  const key = unsplashKey();
  if (!key) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`;
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${key}` },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.results || []).map((p) => ({
    source: "unsplash",
    id: String(p.id),
    url: p.urls?.regular || p.urls?.full,
    photographer: p.user?.name || "",
    pageUrl: p.links?.html || ""
  })).filter((p) => p.url);
}

async function searchWikimedia(query, { perPage = 4 } = {}) {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
    encodeURIComponent(query) +
    `&gsrlimit=${perPage}&gsrnamespace=6&prop=imageinfo&iiprop=url|mime&format=json&origin=*`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return [];
  const json = await res.json();
  const pages = Object.values(json?.query?.pages || {});
  return pages
    .map((p) => {
      const info = p.imageinfo?.[0];
      if (!info?.url || !String(info.mime || "").startsWith("image/")) return null;
      return {
        source: "wikimedia",
        id: String(p.pageid),
        url: info.url,
        photographer: "Wikimedia Commons",
        pageUrl: `https://commons.wikimedia.org/?curid=${p.pageid}`
      };
    })
    .filter(Boolean);
}

export function stockQueriesFromBrief({ roles = "", location = "", topic = "" } = {}) {
  const base = String(roles || topic || "professional workers").trim();
  const loc = String(location || "").trim();
  const q1 = [base, loc, "portrait"].filter(Boolean).join(" ");
  const q2 = /clean/i.test(base)
    ? "professional cleaner uniform portrait"
    : /security/i.test(base)
      ? "security guard uniform portrait"
      : /driver/i.test(base)
        ? "professional driver portrait"
        : /salon|beauty/i.test(base)
          ? "beauty salon stylist portrait"
          : `${base} people portrait`;
  return [q1, q2];
}

async function downloadImage(url, outPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`stock download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  return outPath;
}

/**
 * Fetch 1–2 free stock portraits for flyer composition.
 */
export async function fetchStockImagesForBrief(baseDir, brief = {}) {
  const dir = path.join(baseDir, "social", "stock");
  mkdirSync(dir, { recursive: true });
  const queries = stockQueriesFromBrief(brief);
  let photos = [];
  for (const q of queries) {
    const batch =
      (await searchPexels(q, { perPage: 3 })) ||
      [];
    photos.push(...batch);
  }
  if (photos.length < 2) {
    for (const q of queries) photos.push(...(await searchUnsplash(q, { perPage: 3 })));
  }
  if (photos.length < 2) {
    for (const q of queries) photos.push(...(await searchWikimedia(q, { perPage: 3 })));
  }

  // de-dupe by id
  const seen = new Set();
  photos = photos.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const picked = photos.slice(0, 2);
  const saved = [];
  for (const photo of picked) {
    const stamp = createHash("sha1").update(`${photo.source}:${photo.id}`).digest("hex").slice(0, 10);
    const ext = photo.url.includes(".png") ? "png" : "jpg";
    const outPath = path.join(dir, `stock-${stamp}.${ext}`);
    try {
      await downloadImage(photo.url, outPath);
      saved.push({ ...photo, path: outPath });
    } catch {
      /* skip */
    }
  }
  return saved;
}
