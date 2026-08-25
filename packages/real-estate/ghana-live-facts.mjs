/**
 * Live Ghana inventory facts for chat (medians from listings we actually hold).
 */

import { searchListingsStore, getListingsStatus } from "./listings-store.mjs";
import { ghanaListingSources, formatMoney } from "./market.mjs";

function median(nums = []) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function monthlyAsking(row) {
  const n = Number(row?.price_aed);
  if (!Number.isFinite(n) || n <= 0) return null;
  const type = String(row.property_type || "").toLowerCase();
  const period = String(row.price_period || "monthly").toLowerCase();
  const room = /self-?contain|chamber|single.?room|compound/.test(type);
  if (String(row.transaction_type || "") !== "rent") return n;
  if (period === "yearly" || period === "annual") return Math.round(n / 12);
  // GPC often stores a yearly cedi figure with period=monthly on room lets (e.g. 22,200 vs 1,850).
  if (room && n >= 8000) return Math.round(n / 12);
  return n;
}

function matchesType(row, propertyType) {
  if (!propertyType) return true;
  const want = String(propertyType).toLowerCase().replace(/-/g, " ");
  const have = String(row.property_type || "").toLowerCase().replace(/-/g, " ");
  if (!have) return false;
  if (want.includes("self contain") || want.includes("self-contain")) return /self\s*contain/.test(have);
  if (want.includes("chamber")) return /chamber/.test(have);
  return have.includes(want) || want.includes(have);
}

function ghanaQuery(criteria = {}) {
  const query = {
    include_seed: true,
    sources: ghanaListingSources()
  };
  if (criteria.transaction_type && criteria.transaction_type !== "off_plan") {
    query.transaction_type = criteria.transaction_type;
  }
  const city = String(criteria.emirate || "").trim();
  if (city && !/^(dubai|abu dhabi|sharjah|ajman|rak|fujairah|uaq)$/i.test(city)) {
    query.emirate = city;
  }
  if (criteria.community) query.community = criteria.community;
  if (criteria.beds != null) query.beds = criteria.beds;
  if (criteria.max_price != null) query.max_price = criteria.max_price;
  if (criteria.min_price != null) query.min_price = criteria.min_price;
  return query;
}

function summarise(rows = []) {
  const prices = rows.map(monthlyAsking).filter((n) => n != null);
  const byArea = new Map();
  const byCity = new Map();
  const byType = new Map();
  for (const row of rows) {
    const area = String(row.community || "").trim() || "Unspecified area";
    const city = String(row.emirate || "").trim() || "Ghana";
    const type = String(row.property_type || "home").trim();
    if (!byArea.has(area)) byArea.set(area, []);
    if (!byCity.has(city)) byCity.set(city, []);
    if (!byType.has(type)) byType.set(type, []);
    const p = monthlyAsking(row);
    if (p != null) {
      byArea.get(area).push(p);
      byCity.get(city).push(p);
      byType.get(type).push(p);
    }
  }
  const top = (map, n = 6) =>
    [...map.entries()]
      .map(([label, vals]) => ({
        label,
        sample: vals.length,
        median: median(vals),
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null
      }))
      .filter((x) => x.sample > 0 && x.median != null)
      .sort((a, b) => b.sample - a.sample)
      .slice(0, n);

  return {
    sample: rows.length,
    priced: prices.length,
    median: median(prices),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    areas: top(byArea, 8),
    cities: top(byCity, 6),
    types: top(byType, 6)
  };
}

export function buildGhanaInventoryChart(facts) {
  const bars = (facts?.match?.areas?.length ? facts.match.areas : facts?.allRent?.areas || [])
    .filter((a) => a.median != null)
    .slice(0, 6)
    .map((a, i) => ({
      label: a.label,
      value: a.median,
      highlight: i === 0
    }));
  if (bars.length < 2) return null;
  const loc = facts.place || "Ghana";
  return {
    type: "area_compare",
    title: `Live Ghana rents · ${loc}`,
    subtitle: "Median asking rent from FIE inventory (GH₵ / month)",
    badge: `LIVE · ${new Date().toISOString().slice(0, 10)}`,
    unit: "GH₵/mo",
    bars,
    dataSource: "ghana_inventory",
    trendNote: facts.match?.sample
      ? `Based on ${facts.match.sample} live listings matching this chat — asking prices, not closed deals.`
      : "Based on live FIE inventory asking prices, not closed deals.",
    stats: {
      asOf: new Date().toISOString().slice(0, 10),
      sample: facts.match?.priced || facts.allRent?.priced || 0,
      median: facts.match?.median || facts.allRent?.median || null,
      min: facts.match?.min || facts.allRent?.min || null,
      max: facts.match?.max || facts.allRent?.max || null
    }
  };
}

