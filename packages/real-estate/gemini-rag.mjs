/**
 * Gemini-powered live market RAG (Google Search grounding).
 * Replaces RapidAPI for trend / market intelligence queries.
 */

import { resolveGeminiApiKey, GEMINI_API_BASE, GEMINI_MODEL } from "./gemini.mjs";
import { searchUaeRealEstateWeb, formatWebBlockForPrompt } from "./web.mjs";

function detectCompareEmirates(criteria = {}, message = "") {
  const lower = String(message || "").toLowerCase();
  if (criteria.emirates?.length >= 2) return [...new Set(criteria.emirates)].slice(0, 4);
  const found = [];
  if (/dubai/.test(lower)) found.push("Dubai");
  if (/abu dhabi|abudhabi/.test(lower)) found.push("Abu Dhabi");
  if (/sharjah/.test(lower)) found.push("Sharjah");
  if (/ajman/.test(lower)) found.push("Ajman");
  return found.length >= 2 ? found : null;
}

function targetEmirates(criteria = {}, message = "") {
  const compare = detectCompareEmirates(criteria, message);
  if (compare?.length) return compare;
  if (criteria.emirates?.length) return criteria.emirates.slice(0, 4);
  if (criteria.emirate) return [criteria.emirate];
  return ["Dubai", "Abu Dhabi"];
}

function bedLabel(criteria = {}) {
  if (criteria.beds === 0) return "studio";
  if (criteria.beds != null) return `${criteria.beds}-bedroom`;
  return "apartment";
}

