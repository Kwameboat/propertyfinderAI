import test from "node:test";
import assert from "node:assert/strict";
import {
  fillGhanaServiceWorker,
  rewriteHubHtmlForGhana,
  rewriteRentHtmlForGhana,
  stripGhanaPublicPrefix
} from "../packages/real-estate/pwa-host.mjs";

test("Ghana public prefix maps APIs and uploads under /gh", () => {
  assert.equal(stripGhanaPublicPrefix("/gh/api/rent/config"), "/api/rent/config");
  assert.equal(stripGhanaPublicPrefix("/gh/api/rent/chat?x=1"), "/api/rent/chat?x=1");
  assert.equal(stripGhanaPublicPrefix("/gh/uploads/owner-listings/a.jpg"), "/uploads/owner-listings/a.jpg");
  assert.equal(stripGhanaPublicPrefix("/gh/sw.js"), "/gh/sw.js");
  assert.equal(stripGhanaPublicPrefix("/gh"), "/gh");
  assert.equal(stripGhanaPublicPrefix("/api/rent/config"), "/api/rent/config");
});

test("Ghana HTML rewrite points the PWA at /gh assets and injects API base", () => {
  const html = `<!DOCTYPE html><html><head>
  <title>Dar Concierge AI · KeyFinder AI</title>
  <meta name="apple-mobile-web-app-title" content="Dar Concierge" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/pwa-icon-192.png?v=logo" />
  <link rel="stylesheet" href="/rent.css?v=fie-buy" />
</head><body>
  <a href="/rent"><img src="/dar-concierge-logo.png" /></a>
  <script type="module" src="/rent.js?v=fie-buy"></script>
</body></html>`;
  const out = rewriteRentHtmlForGhana(html, { buildId: "99" });
  assert.match(out, /window\.__RENT_HTTPS_ORIGIN=/);
  assert.match(out, /window\.__RENT_API="\/gh\/api\/rent"/);
  assert.match(out, /href="\/gh\/manifest\.webmanifest"/);
  assert.match(out, /href="\/gh\/rent\.css\?v=99"/);
  assert.match(out, /src="\/gh\/rent\.js\?v=99"/);
  assert.match(out, /src="\/gh\/fie-ai-logo\.webp"/);
  assert.match(out, /<title>FIE AI · Ghana<\/title>/);
  assert.match(out, /<body class="market-gh">/);
  assert.equal(out.includes('href="/rent.css'), false);
});

test("Ghana rewrite of rent.html is FIE on first paint", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../apps/hub/public/rent.html", import.meta.url), "utf8");
  const out = rewriteRentHtmlForGhana(html, { buildId: "1" });
  assert.match(out, /East Legon self-contain/);
  assert.match(out, /self-contain in East Legon/);
  assert.match(out, /Install FIE AI/);
  assert.equal(out.includes("Marina Penthouses"), false);
  assert.equal(out.includes("Looking for a 4BR in Ajman"), false);
});

test("Ghana Hub HTML rewrite prefixes login API and dashboard assets", () => {
  const html = `<!DOCTYPE html><html><head><title>JAB Hub — Login</title>
  <link rel="stylesheet" href="/styles.css" />
</head><body>
  <p class="eyebrow">JAB HUB</p>
  <script>fetch("/api/login", {})</script>
</body></html>`;
  const out = rewriteHubHtmlForGhana(html);
  assert.match(out, /window\.__HUB_BASE="\/gh"/);
  assert.match(out, /href="\/gh\/styles\.css"/);
  assert.match(out, /fetch\("\/gh\/api\/login"/);
  assert.match(out, /FIE AI — Agency login/);
});

test("Ghana service worker receives the deploy build id", () => {
  const filled = fillGhanaServiceWorker("const BUILD = \"__PWA_BUILD__\";", { buildId: "abc" });
  assert.equal(filled, "const BUILD = \"abc\";");
});
