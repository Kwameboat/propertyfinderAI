/**
 * Public-web discovery of Ghana SMB pages/posts that advertise WhatsApp CTAs.
 *
 * Providers (auto order):
 * 1. Brave Search — if BRAVE_SEARCH_API_KEY is set (needs Search plan, not Answers)
 * 2. Google Programmable Search — if GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID are set (100 free/day)
 * 3. DuckDuckGo HTML — free, no API key (default fallback)
 *
 * Manual: Telegram /lead <url> always works without search.
 */

import {
  extractWhatsappPhoneFromText,
  makeLeadFingerprint,
  normalizeGhanaPhone
} from "./hub-db/marketing.mjs";

const DEFAULT_QUERIES = [
  'Ghana "wa.me" business OR shop OR salon OR restaurant',
  'Ghana "Chat on WhatsApp" OR "WhatsApp us" Accra OR Kumasi',
  '"order on WhatsApp" Ghana OR Accra',
  'site:instagram.com Ghana WhatsApp business',
  'site:facebook.com Ghana "send message" WhatsApp shop'
];

export function getDiscoveryQueries() {
  const raw = String(process.env.JAB_MARKETING_QUERIES || "").trim();
  if (!raw) return DEFAULT_QUERIES.slice();
  return raw
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean);
}

export function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("facebook.com") || host.includes("fb.com")) return "facebook";
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("x.com") || host.includes("twitter.com")) return "x";
    if (host.includes("facebook.com/ads/library")) return "meta_ad_library";
    return "web";
  } catch {
    return "web";
  }
}

export function looksLikeBusinessAd(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  const businessHints =
    /\b(shop|store|salon|clinic|restaurant|hotel|boutique|delivery|order|book|appointment|sale|offer|promo|business|services?|accra|kumasi|ghana|whatsapp)\b/i;
  const personalOnly = /^(looking for love|dating|lonely|hookup)\b/i;
  if (personalOnly.test(t.trim())) return false;
  return businessHints.test(t) || /wa\.me|whatsapp/i.test(t);
}

export function scoreMarketingLead({
  whatsappPhone = "",
  sourceUrl = "",
  businessName = "",
  adText = "",
  platform = "",
  website = ""
} = {}) {
  let score = 0;
  const phone = normalizeGhanaPhone(whatsappPhone);
  if (phone) score += 35;
  if (/wa\.me|api\.whatsapp\.com/i.test(`${sourceUrl}\n${adText}`)) score += 20;
  if (businessName && String(businessName).trim().length >= 3) score += 15;
  if (looksLikeBusinessAd(adText) || looksLikeBusinessAd(businessName)) score += 15;
  if (website) score += 5;
  if (["facebook", "instagram", "meta_ad_library"].includes(platform)) score += 5;
  if (/ghana|accra|kumasi|tema|takoradi/i.test(`${adText} ${businessName} ${sourceUrl}`)) {
    score += 10;
  }
  return Math.max(0, Math.min(100, score));
}

export function guessBusinessName(title = "", url = "") {
  const cleaned = String(title || "")
    .replace(/\s*[\|\-–].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned && cleaned.length >= 2 && cleaned.length <= 80) return cleaned;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}

export function normalizeDiscoveryHit(hit = {}) {
  const sourceUrl = String(hit.url || hit.sourceUrl || "").trim();
  const title = String(hit.title || "").trim();
  const description = String(hit.description || hit.adText || "").trim();
  const combined = `${title}\n${description}\n${sourceUrl}`;
  const whatsappPhone =
    normalizeGhanaPhone(hit.whatsappPhone) || extractWhatsappPhoneFromText(combined);
  const platform = hit.platform || detectPlatform(sourceUrl);
  const businessName = hit.businessName || guessBusinessName(title, sourceUrl);
  const website = hit.website || (platform === "web" ? sourceUrl : null);
  const score = scoreMarketingLead({
    whatsappPhone,
    sourceUrl,
    businessName,
    adText: description,
    platform,
    website
  });
  const fingerprint = makeLeadFingerprint({
    whatsappPhone,
    sourceUrl,
    businessName
  });
  return {
    source: hit.source || "web_search",
    sourceUrl: sourceUrl || null,
    platform,
    adText: description.slice(0, 2000),
    businessName,
    whatsappPhone: whatsappPhone || null,
    website,
    industry: hit.industry || null,
    location: hit.location || "Ghana",
    score,
    fingerprint,
    // Phone may be missing in search snippets; research step extracts wa.me from the page.
    eligible:
      score >= 35 &&
      Boolean(sourceUrl) &&
      (Boolean(whatsappPhone) || looksLikeBusinessAd(`${title} ${description}`))
  };
}

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function unwrapDuckRedirect(href) {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    if (u.hostname.includes("duckduckgo.com") && u.pathname === "/l/") {
      const uddg = u.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
    return u.href;
  } catch {
    return href;
  }
}