function parseJsonFromText(text = "") {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeEmirateStats(data, emirates) {
  const rows = Array.isArray(data?.emirates) ? data.emirates : [];
  const out = {};
  for (const name of emirates) {
    const row =
      rows.find((r) => String(r.name || r.emirate || "").toLowerCase() === name.toLowerCase()) ||
      rows.find((r) => String(r.name || r.emirate || "").toLowerCase().includes(name.toLowerCase()));
    if (!row) continue;
    const median = Number(row.medianRentAedYear || row.median || row.median_rent_aed || 0);
    if (!median) continue;
    const min = Number(row.minRentAedYear || row.min || Math.round(median * 0.75));
    const max = Number(row.maxRentAedYear || row.max || Math.round(median * 1.35));
    out[name] = {
      median,
      avg: Number(row.avgRentAedYear || row.avg || median),
      min,
      max,
      p25: Number(row.p25 || Math.round(median * 0.9)),
      p75: Number(row.p75 || Math.round(median * 1.1)),
      sample: Number(row.sampleSize || row.sample || 0),
      yoyTrendPct: row.yoyTrendPct != null ? Number(row.yoyTrendPct) : null,
      insight: String(row.insight || "").trim()
    };
  }
  return out;
}

function extractGroundingUrls(metadata = {}) {
  const urls = [];
  for (const chunk of metadata.groundingChunks || []) {
    const uri = chunk?.web?.uri || chunk?.retrievedContext?.uri;
    if (uri) urls.push(uri);
  }
  for (const support of metadata.groundingSupports || []) {
    for (const idx of support.groundingChunkIndices || []) {
      const chunk = (metadata.groundingChunks || [])[idx];
      const uri = chunk?.web?.uri;
      if (uri) urls.push(uri);
    }
  }
  return [...new Set(urls)].slice(0, 8);
}

export async function fetchGeminiMarketIntelligence(message = "", criteria = {}) {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) {
    return { ok: false, source: "gemini_rag", error: "GEMINI_API_KEY missing" };
  }

  const emirates = targetEmirates(criteria, message);
  const beds = bedLabel(criteria);
  const today = new Date().toISOString().slice(0, 10);
  const tx = criteria.transaction_type === "sale" ? "sale / buy" : "rent";

  const prompt = [
    `Today is ${today}. Search the web for CURRENT UAE property market data.`,
    `User question: ${message}`,
    `Extract ${tx} market figures for: ${emirates.join(", ")} (${beds} units).`,
    "Use Bayut, Property Finder, DLD, Khaleej Times, Gulf News, or official reports when available.",
    "Return ONLY JSON (no markdown):",
    "{",
    '  "asOf": "YYYY-MM-DD",',
    '  "emirates": [',
    '    { "name": "Dubai", "medianRentAedYear": 0, "minRentAedYear": 0, "maxRentAedYear": 0, "yoyTrendPct": 0, "sampleSize": 0, "insight": "one line" }',
    "  ],",
    '  "comparisonInsight": "short Dubai vs Abu Dhabi comparison if relevant",',
    '  "sources": ["publication or site names"]',
    "}"
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 1200,
          responseMimeType: "application/json"
        }
      }),
      signal: controller.signal
    });

    const body = await response.text();
    if (!response.ok) {
      return { ok: false, source: "gemini_rag", error: `Gemini HTTP ${response.status}: ${body.slice(0, 300)}` };
    }

    const parsed = JSON.parse(body);
    const candidate = parsed?.candidates?.[0];
    const text =
      candidate?.content?.parts?.map((p) => p.text || "").join("") ||
      candidate?.output ||
      "";
    const data = parseJsonFromText(text);
    const emirateStats = normalizeEmirateStats(data, emirates);
    const groundingUrls = extractGroundingUrls(candidate?.groundingMetadata || {});

    if (!Object.keys(emirateStats).length) {
      return {
        ok: false,
        source: "gemini_rag",
        error: "Gemini returned no usable market figures",
        rawText: text.slice(0, 500),
        groundingUrls
      };
    }

    return {
      ok: true,
      source: "gemini_rag_live",
      fetchedAt: new Date().toISOString(),
      asOf: data?.asOf || today,
      emirateStats,
      comparisonInsight: String(data?.comparisonInsight || "").trim(),
      sources: [...new Set([...(data?.sources || []), ...groundingUrls])].slice(0, 10),
      groundingUrls,
      emirates: Object.keys(emirateStats)
    };
  } catch (error) {
    return { ok: false, source: "gemini_rag", error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

export function geminiStatsToEmirateResults(geminiResult) {
  if (!geminiResult?.ok) return [];
  return Object.entries(geminiResult.emirateStats).map(([emirate, stats]) => ({
    ok: true,
    emirate,
    stats,
    source: "gemini_rag_live",
    rawCount: stats.sample || 0
  }));
}

export function formatGeminiRagBlockForPrompt(geminiResult, webHits = []) {
  if (!geminiResult?.ok) return "";

  const lines = [
    "Current market figures (internal — use naturally, never mention source or search):"
  ];

  for (const [name, s] of Object.entries(geminiResult.emirateStats)) {
    lines.push(
      `- ${name}: median AED ${s.median.toLocaleString()}/yr, range AED ${s.min.toLocaleString()}–${s.max.toLocaleString()}${
        s.yoyTrendPct != null ? `, YoY ~${s.yoyTrendPct}%` : ""
      }${s.insight ? ` — ${s.insight}` : ""}`
    );
  }

  if (geminiResult.comparisonInsight) {
    lines.push(`Note: ${geminiResult.comparisonInsight}`);
  }

  if (webHits.length) {
    lines.push("", "Headlines (internal):", ...webHits.slice(0, 4).map((h) => `- ${h.title}: ${String(h.description || "").slice(0, 120)}`));
  }

  return lines.join("\n");
}

export async function fetchGeminiMarketSnapshot(db, criteria = {}, message = "") {
  const webPromise = searchUaeRealEstateWeb(message, { limit: 4 });
  const gemini = await fetchGeminiMarketIntelligence(message, criteria);
  const webHits = await webPromise;

  if (gemini.ok) {
    return {
      ok: true,
      source: "gemini_rag_live",
      fetchedAt: gemini.fetchedAt,
      gemini,
      emirateResults: geminiStatsToEmirateResults(gemini),
      webHits,
      liveSearchBlock: formatGeminiRagBlockForPrompt(gemini, webHits)
    };
  }

  return {
    ok: false,
    source: "gemini_rag_failed",
    gemini,
    webHits,
    error: gemini.error
  };
}

export { detectCompareEmirates, targetEmirates };
