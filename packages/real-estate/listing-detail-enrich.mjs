/**
 * Enrich live SERP rows from portal detail pages (__NEXT_DATA__ first, Jina fallback).
 */

import { enrichListingFromPortalUrl } from "./portal-detail.mjs";
import { extractImagesFromText, filterValidPortalImages } from "./listing-images.mjs";

const DETAIL_MIN_IMAGES = Number(process.env.JAB_RE_DETAIL_MIN_IMAGES || 4);

export async function fetchPortalMarkdown(sourceUrl = "", { timeoutMs = 35000 } = {}) {
  const url = String(sourceUrl || "").trim();
  if (!url.startsWith("http")) return "";
  try {
    const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: { Accept: "text/markdown", "X-Return-Format": "markdown" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function parseNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseListingDetailFromMarkdown(markdown = "", listing = {}) {
  const text = String(markdown || "");
  if (!text.trim()) return { ...listing };

  const images = filterValidPortalImages([
    ...(listing.images || []),
    ...extractImagesFromText(text)
  ]).slice(0, 16);

  const beds =
    parseNumber(
      firstMatch(text, [
        /(\d+)\s*(?:bed(?:room)?s?|br|bhk)\b/i,
        /\b(\d+)\s*Bedrooms?\b/i
      ])
    ) ?? listing.beds;

  const baths =
    parseNumber(
      firstMatch(text, [
        /(\d+)\s*(?:bath(?:room)?s?)\b/i,
        /\b(\d+)\s*Bathrooms?\b/i
      ])
    ) ?? listing.baths;

  let size_sqft = listing.size_sqft ?? null;
  const sqft = firstMatch(text, [/([\d,]+)\s*(?:sq\.?\s*ft|sqft|square feet)/i]);
  const sqm = firstMatch(text, [/([\d,]+)\s*(?:sq\.?\s*m|sqm|square metres?)/i]);
  if (sqft) size_sqft = parseNumber(sqft);
  else if (sqm) size_sqft = Math.round(parseNumber(sqm) * 10.7639);

  let description = listing.description || "";
  const descBlock = text.match(
    /(?:^|\n)(?:Description|About this property|Property details)\s*\n+([\s\S]{40,1800}?)(?:\n#{1,3}\s|\n(?:Amenities|Features|Location|Listed)|$)/i
  );
  if (descBlock?.[1]) {
    description = descBlock[1].replace(/\[\d+\]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  } else if (!description || description.length < 80) {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 60 && !/^https?:\/\//.test(l) && !/^!\[/.test(l));
    if (lines.length) description = lines.slice(0, 3).join(" ").slice(0, 1200);
  }

  const amenities = new Set(Array.isArray(listing.amenities) ? listing.amenities : []);
  const amenityLabels = [
    "Central A/C",
    "Built-in Wardrobes",
    "Balcony",
    "Shared Pool",
    "Private Pool",
    "Covered Parking",
    "Gym",
    "Security",
    "Concierge",
    "Pets Allowed",
    "Maid's Room",
    "Study",
    "Beach Access"
  ];
  const amenityPatterns = [
    /central a\/c/i,
    /built-in wardrobes/i,
    /balcony/i,
    /shared pool/i,
    /private pool/i,
    /covered parking/i,
    /\bgym\b/i,
    /security/i,
    /concierge/i,
    /pets allowed/i,
    /maid'?s room/i,
    /\bstudy\b/i,
    /beach access/i
  ];
  amenityPatterns.forEach((re, idx) => {
    if (re.test(text)) amenities.add(amenityLabels[idx]);
  });

  const agency_name =
    listing.agency_name ||
    firstMatch(text, [/Listed by\s+([^\n|]+)/i, /Agency[:\s]+([^\n|]+)/i]) ||
    "";

  return {
    ...listing,
    beds,
    baths,
    size_sqft,
    images,
    description: description.slice(0, 2000),
    amenities: [...amenities].slice(0, 16),
    agency_name: agency_name.slice(0, 120)
  };
}

export function listingNeedsDetailEnrich(listing = {}, { minImages = DETAIL_MIN_IMAGES } = {}) {
  const imgs = filterValidPortalImages(listing.images || []);
  const desc = String(listing.description || "").trim();
  return (
    Boolean(listing.source_url) &&
    (imgs.length < minImages || desc.length < 80 || listing.baths == null || listing.size_sqft == null)
  );
}

export async function enrichListingFromDetailPage(listing = {}) {
  if (!listing.source_url) return listing;

  const portal = await enrichListingFromPortalUrl(listing.source_url, listing);
  if (portal.ok && portal.listing) {
    const imgs = filterValidPortalImages(portal.listing.images || []);
    if (imgs.length >= 1) return { ...portal.listing, images: imgs };
  }

  const markdown = await fetchPortalMarkdown(listing.source_url);
  if (!markdown) return portal.listing || listing;
  return parseListingDetailFromMarkdown(markdown, portal.listing || listing);
}

async function mapWithConcurrency(items, fn, concurrency = 3) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

/** Full detail + photo gallery for chat cards. */
export async function enrichListingsWithDetail(listings = [], { minImages = DETAIL_MIN_IMAGES, max = 8 } = {}) {
  const cap = Math.min(listings.length, max);
  const targets = listings.slice(0, cap);
  const rest = listings.slice(cap);

  const enriched = await mapWithConcurrency(
    targets,
    async (row) => {
      if (!listingNeedsDetailEnrich(row, { minImages })) return row;
      try {
        return await enrichListingFromDetailPage(row);
      } catch {
        return row;
      }
    },
    3
  );

  return [...enriched, ...rest];
}
