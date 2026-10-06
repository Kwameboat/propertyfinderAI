/**
 * Ghana PropertyFinder Gh PWA lives on Dar Concierge's HTTPS host at /gh so Chrome
 * will install it (secure context) without colliding with UAE /rent, /sw.js,
 * or /api/rent on the same origin.
 */
import { statSync } from "node:fs";
import path from "node:path";

export const GHANA_HTTPS_ORIGIN = "https://wa.jabdigitalhub.com";
export const GHANA_PWA_PATH = "/gh";

export function ghanaPublicPrefix() {
  return GHANA_PWA_PATH;
}

export function ghanaHttpsOrigin() {
  const raw = String(process.env.JAB_RENT_HTTPS_ORIGIN || GHANA_HTTPS_ORIGIN).trim();
  if (!raw || /^(off|0|false)$/i.test(raw)) return GHANA_HTTPS_ORIGIN;
  return raw.replace(/\/$/, "");
}

export function pwaBuildId(publicDir) {
  if (process.env.JAB_PWA_BUILD) return String(process.env.JAB_PWA_BUILD).trim();
  const files = [
    "rent.js",
    "rent.css",
    "rent.html",
    "rent-pwa.js",
    "gh-sw.js",
    "gh-manifest.webmanifest",
    "fie-ai-logo.webp"
  ];
  let max = 0;
  for (const file of files) {
    try {
      max = Math.max(max, statSync(path.join(publicDir, file)).mtimeMs);
    } catch {
      /* optional asset */
    }
  }
  return String(Math.round(max) || Date.now());
}

/** Strip the public /gh prefix so Express can reuse /api and /uploads routes. */
export function stripGhanaPublicPrefix(url) {
  const raw = String(url || "");
  const q = raw.indexOf("?");
  const pathname = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q) : "";
  if (pathname === "/gh/api" || pathname.startsWith("/gh/api/")) {
    return `${pathname.slice("/gh".length)}${search}`;
  }
  if (pathname === "/gh/uploads" || pathname.startsWith("/gh/uploads/")) {
    return `${pathname.slice("/gh".length)}${search}`;
  }
  return raw;
}

export function rewriteRentHtmlForGhana(html, { buildId } = {}) {
  const prefix = ghanaPublicPrefix();
  const build = String(buildId || "1");
  const boot = `<script>
    window.__RENT_BASE=${JSON.stringify(prefix)};
    window.__RENT_API=${JSON.stringify(`${prefix}/api/rent`)};
    window.__PWA_BUILD=${JSON.stringify(build)};
    window.__RENT_HTTPS_ORIGIN=${JSON.stringify(ghanaHttpsOrigin())};
  </script>`;
  let out = String(html);
  if (!out.includes("window.__RENT_HTTPS_ORIGIN=")) {
    out = out.replace("<head>", `<head>\n  ${boot}`);
  }
  const swaps = [
    ['href="/manifest.webmanifest"', `href="${prefix}/manifest.webmanifest"`],
    ['href="/pwa-icon-192.png', `href="${prefix}/fie-pwa-icon-192.png`],
    ['href="/apple-touch-icon.png', `href="${prefix}/fie-apple-touch-icon.png`],
    ['href="/rent.css', `href="${prefix}/rent.css`],
    ['src="/rent.js', `src="${prefix}/rent.js`],
    ['src="/dar-concierge-logo.png"', `src="${prefix}/fie-ai-logo.webp"`],
    ['href="/rent"', `href="${prefix}"`],
    ['content="Dar Concierge"', 'content="PropertyFinder Gh"'],
    ['content="Dar Concierge AI"', 'content="PropertyFinder Gh"'],
    [">Dar Concierge AI · KeyFinder AI</title>", ">PropertyFinder Gh · Ghana</title>"],
    [
      "Dar Concierge AI — Your UAE AI Property Assistant. Powered by KeyFinder AI. Rent, buy, off-plan across the emirates.",
      "PropertyFinder Gh — your AI real estate agent in Ghana. Rent or buy rooms, self-contains, apartments, and houses."
    ],
    ["Dar Concierge opens like an app.", "PropertyFinder Gh opens like an app."],
    ["<body>", '<body class="market-gh">'],
    ['id="header-avatar">DC</span>', 'id="header-avatar">PF</span>'],
    [
      "Welcome. Looking for a 4BR in Ajman or a villa in Dubai today?",
      "Welcome. Looking for a self-contain in East Legon or a chamber and hall in Osu?"
    ],
    ["Powered by <strong>KeyFinder AI</strong>", "Your AI real estate agent in Ghana"],
    [
      'data-msg="Show me penthouses for rent in Dubai Marina">Marina Penthouses',
      'data-msg="Show me self-contain rooms for rent in East Legon">East Legon self-contain'
    ],
    [
      'data-msg="I\'m looking for a villa to rent in JVC, 3 bed">JVC Villas',
      'data-msg="Show me houses for sale in East Legon">East Legon for sale'
    ],
    ['placeholder="Ask Dar Concierge AI…"', 'placeholder="Ask PropertyFinder Gh — type or tap the mic"'],
    ["<strong>Install Dar Concierge</strong>", "<strong>Install PropertyFinder Gh</strong>"],
    [
      "Use Dar Concierge like a native app — home screen icon, offline shell, no browser chrome.",
      "Use PropertyFinder Gh like a native app — home screen icon, and it updates itself when you open it."
    ],
    ['class="pill gh-only hidden"', 'class="pill gh-only"'],
    ['id="gh-pay-monthly-pill" hidden', 'id="gh-pay-monthly-pill"'],
    ['id="gh-twi-pill" hidden', 'id="gh-twi-pill"'],
    ['class="gold-btn list-property-cta gh-only hidden"', 'class="gold-btn list-property-cta gh-only"'],
    ['id="list-property-btn" hidden', 'id="list-property-btn"'],
    ['class="muted list-property-hint gh-only hidden"', 'class="muted list-property-hint gh-only"']
  ];
  for (const [from, to] of swaps) out = out.split(from).join(to);
  out = out.replace(
    'navigator.serviceWorker.register("/sw.js", { scope: "/" })',
    `navigator.serviceWorker.register("${prefix}/gh-sw.js", { scope: "${prefix}", updateViaCache: "none" })`
  );
  out = out.replace(
    'navigator.serviceWorker.register("/rent-sw.js", { scope: "/" })',
    `navigator.serviceWorker.register("${prefix}/gh-sw.js", { scope: "${prefix}", updateViaCache: "none" })`
  );
  out = out.replace(/\?v=fie-buy/g, `?v=${build}`);
  out = out.replace(/\?v=logo/g, `?v=${build}`);
  return out;
}

