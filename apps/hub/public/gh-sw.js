/**
 * FIE AI PWA service worker — network-first app shell, auto-activate updates.
 * __PWA_BUILD__ is replaced at serve time so every deploy gets a new cache.
 */
const BUILD = "__PWA_BUILD__";
const PREFIX = "/gh";
const CACHE = `fie-ai-${BUILD}`;
const PRECACHE = [
  PREFIX,
  `${PREFIX}/rent.css?v=${BUILD}`,
  `${PREFIX}/rent.js?v=${BUILD}`,
  `${PREFIX}/rent-pwa.js?v=${BUILD}`,
  `${PREFIX}/manifest.webmanifest`,
  `${PREFIX}/fie-pwa-icon-192.png`,
  `${PREFIX}/fie-pwa-icon-512.png`,
  `${PREFIX}/fie-pwa-icon-maskable-512.png`,
  `${PREFIX}/fie-apple-touch-icon.png`,
  `${PREFIX}/fie-ai-logo.webp`
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function isApi(url) {
  return url.pathname.startsWith(`${PREFIX}/api/`) || url.pathname.startsWith("/api/");
}

function isAppShell(url) {
  const p = url.pathname;
  return (
    p === PREFIX ||
    p === `${PREFIX}/` ||
    p.endsWith(".js") ||
    p.endsWith(".css") ||
    p.endsWith(".webmanifest") ||
    p.endsWith("sw.js")
  );
}

async function networkFirst(req, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(cacheKey || req, res.clone()).catch(() => null);
    return res;
  } catch {
    const cached = await cache.match(cacheKey || req);
    if (cached) return cached;
    if (req.mode === "navigate") {
      return (await cache.match(PREFIX)) || Response.error();
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => null);
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(PREFIX) && !url.pathname.startsWith("/api/")) return;

  if (isApi(url)) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === "navigate" || isAppShell(url)) {
    event.respondWith(networkFirst(req, req.mode === "navigate" ? PREFIX : req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});
