/**
 * Build inline chart payloads — Gemini live RAG primary, cache fallback.
 */

import {  fetchLiveMarketSnapshot,
  resolveMarketStats,
  formatLiveSearchBlockForPrompt,
  fetchGeminiMarketIntelligence
} from "./live-search.mjs";

function formatAedK(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

function formatAedFull(n) {
  return `AED ${Number(n || 0).toLocaleString()}`;
}

export function detectCompareEmirates(criteria = {}, message = "") {
  const lower = String(message || "").toLowerCase();
  if (criteria.emirates?.length >= 2) return [...new Set(criteria.emirates)].slice(0, 4);
  const found = [];
  if (/dubai/.test(lower)) found.push("Dubai");
  if (/abu dhabi|abudhabi/.test(lower)) found.push("Abu Dhabi");
  if (/sharjah/.test(lower)) found.push("Sharjah");
  if (/ajman/.test(lower)) found.push("Ajman");
  return found.length >= 2 ? found : null;
}

function sourceBadge(_result, asOf) {
  return `Updated · ${asOf}`;
}

async function statsFromGemini(gemini, emirate, db, criteria, message) {
  if (gemini?.ok && gemini.emirateStats?.[emirate]) {
    return { ok: true, emirate, stats: gemini.emirateStats[emirate], source: "gemini_rag_live" };
  }
  return resolveMarketStats(db, emirate, criteria, message);
}

export async function buildEmirateComparisonChartLive(db, criteria = {}, emirates = ["Dubai", "Abu Dhabi"], message = "", gemini = null) {
  const asOf = new Date().toISOString().slice(0, 10);
  const bedLabel =
    criteria.beds === 0 ? "Studios" : criteria.beds != null ? `${criteria.beds}-bedroom` : "All apartments";
  const emirateStatsMap = {};
  let dataSource = "gemini_rag_live";
  const g = gemini || (await fetchGeminiMarketIntelligence(message, criteria));

  for (const emirate of emirates) {
    const result = await statsFromGemini(g, emirate, db, criteria, message);
    if (result.ok && result.stats) {
      emirateStatsMap[emirate] = { ...result.stats, source: result.source };
      if (result.source !== "gemini_rag_live") dataSource = result.source;
    }
  }

  const bars = emirates
    .filter((e) => emirateStatsMap[e])
    .map((emirate) => ({
      label: emirate,
      value: emirateStatsMap[emirate].median,
      highlight: true
    }));

  const dubai = emirateStatsMap["Dubai"];
  const ad = emirateStatsMap["Abu Dhabi"];
  let trendNote = "";
  if (dubai && ad) {
    const diffPct = Math.round(((dubai.median - ad.median) / ad.median) * 100);
    trendNote = `Dubai median runs ~${Math.abs(diffPct)}% ${diffPct >= 0 ? "higher" : "lower"} than Abu Dhabi for ${bedLabel.toLowerCase()}.`;
  }

  return {
    type: "emirate_compare",
    title: "Rent Trends: Dubai vs Abu Dhabi",
    subtitle: `${bedLabel} · live median annual rent`,
    badge: sourceBadge({ source: dataSource }, asOf),
    unit: "AED/yr",
    bars,
    emirateStats: emirateStatsMap,
    trendNote,
    dataSource,
    stats: {
      asOf,
      sample: Object.values(emirateStatsMap).reduce((n, s) => n + s.sample, 0)
    }
  };
}

export async function buildRentTrendChartLive(db, criteria = {}, message = "", gemini = null) {
  const asOf = new Date().toISOString().slice(0, 10);
  const emirate = criteria.emirate || criteria.emirates?.[0] || "Dubai";
  const area = criteria.community || emirate;
  const beds = criteria.beds != null ? Number(criteria.beds) : null;
  const bedLabel = beds === 0 ? "Studio" : beds != null ? `${beds}-bedroom` : "Apartments";

  const g = gemini || (await fetchGeminiMarketIntelligence(message, criteria));
  const result = await statsFromGemini(g, emirate, db, criteria, message);
  const stats = result.stats;
  const dataSource = result.source || "unknown";

  if (!stats) {
    return {
      type: "rent_trend",
      title: `Rent Data: ${area}`,
      subtitle: bedLabel,
      badge: `NO DATA · ${asOf}`,
      unit: "AED/yr",
      bars: [],
      stats: { asOf, sample: 0 },
      dataSource
    };
  }

  const bars = [
    { label: "Low", value: stats.min },
    { label: "P25", value: stats.p25 },
    { label: "Median", value: stats.median, highlight: true },
    { label: "P75", value: stats.p75 },
    { label: "High", value: stats.max }
  ];

  return {
    type: "rent_trend",
    title: `Live Rent Data: ${area}`,
    subtitle: `${bedLabel} · ${emirate}`,
    badge: sourceBadge(result, asOf),
    unit: "AED/yr",
    bars,
    stats: { ...stats, asOf },
    dataSource,
    trendNote: g?.ok ? "Recent market snapshot." : `Based on ${stats.sample || "available"} listings.`,
  };
}

export async function buildCostBreakdownChartLive(db, criteria = {}, message = "", gemini = null) {
  const trend = await buildRentTrendChartLive(db, criteria, message, gemini);
  const annualRent = trend.stats?.median || criteria.max_price || 96000;
  const monthlyRent = Math.round(annualRent / 12);
  const dewa = Math.round(monthlyRent * 0.07);
  const service = Math.round(monthlyRent * 0.1);
  const chiller = Math.round(monthlyRent * 0.05);
  const internet = 350;
  const total = monthlyRent + dewa + service + chiller + internet;

  return {
    type: "cost_breakdown",
    title: "Monthly Cost Estimate",
    subtitle: criteria.community || criteria.emirate || "Dubai apartment",
    badge: `LIVE EST · ${new Date().toISOString().slice(0, 10)}`,
    unit: "AED/mo",
    bars: [
      { label: "Rent", value: monthlyRent },
      { label: "DEWA", value: dewa },
      { label: "Service", value: service },
      { label: "Cooling", value: chiller },
      { label: "Internet", value: internet }
    ],
    stats: { total, annualRent, sample: trend.stats?.sample || 0 },
    dataSource: trend.dataSource
  };
}

export async function buildMarketComparisonChartLive(db, criteria = {}, message = "", gemini = null) {
  const areas = criteria.community
    ? [criteria.community, "Marina", "JVC", "Business Bay"].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4)
    : ["Downtown", "Marina", "JVC", "Business Bay"];

  const g = gemini || (await fetchGeminiMarketIntelligence(message, criteria));
  const bars = [];
  for (const area of areas) {
    const result = await statsFromGemini(g, criteria.emirate || "Dubai", db, { ...criteria, community: area }, message);
    if (result.ok && result.stats) {
      bars.push({
        label: area.replace(/^\w/, (c) => c.toUpperCase()),
        value: result.stats.median,
        highlight: area.toLowerCase() === String(criteria.community || "").toLowerCase()
      });
    }
  }

  return {
    type: "area_compare",
    title: "Live Rent Comparison",
    subtitle: criteria.beds != null ? `${criteria.beds}-bedroom` : "2-bedroom",
    badge: `LIVE SEARCH · ${new Date().toISOString().slice(0, 10)}`,
    unit: "AED/yr",
    bars,
    dataSource: "gemini_rag_live",
    stats: null
  };
}

