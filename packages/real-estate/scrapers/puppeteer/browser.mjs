/**
 * Portal HTML fetch — fetch-first (VPS-friendly), Jina, Puppeteer when needed.
 */

import { fetchText, sleep, extractNextData } from "../http.mjs";
import { getPuppeteerPageDelayMs } from "../../puppeteer-mode.mjs";
import { parsePropertyFinderJinaMarkdown } from "./jina-pf.mjs";

let browserPromise = null;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function isBlockedHtml(html = "") {
  const text = String(html);
  if (hasNextData(text)) return false;
  return /captcha|are you a robot|pardon our interruption|cf-browser-verification|please verify your identity/i.test(
    text
  );
}

export function hasNextData(html = "") {
  return Boolean(extractNextData(html));
}

export async function loadPuppeteer() {
  try {
    const mod = await import("puppeteer");
    return mod.default || mod;
  } catch (error) {
    throw new Error(
      `puppeteer not installed — run: npm install puppeteer (in /opt/jab-hub). ${error.message}`
    );
  }
}

export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = await loadPuppeteer();
      return puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,900"
        ]
      });
    })();
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    /* ignore */
  }
  browserPromise = null;
}

async function fetchViaPuppeteer(url, { waitMs } = {}) {
  const delay = waitMs ?? getPuppeteerPageDelayMs();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(DEFAULT_UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-AE,en;q=0.9,ar;q=0.8" });
    await page.goto(String(url), { waitUntil: "networkidle2", timeout: 90000 });
    await sleep(delay);
    const html = await page.content();
    if (isBlockedHtml(html)) throw new Error("captcha_or_block");
    return html;
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchViaJina(url) {
  const jinaUrl = `https://r.jina.ai/${encodeURIComponent(String(url))}`;
  const response = await fetch(jinaUrl, {
    headers: { Accept: "text/markdown", "X-Return-Format": "markdown" },
    signal: AbortSignal.timeout(90000)
  });
  const markdown = await response.text();
  if (!response.ok) throw new Error(`jina HTTP ${response.status}`);
  if (/please verify your identity|captcha/i.test(markdown) && !/propertyfinder\.ae\/en\/pl\//i.test(markdown)) {
    throw new Error("jina_captcha");
  }
  return markdown;
}

/** Best-effort SERP HTML: plain fetch → Jina wrapper → Puppeteer. */
export async function fetchPortalHtml(url, { waitMs } = {}) {
  const attempts = [];

  try {
    const html = await fetchText(url, { timeoutMs: 45000 });
    if (hasNextData(html)) return { html, engine: "fetch" };
    attempts.push(isBlockedHtml(html) ? "fetch:captcha" : "fetch:no_next_data");
  } catch (error) {
    attempts.push(`fetch:${error.message}`);
  }

  if (/propertyfinder\.ae/i.test(url)) {
    try {
      const markdown = await fetchViaJina(url);
      if (/propertyfinder\.ae\/en\/pl\//i.test(markdown)) {
        return { html: markdown, engine: "jina", format: "markdown" };
      }
      attempts.push("jina:no_listings");
    } catch (error) {
      attempts.push(`jina:${error.message}`);
    }
  }

  try {
    const html = await fetchViaPuppeteer(url, { waitMs });
    if (hasNextData(html)) return { html, engine: "puppeteer" };
    attempts.push("puppeteer:no_next_data");
  } catch (error) {
    attempts.push(`puppeteer:${error.message}`);
  }

  throw new Error(attempts.join("; ") || "captcha_or_block");
}

/** Back-compat — returns HTML/markdown string. */
export async function fetchRenderedHtml(url, options = {}) {
  const { html } = await fetchPortalHtml(url, options);
  return html;
}

export { parsePropertyFinderJinaMarkdown };