async function duckDuckGoSearch(query, { count = 8 } = {}) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed ${response.status}`);
  }

  const results = [];
  const blockRe =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)?/gi;
  let match;
  while ((match = blockRe.exec(html)) && results.length < count) {
    const href = unwrapDuckRedirect(decodeBasicEntities(match[1]));
    const title = decodeBasicEntities(match[2].replace(/<[^>]+>/g, "")).trim();
    const snippet = decodeBasicEntities((match[3] || "").replace(/<[^>]+>/g, "")).trim();
    if (!href || !/^https?:\/\//i.test(href)) continue;
    if (/duckduckgo\.com/i.test(href)) continue;
    results.push({
      source: "duckduckgo",
      url: href,
      title: title || href,
      description: snippet
    });
  }

  // Fallback simpler parse if classnames differ
  if (!results.length) {
    const simpleRe = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = simpleRe.exec(html)) && results.length < count) {
      const href = unwrapDuckRedirect(decodeBasicEntities(match[1]));
      const title = decodeBasicEntities(match[2].replace(/<[^>]+>/g, "")).trim();
      if (!href || /duckduckgo\.com/i.test(href)) continue;
      results.push({ source: "duckduckgo", url: href, title: title || href, description: "" });
    }
  }

  return results;
}

async function braveSearch(query, { apiKey, count = 8, freshness = "" } = {}) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.max(1, Math.min(20, count))));
  // Brave Search has no GH country code; keep Ghana in the query text instead.
  url.searchParams.set("country", "ALL");
  url.searchParams.set("search_lang", "en");
  // Freshness: pd=past day, pw=past week, pm=past month, py=past year
  if (freshness && /^(pd|pw|pm|py)$/i.test(freshness)) {
    url.searchParams.set("freshness", String(freshness).toLowerCase());
  }
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey
    },
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Brave Search failed ${response.status}: ${body.slice(0, 300)}`);
  }
  const json = JSON.parse(body || "{}");
  const results = Array.isArray(json?.web?.results) ? json.web.results : [];
  return results.map((r) => ({
    source: "brave_search",
    url: r.url,
    title: r.title,
    description: r.description || "",
    age: r.age || ""
  }));
}

