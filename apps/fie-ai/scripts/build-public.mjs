/**
 * Build FIE AI static PWA into apps/fie-ai/public (root-scoped, not /gh).
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteRentHtmlForGhana, pwaBuildId } from "../../../packages/real-estate/pwa-host.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, "..");
const PUBLIC = path.join(APP, "public");
const HUB_PUBLIC = path.join(APP, "..", "hub", "public");

mkdirSync(PUBLIC, { recursive: true });
mkdirSync(path.join(PUBLIC, "media"), { recursive: true });

const buildId = pwaBuildId(HUB_PUBLIC) || String(Date.now());

function copy(name, destName = name) {
  const src = path.join(HUB_PUBLIC, name);
  if (!existsSync(src)) {
    console.warn("skip missing", name);
    return;
  }
  cpSync(src, path.join(PUBLIC, destName));
}

for (const f of [
  "rent.js",
  "rent.css",
  "rent-pwa.js",
  "fie-ai-logo.webp",
  "fie-apple-touch-icon.png",
  "fie-pwa-icon-192.png",
  "fie-pwa-icon-512.png",
  "fie-pwa-icon-maskable-512.png",
  "keyfinder-ghana.svg"
]) {
  copy(f);
}

const mediaDir = path.join(HUB_PUBLIC, "gh-media");
if (existsSync(mediaDir)) {
  cpSync(mediaDir, path.join(PUBLIC, "media"), { recursive: true });
}

/** Rewrite /gh-hosted HTML to root-hosted standalone FIE AI. */
function toStandaloneHtml(ghanaHtml) {
  let html = String(ghanaHtml);
  const rootBoot = `<script>
    window.__RENT_BASE="";
    window.__RENT_API="/api/rent";
    window.__PWA_BUILD=${JSON.stringify(buildId)};
    window.__FIE_STANDALONE=true;
  </script>`;
  html = html.replace(/<script>\s*window\.__RENT_BASE=[\s\S]*?<\/script>/, rootBoot);
  if (!html.includes("window.__FIE_STANDALONE")) {
    html = html.replace("<head>", `<head>\n  ${rootBoot}`);
  }

  const swaps = [
    ['href="/gh/manifest.webmanifest"', 'href="/manifest.webmanifest"'],
    ['href="/gh/fie-pwa-icon-192.png', 'href="/fie-pwa-icon-192.png'],
    ['href="/gh/fie-apple-touch-icon.png', 'href="/fie-apple-touch-icon.png'],
    ['href="/gh/rent.css', 'href="/rent.css'],
    ['src="/gh/rent.js', 'src="/rent.js'],
    ['src="/gh/fie-ai-logo.webp"', 'src="/fie-ai-logo.webp"'],
    ['href="/gh"', 'href="/"'],
    ['"/gh/gh-sw.js"', '"/sw.js"'],
    ['scope: "/gh"', 'scope: "/"'],
    [
      'var standalone = window.__FIE_STANDALONE === true;',
      "var standalone = true;"
    ],
    [
      'var gh = standalone || location.pathname === "/gh" || location.pathname.indexOf("/gh/") === 0;',
      "var gh = true;"
    ],
    ['var swUrl = gh ? "/gh/gh-sw.js" : "/sw.js";', 'var swUrl = "/sw.js";'],
    ['var scope = gh ? "/gh" : "/";', 'var scope = "/";'],
    ["/gh-media/", "/media/"]
  ];
  for (const [from, to] of swaps) html = html.split(from).join(to);
  html = html.replace(/\?v=[^"']+/g, `?v=${buildId}`);
  return html;
}

const rentHtml = readFileSync(path.join(HUB_PUBLIC, "rent.html"), "utf8");
const ghanaHtml = rewriteRentHtmlForGhana(rentHtml, { buildId });
writeFileSync(path.join(PUBLIC, "index.html"), toStandaloneHtml(ghanaHtml));

let agent = readFileSync(path.join(HUB_PUBLIC, "gh-agent.html"), "utf8");
agent = agent
  .replaceAll("/gh/rent.css", "/rent.css")
  .replaceAll("/gh/fie-ai-logo.webp", "/fie-ai-logo.webp")
  .replaceAll('href="/gh"', 'href="/"')
  .replaceAll("/gh/api/rent/", "/api/rent/");
writeFileSync(path.join(PUBLIC, "agent.html"), agent);

const sw = `/**
 * FIE AI standalone PWA service worker — network-first app shell.
 */
const BUILD = ${JSON.stringify(buildId)};
const CACHE = \`fie-ai-\${BUILD}\`;
const PRECACHE = [
  "/",
  \`/rent.css?v=\${BUILD}\`,
  \`/rent.js?v=\${BUILD}\`,
  \`/rent-pwa.js?v=\${BUILD}\`,
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
`;
writeFileSync(path.join(PUBLIC, "sw.js"), sw);

const manifest = {
  id: "/",
  name: "FIE AI",
  short_name: "FIE AI",
  description:
    "Your AI real estate agent in Ghana — rent or buy rooms, self-contains, apartments, and houses.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  display_override: ["standalone", "minimal-ui"],
  orientation: "portrait-primary",
  background_color: "#0a0a0a",
  theme_color: "#0a0a0a",
  lang: "en",
  dir: "ltr",
  categories: ["business", "lifestyle"],
  icons: [
    { src: "/fie-pwa-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/fie-pwa-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: "/fie-pwa-icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable"
    }
  ],
  prefer_related_applications: false
};
writeFileSync(path.join(PUBLIC, "manifest.webmanifest"), JSON.stringify(manifest, null, 2));

console.log(`Built FIE AI public/ (build ${buildId})`);