export function formatGhanaLiveFactsBlock(facts) {
  if (!facts) return "";
  const lines = ["LIVE GHANA INVENTORY (internal — cite these numbers; never invent a median):"];
  if (facts.status?.listings != null) {
    const src = Object.entries(facts.status.sources || {})
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    lines.push(`- FIE live stock: ${facts.status.listings} active Ghana listings${src ? ` (${src})` : ""}.`);
  }
  const paint = (label, stats) => {
    if (!stats?.sample) {
      lines.push(`- ${label}: no matching live listings in inventory right now.`);
      return;
    }
    const band =
      stats.median != null
        ? `median ${formatMoney(stats.median)}/month, range ${formatMoney(stats.min)}–${formatMoney(stats.max)} (${stats.priced} priced / ${stats.sample} rows)`
        : `${stats.sample} rows, prices incomplete`;
    lines.push(`- ${label}: ${band}`);
    if (stats.types?.length) {
      lines.push("  By type (use the type they asked about — do not quote house medians for a self-contain):");
      for (const t of stats.types.slice(0, 6)) {
        lines.push(`  · ${t.label}: median ${formatMoney(t.median)}/month (${t.sample} listings, ${formatMoney(t.min)}–${formatMoney(t.max)})`);
      }
    }
    for (const a of (stats.areas || []).slice(0, 5)) {
      lines.push(`  · ${a.label}: median ${formatMoney(a.median)} (${a.sample} listings)`);
    }
  };
  if (facts.askedType) {
    lines.push(
      `- User asked about: ${facts.askedType}. Quote THAT type's median first. Never blend 4-bed houses into a self-contain or chamber-and-hall answer.`
    );
  }
  paint(facts.place ? `Match (${facts.place})` : "Match for this question", facts.match);
  if (facts.allRent && facts.allRent.sample !== facts.match?.sample) {
    paint("Wider Accra/Ghana rent sample", facts.allRent);
  }
  lines.push(
    "- These are asking prices from Ghana Property Centre, Jiji, Meqasa and FIE direct listings — not Land Valuation or closed contracts.",
    "- If sample < 5, say the sample is thin and speak in ranges, not fake precision."
  );
  return lines.join("\n");
}

export function formatGhanaChartBlockForPrompt(chart) {
  if (!chart?.bars?.length) return "";
  const lines = [
    `CHART DATA (FIE live Ghana inventory · ${chart.stats?.asOf || ""}):`,
    `Chart: ${chart.title}`,
    chart.subtitle || ""
  ];
  for (const bar of chart.bars) {
    lines.push(`- ${bar.label}: ${formatMoney(bar.value)}/month`);
  }
  if (chart.trendNote) lines.push(`Insight: ${chart.trendNote}`);
  lines.push("Lead with the headline number. Chart can render below.");
  return lines.filter(Boolean).join("\n");
}

export async function buildGhanaLiveFacts(db, { criteria = {}, message = "" } = {}) {
  const tx =
    criteria.transaction_type === "sale"
      ? "sale"
      : /buy|for sale|purchase/i.test(message)
        ? "sale"
        : "rent";
  const askedType = criteria.property_type || "";
  const areaQuery = ghanaQuery({
    ...criteria,
    transaction_type: tx,
    beds: /self-?contain|chamber|single.?room/i.test(askedType) ? undefined : criteria.beds,
    property_type: undefined
  });

  const [areaRows, rentRows, status] = await Promise.all([
    searchListingsStore(db, areaQuery, 50).catch(() => []),
    searchListingsStore(db, { include_seed: true, sources: ghanaListingSources(), transaction_type: "rent" }, 50).catch(
      () => []
    ),
    getListingsStatus(db).catch(() => ({ listings: 0, sources: {} }))
  ]);

  const matchRows = askedType ? areaRows.filter((row) => matchesType(row, askedType)) : areaRows;
  const placeBits = [askedType, criteria.community, criteria.emirate].filter(Boolean);
  const place = placeBits.join(", ") || (tx === "sale" ? "Ghana sales" : "Ghana rent");
  const match = summarise(matchRows);
  const area = summarise(areaRows);
  const allRent = summarise(rentRows);
  const facts = { place, match, area, allRent, status, transactionType: tx, askedType };
  facts.chart = tx === "rent" ? buildGhanaInventoryChart(facts) : null;
  return facts;
}