async function googleCseSearch(query, { apiKey, cx, count = 8, dateRestrict = "" } = {}) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.max(1, Math.min(10, count))));
  // d7 = past 7 days, d1 = past day, m1 = past month
  if (dateRestrict) url.searchParams.set("dateRestrict", dateRestrict);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Google CSE failed ${response.status}: ${body.slice(0, 300)}`);
  }
  const json = JSON.parse(body || "{}");
  const items = Array.isArray(json.items) ? json.items : [];
  return items.map((r) => ({
    source: "google_cse",
    url: r.link,
    title: r.title || "",
    description: r.snippet || ""
  }));
}

export function resolveSearchProvider(env = process.env) {
  const forced = String(env.JAB_MARKETING_SEARCH_PROVIDER || "auto").toLowerCase();
  const braveKey = String(env.BRAVE_SEARCH_API_KEY || "").trim();
  const googleKey = String(env.GOOGLE_CSE_API_KEY || "").trim();
  const googleCx = String(env.GOOGLE_CSE_ID || "").trim();

  if (forced === "ddg" || forced === "duckduckgo") return { provider: "duckduckgo" };
  if (forced === "brave") {
    if (!braveKey) throw new Error("BRAVE_SEARCH_API_KEY missing");
    return { provider: "brave", braveKey };
  }
  if (forced === "google") {
    if (!googleKey || !googleCx) throw new Error("GOOGLE_CSE_API_KEY / GOOGLE_CSE_ID missing");
    return { provider: "google", googleKey, googleCx };
  }

  // auto
  if (braveKey) return { provider: "brave", braveKey, fallback: "duckduckgo" };
  if (googleKey && googleCx) return { provider: "google", googleKey, googleCx };
  return { provider: "duckduckgo" };
}

async function searchWithProvider(query, providerCfg, count, opts = {}) {
  if (providerCfg.provider === "brave") {
    return braveSearch(query, {
      apiKey: providerCfg.braveKey,
      count,
      freshness: opts.freshness || ""
    });
  }
  if (providerCfg.provider === "google") {
    return googleCseSearch(query, {
      apiKey: providerCfg.googleKey,
      cx: providerCfg.googleCx,
      count,
      dateRestrict: opts.dateRestrict || ""
    });
  }
  return duckDuckGoSearch(query, { count });
}

/**
 * General-purpose web search (used by Personal Assistant + marketing).
 * opts.freshness: Brave pd|pw|pm|py
 * opts.dateRestrict: Google CSE d1|d7|m1
 * opts.mergeFallbacks: also merge DuckDuckGo / secondary provider results
 */
export async function searchWeb(query, { count = 6, env = process.env, freshness = "", dateRestrict = "", mergeFallbacks = false } = {}) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: "empty query", provider: null, results: [] };
  let providerCfg;
  try {
    providerCfg = resolveSearchProvider(env);
  } catch (error) {
    return { ok: false, error: error.message, provider: null, results: [] };
  }
  let usedProvider = providerCfg.provider;
  let results = [];
  const opts = { freshness, dateRestrict };
  try {
    results = await searchWithProvider(q, providerCfg, count, opts);
    if (providerCfg.provider === "brave" && !results.length && providerCfg.fallback === "duckduckgo") {
      usedProvider = "duckduckgo";
      results = await duckDuckGoSearch(q, { count });
    }
  } catch (error) {
    if (providerCfg.fallback === "duckduckgo" || providerCfg.provider !== "duckduckgo") {
      try {
        usedProvider = "duckduckgo";
        results = await duckDuckGoSearch(q, { count });
      } catch (fallbackError) {
        return {
          ok: false,
          error: `${error.message}; fallback: ${fallbackError.message}`,
          provider: usedProvider,
          results: []
        };
      }
    } else {
      return { ok: false, error: error.message, provider: usedProvider, results: [] };
    }
  }

  if (mergeFallbacks) {
    const seen = new Set(results.map((r) => String(r.url || "").split("?")[0]));
    const extras = [];
    try {
      if (providerCfg.provider !== "duckduckgo") {
        extras.push(...(await duckDuckGoSearch(q, { count })));
      }
    } catch {
      /* ignore */
    }
    // If Brave primary, also try without freshness if empty; if google available try it
    const googleKey = String(env.GOOGLE_CSE_API_KEY || "").trim();
    const googleCx = String(env.GOOGLE_CSE_ID || "").trim();
    if (providerCfg.provider !== "google" && googleKey && googleCx) {
      try {
        extras.push(
          ...(await googleCseSearch(q, {
            apiKey: googleKey,
            cx: googleCx,
            count,
            dateRestrict: dateRestrict || "d7"
          }))
        );
      } catch {
        /* ignore */
      }
    }
    for (const r of extras) {
      const key = String(r.url || "").split("?")[0];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(r);
    }
    if (extras.length) usedProvider = `${usedProvider}+merged`;
  }

  return { ok: true, provider: usedProvider, results: results.slice(0, Math.max(count, 10)) };
}

/**
 * Discover candidate leads. Returns normalized objects (may include ineligible).
 */
export async function discoverMarketingLeads({
  queries = getDiscoveryQueries(),
  perQuery = 6,
  maxResults = 30,
  env = process.env
} = {}) {
  let providerCfg;
  try {
    providerCfg = resolveSearchProvider(env);
  } catch (error) {
    return { ok: false, reason: "provider_config", error: error.message, leads: [] };
  }

  const seen = new Set();
  const leads = [];
  let usedProvider = providerCfg.provider;
  let searchError = null;

  for (const query of queries) {
    if (leads.length >= maxResults) break;
    let hits = [];
    try {
      hits = await searchWithProvider(query, providerCfg, perQuery);
      // Brave Answers-plan keys often return HTTP 200 with zero web results.
      if (providerCfg.provider === "brave" && !hits.length && providerCfg.fallback === "duckduckgo") {
        usedProvider = "duckduckgo";
        hits = await duckDuckGoSearch(query, { count: perQuery });
      }
    } catch (error) {
      searchError = error.message;
      if (providerCfg.fallback === "duckduckgo" || providerCfg.provider !== "duckduckgo") {
        try {
          usedProvider = "duckduckgo";
          hits = await duckDuckGoSearch(query, { count: perQuery });
          searchError = null;
        } catch (fallbackError) {
          return {
            ok: false,
            reason: "search_error",
            error: `${error.message}; fallback: ${fallbackError.message}`,
            provider: usedProvider,
            leads
          };
        }
      } else {
        return { ok: false, reason: "search_error", error: error.message, provider: usedProvider, leads };
      }
    }

    // Be polite to free HTML search
    if (usedProvider === "duckduckgo") {
      await new Promise((r) => setTimeout(r, 700));
    }

    for (const hit of hits) {
      const normalized = normalizeDiscoveryHit(hit);
      if (!normalized.sourceUrl && !normalized.whatsappPhone) continue;
      if (seen.has(normalized.fingerprint)) continue;
      seen.add(normalized.fingerprint);
      leads.push(normalized);
      if (leads.length >= maxResults) break;
    }
  }

  leads.sort((a, b) => b.score - a.score);
  return {
    ok: true,
    provider: usedProvider,
    warning: searchError || null,
    leads,
    eligible: leads.filter((l) => l.eligible)
  };
}

export async function ingestLeadFromUrl(url, extras = {}) {
  const sourceUrl = String(url || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new Error("URL must start with http:// or https://");
  }
  let pageTitle = extras.businessName || "";
  let pageText = extras.adText || "";
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "JABHubMarketingBot/1.0 (+local research; public pages only)",
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000)
    });
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    if (titleMatch) pageTitle = pageTitle || titleMatch[1].trim();
    pageText =
      pageText ||
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4000);
  } catch {
    /* keep extras only */
  }
  return normalizeDiscoveryHit({
    source: extras.source || "telegram_lead",
    url: sourceUrl,
    title: pageTitle,
    description: pageText,
    businessName: extras.businessName,
    whatsappPhone: extras.whatsappPhone,
    industry: extras.industry
  });
}
