/**
 * Personal Assistant web search + live news for current affairs.
 * Multi-source: Brave/Google/DDG + Google News RSS + Ghana outlet bias + page fetch.
 */

import { searchWeb } from "./marketing-discovery.mjs";

const GHANA_NEWS_HOSTS = [
  "myjoyonline.com",
  "citinewsroom.com",
  "graphic.com.gh",
  "modernghana.com",
  "ghanaweb.com",
  "3news.com",
  "peacefmonline.com",
  "adomonline.com",
  "starrfm.com.gh",
  "tv3.com.gh",
  "yen.com.gh",
  "pulse.com.gh",
  "thebftonline.com",
  "businessghana.com"
];

/** Common misspellings / aliases for high-profile Ghana names */
const NAME_ALIASES = [
  [/\bwonyumi\b/gi, "Wontumi"],
  [/\bwonyomi\b/gi, "Wontumi"],
  [/\bwontomi\b/gi, "Wontumi"],
  [/\bakufo[\s-]?addo\b/gi, "Akufo-Addo"],
  [/\bmahamah\b/gi, "Mahama"]
];

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normalizeQuery(text) {
  let q = String(text || "").trim();
  for (const [re, repl] of NAME_ALIASES) q = q.replace(re, repl);
  return q;
}

function yearHint() {
  return String(new Date().getFullYear());
}

/**
 * Build several search variants so fresh Ghana stories are not missed.
 */
