/**
 * Side-by-side listing comparison (2–3 properties).
 */

import { computeMoveInCost } from "./calculators.mjs";

function toCompareCard(l, index) {
  return {
    index: index + 1,
    id: l.id,
    title: `${l.beds ?? "?"}BR ${l.property_type || "property"} · ${l.community || l.emirate}`,
    transaction_type: l.transaction_type,
    emirate: l.emirate,
    community: l.community,
    beds: l.beds,
    baths: l.baths,
    price_aed: l.price_aed,
    price_period: l.price_period,
    furnished: l.furnished,
    image: (l.images || [])[0] || null,
    images: l.images || [],
    source: l.source,
    source_url: l.source_url,
    amenities: l.amenities || [],
    size_sqft: l.size_sqft,
    agency_name: l.agency_name,
    building: l.building
  };
}

export function userWantsListingCompare(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/compare (?:dubai|abu dhabi|sharjah|ajman|areas?|emirates?|markets?|communities)/.test(lower)) {
    return false;
  }
  if (
    /compare (?:these|them|the listings|the properties|both|all three|side by side|which one|which is better|the above|those)/.test(
      lower
    )
  ) {
    return true;
  }
  if (/compare\s+#?\d/.test(lower) && /(?:and|&|vs|versus|with)/.test(lower)) return true;
  if (/which (?:one|property|apartment|flat|villa|is better|should i (?:pick|choose|take))/.test(lower)) {
    return true;
  }
  if (/side[\s-]by[\s-]side|head[\s-]to[\s-]head|put them next to each other/.test(lower)) return true;
  return false;
}

