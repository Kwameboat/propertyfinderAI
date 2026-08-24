/**
 * Parse Property Finder SERP markdown (Jina Reader) into listing rows.
 */
import { normalizePropertyFinderHtml } from "../normalize.mjs";

const PL_LINK = /propertyfinder\.ae\/en\/(?:pl|plp)\/[^)\s"'<>]+/gi;
const PL_ID = /propertyfinder\.ae\/en\/pl\/(\d+)/i;

export function parsePropertyFinderJinaMarkdown(markdown = "", { emirate = "Dubai", transactionType = "rent" } = {}) {
  const text = String(markdown || "");
  const rows = [];
  const seen = new Set();

  for (const m of text.matchAll(PL_LINK)) {
    const href = m[0];
    const idMatch = href.match(PL_ID);
    const id = idMatch?.[1] || href.replace(/[^\d]/g, "").slice(-8);
    if (!id || seen.has(href)) continue;
    seen.add(href);

    const start = Math.max(0, m.index - 500);
    const chunk = text.slice(start, m.index + 300);
    const priceMatch = chunk.match(/AED\s*([\d,]+)/i);
    const bedsMatch =
      chunk.match(/(\d+)\s*Bedrooms?/i) ||
      chunk.match(/(\d+)\s*(?:bed|beds|br|bhk)/i) ||
      chunk.match(/\b(\d+)BR\b/i);

    rows.push(
      normalizePropertyFinderHtml(
        {
          id: Number(id) || href,
          price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : 0,
          bedrooms: bedsMatch ? Number(bedsMatch[1]) : null,
          title: chunk.split("\n").find((line) => /bedroom|apartment|villa/i.test(line))?.slice(0, 120) || `Listing ${id}`,
          share_url: href.startsWith("http") ? href : `https://www.${href}`
        },
        emirate,
        transactionType
      )
    );
  }

  return rows.filter((r) => Number(r.price_aed) > 0);
}
