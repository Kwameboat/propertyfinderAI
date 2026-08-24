/**
 * Dar Concierge PWA service worker — offline shell + static asset cache.
 */
const CACHE = "dar-concierge-v4";
const PRECACHE = [
  "/rent",
  "/rent.html",
  "/rent.css",
  "/rent.js",
  "/rent-pwa.js",
  "/manifest.webmanifest",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/pwa-icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/dar-concierge-logo.png"
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req).catch(() => caches.match(req).then((c) => c || Response.error())));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/rent", copy));
          return res;
        })
        .catch(() => caches.match("/rent").then((r) => r || caches.match("/rent.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});