export async function buildInsightChartLive(db, intent, criteria = {}, message = "", snapshot = null) {
  const lower = String(message || "").toLowerCase();
  const gemini = snapshot?.gemini || null;

  if (/calculator|monthly cost|dewa|service charge|estimate/.test(lower) || (intent === "move_in" && /cost|estimate/.test(lower))) {
    return buildCostBreakdownChartLive(db, criteria, message, gemini);
  }

  const compareEmirates = detectCompareEmirates(criteria, message);
  if (compareEmirates?.length >= 2 || /dubai.*abu dhabi|abu dhabi.*dubai/.test(lower)) {
    return buildEmirateComparisonChartLive(db, criteria, compareEmirates || ["Dubai", "Abu Dhabi"], message, gemini);
  }

  if (/compare|vs|versus/.test(lower)) {
    return buildMarketComparisonChartLive(db, criteria, message, gemini);
  }

  if (intent === "market" || intent === "news" || /trend|average|how much|price|yield|investment|numbers|real data|statistics/.test(lower)) {
    return buildRentTrendChartLive(db, criteria, message, gemini);
  }

  return null;
}

export async function buildLiveRagContext(db, criteria = {}, message = "") {
  const snapshot = await fetchLiveMarketSnapshot(db, criteria, message);
  return {
    snapshot,
    liveSearchBlock: formatLiveSearchBlockForPrompt(snapshot)
  };
}

export function formatChartBlockForPrompt(chart, liveSearchBlock = "") {
  if (!chart?.bars?.length && !liveSearchBlock) return "";

  const lines = [];
  if (liveSearchBlock) lines.push(liveSearchBlock, "");

  if (chart?.bars?.length) {
    const src =
      chart.dataSource === "gemini_rag_live"
        ? "Gemini live web search"
        : chart.dataSource === "cached_inventory_fallback"
          ? "synced inventory fallback"
          : "market data";
    lines.push(
      `CHART DATA (${src} · ${chart.stats?.asOf || new Date().toISOString().slice(0, 10)}):`,
      `Chart: ${chart.title}`,
      chart.subtitle || ""
    );
    for (const bar of chart.bars) {
      lines.push(`- ${bar.label}: ${formatAedFull(bar.value)}/${chart.unit?.includes("mo") ? "mo" : "yr"}`);
    }
    if (chart.emirateStats) {
      lines.push("", "Emirate breakdown:");
      for (const [name, s] of Object.entries(chart.emirateStats)) {
        lines.push(
          `- ${name}: median ${formatAedFull(s.median)}/yr, range ${formatAedFull(s.min)}–${formatAedFull(s.max)}, ${s.sample} listings`
        );
      }
    }
    if (chart.stats?.median) {
      lines.push(
        "",
        `Summary: median ${formatAedFull(chart.stats.median)}/yr, range ${formatAedFull(chart.stats.min)}–${formatAedFull(chart.stats.max)}, ${chart.stats.sample} listings.`
      );
    }
    if (chart.trendNote) lines.push(`Insight: ${chart.trendNote}`);
  }

  lines.push(
    "",
    "Answer using LIVE SEARCH figures above. Cite medians and ranges accurately. Chart renders in app below your message."
  );

  return lines.filter(Boolean).join("\n");
}

export { formatAedK, formatAedFull, formatLiveSearchBlockForPrompt };
