/**
 * PropertyFinder Gh standalone PWA service worker — network-first app shell.
 */
const BUILD = "1791245657133";
const CACHE = `fie-ai-${BUILD}`;
const PRECACHE = [
  "/",
  `/rent.css?v=${BUILD}`,
  `/rent.js?v=${BUILD}`,
  `/rent-pwa.js?v=${BUILD}`,
  "/manifest.webmanifest",
  "/fie-pwa-icon-192.png",
  "/fie-pwa-icon-512.png",
  "/fie-pwa-icon-maskable-512.png",
  "/fie-apple-touch-icon.png",
  "/fie-ai-logo.webp"
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
  return url.pathname.startsWith("/api/");
}

function isAppShell(url) {
  const p = url.pathname;
  return (
    p === "/" ||
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
      return (await cache.match("/")) || Response.error();
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
  if (isApi(url)) return;
  if (req.mode === "navigate" || isAppShell(url)) {
    event.respondWith(networkFirst(req, req.mode === "navigate" ? "/" : req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});
