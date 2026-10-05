/**
 * UAE real estate news & market web search (Brave / DuckDuckGo via marketing-discovery).
 */

import { searchWeb } from "../marketing-discovery.mjs";

const UAE_RE_HOSTS = [
  "propertyfinder.ae",
  "bayut.com",
  "dubizzle.com",
  "khaleejtimes.com",
  "gulfnews.com",
  "arabianbusiness.com",
  "zawya.com",
  "thenationalnews.com",
  "dubailand.gov.ae",
  "dld.gov.ae"
];

function yearHint() {
  return String(new Date().getFullYear());
}

export function buildUaeRealEstateSearchQueries(userQuery) {
  const raw = String(userQuery || "").trim();
  const year = yearHint();
  const base = raw
    .replace(/^(what(?:'s| is)|tell me about|any news (?:on|about))\s+/i, "")
    .replace(/\?+$/, "")
    .trim();
  const queries = [
    `${base} UAE real estate ${year}`,
    `${base} Dubai property ${year}`,
    `${base} site:propertyfinder.ae OR site:bayut.com`,
    `${base} site:khaleejtimes.com OR site:gulfnews.com`
  ];
  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 4);
}

function scoreHit(hit) {
  const url = String(hit.url || "").toLowerCase();
  let score = 0;
  for (const host of UAE_RE_HOSTS) {
    if (url.includes(host)) score += 3;
  }
  if (/uae|dubai|abu dhabi|property|real estate|rent|off plan/.test(`${hit.title} ${hit.description}`.toLowerCase())) {
    score += 1;
  }
  return score;
}

export async function searchUaeRealEstateWeb(userQuery, { limit = 6 } = {}) {
  const queries = buildUaeRealEstateSearchQueries(userQuery);
  const seen = new Set();
  const hits = [];

  for (const q of queries) {
    try {
      const results = await searchWeb(q, { count: Math.min(limit, 8) });
      for (const r of results) {
        const url = String(r.url || "").trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        hits.push({
          title: r.title || "",
          url,
          description: r.description || "",
          score: scoreHit(r)
        });
      }
    } catch {
      // try next query variant
    }
    if (hits.length >= limit) break;
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatWebBlockForPrompt(hits = []) {
  if (!hits.length) return "";
  return hits
    .slice(0, 4)
    .map((h, i) => `${i + 1}. ${h.title || "Untitled"} — ${String(h.description || "").slice(0, 180)}`)
    .join("\n");
}

const GHANA_RE_HOSTS = [
  "ghanapropertycentre.com",
  "meqasa.com",
  "jiji.com.gh",
  "nras.gov.gh",
  "rent-masters.com",
  "rentbrig.com",
  "renmo.homes",
  "archielands.com",
  "rentcontrol.mwh.gov.gh",
  "graphic.com.gh",
  "myjoyonline.com",
  "ghanaweb.com",
  "pulse.com.gh",
  "modernghana.com",
  "gbcghanaonline.com"
];

export function buildGhanaRealEstateSearchQueries(userQuery) {
  const raw = String(userQuery || "").trim();
  const year = yearHint();
  const base = raw
    .replace(/^(what(?:'s| is)|tell me about|any news (?:on|about))\s+/i, "")
    .replace(/\?+$/, "")
    .trim();
  return [
    ...new Set(
      [
        `${base} Ghana real estate ${year}`,
        `${base} Accra rent ${year}`,
        `${base} site:ghanapropertycentre.com OR site:meqasa.com OR site:jiji.com.gh`,
        `${base} site:nras.gov.gh OR site:rentcontrol.mwh.gov.gh`
      ]
        .map((q) => q.trim())
        .filter(Boolean)
    )
  ].slice(0, 4);
}

function scoreGhanaHit(hit) {
  const url = String(hit.url || "").toLowerCase();
  let score = 0;
  for (const host of GHANA_RE_HOSTS) {
    if (url.includes(host)) score += 3;
  }
  const blob = `${hit.title} ${hit.description}`.toLowerCase();
  if (/ghana|accra|kumasi|tema|rent|cedi|nras|east legon|osu|spintex/.test(blob)) score += 1;
  if (/dubai|uae|rera|ejari|dewa/.test(blob)) score -= 2;
  return score;
}

export async function searchGhanaRealEstateWeb(userQuery, { limit = 6 } = {}) {
  const queries = buildGhanaRealEstateSearchQueries(userQuery);
  const seen = new Set();
  const hits = [];

  for (const q of queries) {
    try {
      const results = await searchWeb(q, { count: Math.min(limit, 8) });
      for (const r of results) {
        const url = String(r.url || "").trim();
        if (!url || seen.has(url)) continue;
        seen.add(url);
        hits.push({
          title: r.title || "",
          url,
          description: r.description || "",
          score: scoreGhanaHit(r)
        });
      }
    } catch {
      /* try next query variant */
    }
    if (hits.length >= limit) break;
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