export function buildCurrentSearchQueries(userQuery) {
  const raw = normalizeQuery(userQuery);
  const year = yearHint();
  const base = raw
    .replace(/^(what(?:'s| is)|tell me about|any news (?:on|about)|have you heard (?:about|of))\s+/i, "")
    .replace(/\?+$/, "")
    .trim()
    .slice(0, 160);

  const queries = [
    `${base} Ghana`,
    `${base} ${year}`,
    `${base} Ghana news ${year}`,
    `(site:myjoyonline.com OR site:citinewsroom.com OR site:graphic.com.gh OR site:modernghana.com OR site:ghanaweb.com) ${base}`
  ];

  // Sentence / court stories
  if (/\b(sentence|sentenced|jailed|jail|convict|conviction|arrest|court|judgement|judgment)\b/i.test(base)) {
    queries.unshift(`${base} Ghana High Court ${year}`);
  }

  // Deduplicate
  const seen = new Set();
  return queries.filter((q) => {
    const k = q.toLowerCase();
    if (seen.has(k) || q.length < 4) return false;
    seen.add(k);
    return true;
  }).slice(0, 4);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function scoreNewsHit(hit) {
  let score = 0;
  const host = hostOf(hit.url);
  if (GHANA_NEWS_HOSTS.some((h) => host.endsWith(h))) score += 40;
  if (/news\.google\.com/i.test(hit.url) || hit.source === "google_news_rss") score += 25;
  const blob = `${hit.title || ""} ${hit.description || ""}`.toLowerCase();
  if (/\b(2026|2025|today|yesterday|hours? ago|minutes? ago|just in|breaking)\b/.test(blob)) score += 15;
  if (hit.age && /\b(hour|minute|day|week)\b/i.test(hit.age)) score += 10;
  if (/\b(sentenced|jailed|convicted|arrested|judgement|judgment)\b/.test(blob)) score += 8;
  return score;
}

function mergeHits(lists) {
  const byUrl = new Map();
  for (const list of lists) {
    for (const hit of list || []) {
      const url = String(hit.url || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const key = url.split("?")[0].replace(/\/$/, "");
      const prev = byUrl.get(key);
      if (!prev || scoreNewsHit(hit) > scoreNewsHit(prev)) byUrl.set(key, hit);
    }
  }
  return [...byUrl.values()].sort((a, b) => scoreNewsHit(b) - scoreNewsHit(a));
}

/**
 * Google News RSS — free, usually fresher than plain DDG for breaking stories.
 */
export async function googleNewsRss(query, { count = 8 } = {}) {
  const q = encodeURIComponent(normalizeQuery(query));
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-GH&gl=GH&ceid=GH:en`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "JAB-Hub-PA/1.1 (+news-research)",
        Accept: "application/rss+xml, application/xml, text/xml"
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRe.exec(xml)) && items.length < count) {
      const block = m[1];
      const title = decodeXml((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
      const link = decodeXml((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "");
      const desc = decodeXml((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || "");
      const pub = decodeXml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || "");
      if (!link) continue;
      items.push({
        source: "google_news_rss",
        url: link,
        title: title || link,
        description: stripHtml(desc).slice(0, 280),
        age: pub
      });
    }
    return items;
  } catch {
    return [];
  }
}

export async function fetchPageText(url, { maxChars = 6000 } = {}) {
  const href = String(url || "").trim();
  if (!/^https?:\/\//i.test(href)) return { ok: false, error: "invalid url", text: "" };
  // Google News RSS links often redirect; follow them
  try {
    const res = await fetch(href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain"
      },
      signal: AbortSignal.timeout(25000),
      redirect: "follow"
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, text: "" };
    const ctype = String(res.headers.get("content-type") || "");
    const raw = await res.text();
    const text = ctype.includes("text/plain") ? raw : stripHtml(raw);
    return { ok: true, text: text.slice(0, maxChars), url: res.url || href };
  } catch (error) {
    return { ok: false, error: error.message, text: "" };
  }
}

export function formatSearchForPrompt(searchResult) {
  if (!searchResult?.ok) {
    return `Web search failed: ${searchResult?.error || "unknown"}`;
  }
  const rows = searchResult.results || [];
  if (!rows.length) return `Web search (${searchResult.provider}): no results.`;
  return [
    `LIVE web/news search via ${searchResult.provider} (prefer these over model memory):`,
    ...rows.slice(0, 8).map((r, i) => {
      const bits = [`${i + 1}. ${r.title || "(no title)"}`, r.url];
      if (r.age) bits.push(`Published/age: ${r.age}`);
      if (r.description) bits.push(r.description.slice(0, 240));
      return bits.join("\n");
    })
  ].join("\n");
}

/**
 * Multi-source current-affairs research: freshness filters + Ghana news + RSS + article fetch.
 */
export async function researchQuestion(query, { fetchTop = 2, env = process.env, current = true } = {}) {
  const normalized = normalizeQuery(query);
  const queries = current ? buildCurrentSearchQueries(normalized) : [normalized];
  const allHits = [];
  const providers = [];

  // 1) Google News RSS (often best for breaking stories)
  const rss = await googleNewsRss(normalized, { count: 8 });
  if (rss.length) {
    allHits.push(rss);
    providers.push("google_news_rss");
  }

  // 2) Fresh web search across query variants
  for (const q of queries) {
    const search = await searchWeb(q, {
      count: 8,
      env,
      freshness: current ? "pw" : "",
      dateRestrict: current ? "d7" : "",
      mergeFallbacks: true
    });
    if (search.ok && search.results?.length) {
      allHits.push(search.results);
      providers.push(search.provider);
    }
    // If week-fresh is empty, broaden to month
    if (current && (!search.ok || !search.results?.length)) {
      const wider = await searchWeb(q, {
        count: 8,
        env,
        freshness: "pm",
        dateRestrict: "m1",
        mergeFallbacks: true
      });
      if (wider.ok && wider.results?.length) {
        allHits.push(wider.results);
        providers.push(`${wider.provider}:month`);
      }
    }
  }

  const merged = mergeHits(allHits).slice(0, 10);
  const search = {
    ok: merged.length > 0,
    provider: providers.length ? [...new Set(providers)].join("+") : "none",
    results: merged,
    error: merged.length ? undefined : "no live results"
  };

  const pages = [];
  const toFetch = Math.max(0, Number(fetchTop) || 0);
  if (search.ok && toFetch > 0) {
    // Prefer Ghana news hosts when fetching full articles
    const ordered = [...merged].sort((a, b) => scoreNewsHit(b) - scoreNewsHit(a));
    for (const hit of ordered.slice(0, toFetch)) {
      const page = await fetchPageText(hit.url, { maxChars: 5000 });
      if (page.ok && page.text && page.text.length > 200) {
        pages.push({ url: page.url || hit.url, title: hit.title, text: page.text });
      }
    }
  }

  let block = formatSearchForPrompt(search);
  block =
    `Today's date context: ${new Date().toISOString().slice(0, 10)}. Prefer LIVE results below over training memory. If results mention a recent sentence/court case, report it.\n\n` +
    block;
  if (pages.length) {
    block +=
      "\n\nFetched article excerpts (use these as primary facts):\n" +
      pages
        .map((p, i) => `--- Article ${i + 1}: ${p.title || p.url}\n${p.text.slice(0, 3800)}`)
        .join("\n\n");
  }
  return { search, pages, promptBlock: block, queries };
}

export async function newsDigestBlock({ topics = [], env = process.env } = {}) {
  const year = yearHint();
  const queries = topics.length
    ? topics
    : [
        `Ghana top news today ${year}`,
        `Ghana politics court sentence news ${year}`,
        `world headlines today ${year}`
      ];
  const parts = [];
  for (const q of queries.slice(0, 3)) {
    const r = await researchQuestion(q, { fetchTop: 1, env, current: true });
    parts.push(r.promptBlock);
  }
  return parts.join("\n\n");
}
