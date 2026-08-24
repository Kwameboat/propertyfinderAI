/**
 * Shared HTTP fetch for UAE listing scrapers.
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchText(url, { timeoutMs = 20000, headers = {} } = {}) {
  const u = String(url || "");
  const portalHeaders = {};
  if (/bayut\.com/i.test(u)) {
    portalHeaders.Referer = "https://www.bayut.com/";
    portalHeaders["Sec-Fetch-Site"] = "same-origin";
  } else if (/propertyfinder\.ae/i.test(u)) {
    portalHeaders.Referer = "https://www.propertyfinder.ae/";
    portalHeaders["Sec-Fetch-Site"] = "same-origin";
  } else if (/dubizzle\.com/i.test(u)) {
    portalHeaders.Referer = "https://dubai.dubizzle.com/";
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.9",
      "Accept-Language": "en-AE,en;q=0.9",
      "Cache-Control": "no-cache",
      ...portalHeaders,
      ...headers
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 120)}`);
  }
  return text;
}

export async function fetchJson(url, { timeoutMs = 20000, headers = {} } = {}) {
  const text = await fetchText(url, { timeoutMs, headers });
  return JSON.parse(text);
}

export function extractNextData(html) {
  const m = String(html || "").match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function extractJsonLd(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      // skip
    }
  }
  return blocks;
}

export function rateLimitMs() {
  const fallback = String(process.env.JAB_RE_ZERO_COST_MODE ?? "1").match(/^(1|true|yes)$/i)
    ? 3000
    : 1400;
  return Number(process.env.JAB_RE_SCRAPE_DELAY_MS || fallback);
}