export function fillGhanaServiceWorker(source, { buildId } = {}) {
  return String(source).replaceAll("__PWA_BUILD__", String(buildId || "1"));
}

export function ghanaLoginPath() {
  return `${GHANA_PWA_PATH}/login`;
}

export function ghanaAdminPath() {
  return `${GHANA_PWA_PATH}/admin/re`;
}

/** Keep post-login redirects on /gh so they are not swallowed by Evolution on wa.jabdigitalhub.com. */
export function ghanaSafeNextPath(next) {
  const fallback = ghanaAdminPath();
  const raw = String(next || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return fallback;
  const pathOnly = raw.split("?")[0];
  if (pathOnly === "/admin/re" || pathOnly.startsWith("/admin/re/") || pathOnly === "/admin/listings") {
    return `${GHANA_PWA_PATH}${raw}`;
  }
  if (pathOnly === "/" || pathOnly === "/login" || pathOnly === "/login.html") return fallback;
  if (pathOnly === GHANA_PWA_PATH || pathOnly.startsWith(`${GHANA_PWA_PATH}/`)) return raw;
  return fallback;
}

/** Prefix Hub login/dashboard assets so they work on https://wa.jabdigitalhub.com/gh. */
export function rewriteHubHtmlForGhana(html) {
  const prefix = ghanaPublicPrefix();
  const boot = `<script>window.__HUB_BASE=${JSON.stringify(prefix)};</script>`;
  let out = String(html);
  if (!out.includes("window.__HUB_BASE")) {
    out = out.replace("<head>", `<head>\n  ${boot}`);
  }
  const swaps = [
    ['href="/styles.css"', `href="${prefix}/styles.css"`],
    ['href="/re-admin.css', `href="${prefix}/re-admin.css`],
    ['src="/re-admin.js', `src="${prefix}/re-admin.js`],
    ['src="/dar-concierge-logo.png"', `src="${prefix}/fie-ai-logo.webp"`],
    ['href="/login"', `href="${prefix}/login"`],
    ['href="/agent-login"', `href="${prefix}/agent-login"`],
    ['href="/admin/re"', `href="${prefix}/admin/re"`],
    ['fetch("/api/', `fetch("${prefix}/api/`],
    ["JAB Hub — Login", "PropertyFinder Gh — Agency login"],
    ["JAB HUB", "PropertyFinder Gh"],
    ["Manage per-client contacts and WhatsApp campaigns.", "Manage PropertyFinder Gh listings, viewings, and Ghana ingest."]
  ];
  for (const [from, to] of swaps) out = out.split(from).join(to);
  return out;
}

