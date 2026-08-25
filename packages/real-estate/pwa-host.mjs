/**
 * Ghana FIE AI PWA lives on Dar Concierge's HTTPS host at /gh so Chrome
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
    ['content="Dar Concierge"', 'content="FIE AI"'],
    ['content="Dar Concierge AI"', 'content="FIE AI"'],
    [">Dar Concierge AI · KeyFinder AI</title>", ">FIE AI · Ghana</title>"],
    [
      "Dar Concierge AI — Your UAE AI Property Assistant. Powered by KeyFinder AI. Rent, buy, off-plan across the emirates.",
      "FIE AI — your AI real estate agent in Ghana. Rent or buy rooms, self-contains, apartments, and houses."
    ],
    ["Dar Concierge opens like an app.", "FIE AI opens like an app."]
  ];
  for (const [from, to] of swaps) out = out.split(from).join(to);
  out = out.replace(
    'navigator.serviceWorker.register("/sw.js", { scope: "/" })',
    `navigator.serviceWorker.register("${prefix}/sw.js", { scope: "${prefix}", updateViaCache: "none" })`
  );
  out = out.replace(
    'navigator.serviceWorker.register("/rent-sw.js", { scope: "/" })',
    `navigator.serviceWorker.register("${prefix}/sw.js", { scope: "${prefix}", updateViaCache: "none" })`
  );
  out = out.replace(/\?v=fie-buy/g, `?v=${build}`);
  out = out.replace(/\?v=logo/g, `?v=${build}`);
  return out;
}

export function fillGhanaServiceWorker(source, { buildId } = {}) {
  return String(source).replaceAll("__PWA_BUILD__", String(buildId || "1"));
}