export function extractCompareIndices(text = "") {
  const lower = String(text || "").toLowerCase();
  const indices = [];
  for (const m of lower.matchAll(/(?:^|\s|#)(\d)(?:\s|$|,|\.)/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 8) indices.push(n - 1);
  }
  if (!indices.length) {
    if (/first two|top two|both/.test(lower)) return [0, 1];
    if (/all three|first three/.test(lower)) return [0, 1, 2];
  }
  return [...new Set(indices)].slice(0, 3);
}

export function extractCompareListingIds(text = "") {
  const ids = [];
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  for (const m of String(text || "").matchAll(uuidRe)) {
    ids.push(m[0]);
  }
  return [...new Set(ids)].slice(0, 3);
}

export async function resolveCompareListings(db, { text = "", session = {}, getListingStore, explicitIds = [] } = {}) {
  const recentIds = session.criteria?.recent_listing_ids || [];
  let ids = [...explicitIds];

  if (!ids.length) ids = extractCompareListingIds(text);
  if (!ids.length && recentIds.length) {
    const indices = extractCompareIndices(text);
    if (indices.length >= 2) {
      ids = indices.map((i) => recentIds[i]).filter(Boolean);
    } else if (userWantsListingCompare(text) && recentIds.length >= 2) {
      ids = recentIds.slice(0, Math.min(3, recentIds.length));
    }
  }

  ids = [...new Set(ids)].slice(0, 3);
  if (ids.length < 2) return { listings: [], ids: [], error: "Need at least 2 listings to compare." };

  const listings = [];
  for (const id of ids) {
    try {
      const row = await getListingStore(db, id);
      if (row) listings.push(row);
    } catch {
      /* skip */
    }
  }

  if (listings.length < 2) {
    return { listings: [], ids, error: "Could not load enough listings — search first, then say compare 1 and 2." };
  }

  return { listings, ids, error: null };
}

function fmtPrice(l) {
  const p = Number(l.price_aed) || 0;
  if (l.transaction_type === "rent") return `AED ${p.toLocaleString()}/yr`;
  return `AED ${p.toLocaleString()}`;
}

function fmtFurnished(v) {
  if (v === true) return "Furnished";
  if (v === false) return "Unfurnished";
  return "—";
}

function bestPriceIndex(listings) {
  let best = 0;
  let min = Number(listings[0]?.price_aed) || Infinity;
  listings.forEach((l, i) => {
    const p = Number(l.price_aed) || Infinity;
    if (p < min) {
      min = p;
      best = i;
    }
  });
  return min < Infinity ? best : null;
}

function bestPerBedIndex(listings) {
  let best = null;
  let min = Infinity;
  listings.forEach((l, i) => {
    const beds = Number(l.beds) || 0;
    const price = Number(l.price_aed) || 0;
    if (beds > 0 && price > 0) {
      const ppb = price / beds;
      if (ppb < min) {
        min = ppb;
        best = i;
      }
    }
  });
  return best;
}

export function buildListingComparison(listings = []) {
  const cards = listings.slice(0, 3).map((l, i) => toCompareCard(l, i));

  const prices = listings.map((l) => Number(l.price_aed) || 0);
  const moveIns = listings.map((l) =>
    l.transaction_type === "rent" && l.price_aed
      ? computeMoveInCost({ annualRent: l.price_aed }).total
      : null
  );

  const priceBest = bestPriceIndex(listings);
  const perBedBest = bestPerBedIndex(listings);

  const perBedValues = listings.map((l) => {
    const beds = Number(l.beds) || 0;
    const price = Number(l.price_aed) || 0;
    if (beds > 0 && price > 0) return `AED ${Math.round(price / beds).toLocaleString()}/bed`;
    return "—";
  });

  const rows = [
    {
      key: "price",
      label: "Annual rent / Price",
      values: listings.map(fmtPrice),
      best: priceBest
    },
    {
      key: "price_per_bed",
      label: "Price per bedroom",
      values: perBedValues,
      best: perBedBest
    },
    {
      key: "beds",
      label: "Bedrooms",
      values: listings.map((l) => (l.beds != null ? String(l.beds) : "—")),
      best: null
    },
    {
      key: "baths",
      label: "Bathrooms",
      values: listings.map((l) => (l.baths != null ? String(l.baths) : "—")),
      best: null
    },
    {
      key: "community",
      label: "Community",
      values: listings.map((l) => l.community || l.emirate || "—"),
      best: null
    },
    {
      key: "furnished",
      label: "Furnished",
      values: listings.map((l) => fmtFurnished(l.furnished)),
      best: null
    },
    {
      key: "type",
      label: "Type",
      values: listings.map((l) => l.property_type || "—"),
      best: null
    },
    {
      key: "move_in",
      label: "Est. move-in (rent)",
      values: moveIns.map((m) => (m != null ? `AED ${m.toLocaleString()}` : "—")),
      best:
        moveIns.filter((m) => m != null).length >= 2
          ? moveIns.indexOf(Math.min(...moveIns.filter((m) => m != null)))
          : null
    },
    {
      key: "agency",
      label: "Agency",
      values: listings.map((l) => l.agency_name || l.agent_name || "—"),
      best: null
    },
    {
      key: "source",
      label: "Portal",
      values: listings.map((l) => String(l.source || "—").replace(/_/g, " ")),
      best: null
    }
  ];

  const amenities = listings.map((l) => (l.amenities || []).slice(0, 4).join(", ") || "—");
  if (amenities.some((a) => a !== "—")) {
    rows.push({ key: "amenities", label: "Key amenities", values: amenities, best: null });
  }

  return {
    listings: cards,
    rows,
    highlights: {
      lowestPrice: priceBest != null ? cards[priceBest]?.id : null,
      bestPerBed: perBedBest != null ? cards[perBedBest]?.id : null,
      priceRange:
        prices.length >= 2
          ? { min: Math.min(...prices), max: Math.max(...prices), diff: Math.max(...prices) - Math.min(...prices) }
          : null
    }
  };
}

export function formatComparisonBlockForPrompt(comparison) {
  if (!comparison?.listings?.length) return "";
  const header = comparison.listings.map((l, i) => `[${i + 1}] ${l.title} — ${fmtPrice(l)}`).join(" | ");
  const table = comparison.rows
    .map((r) => `${r.label}: ${r.values.map((v, i) => `#${i + 1} ${v}`).join(" · ")}`)
    .join("\n");
  return [
    "LISTING COMPARISON (use this data — do not invent):",
    header,
    table,
    comparison.highlights?.priceRange
      ? `Spread: AED ${comparison.highlights.priceRange.diff.toLocaleString()} between cheapest and priciest.`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatComparisonWhatsApp(comparison) {
  if (!comparison?.listings?.length) return "";
  const titles = comparison.listings.map((l, i) => `${i + 1}. ${l.title} — ${fmtPrice(l)}`).join("\n");
  const lines = comparison.rows
    .filter((r) => r.values.some((v) => v && v !== "—"))
    .map((r) => {
      const cells = r.values.map((v, i) => `#${i + 1} ${v}`).join("  |  ");
      const star = r.best != null ? ` ✓ #${r.best + 1} best` : "";
      return `${r.label}: ${cells}${star}`;
    });
  return ["Compare:", "", titles, "", ...lines].join("\n").slice(0, 3800);
}

export async function compareListingsByIds(db, ids = [], getListingStore) {
  const unique = [...new Set(ids)].slice(0, 3);
  const listings = [];
  for (const id of unique) {
    const row = await getListingStore(db, id);
    if (row) listings.push(row);
  }
  if (listings.length < 2) {
    return { ok: false, error: "Provide 2–3 valid listing IDs." };
  }
  return { ok: true, comparison: buildListingComparison(listings) };
}
