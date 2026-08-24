/**
 * Build a property search query from session context (not raw "show me photos").
 */

import { userWantsPhotos, userExplicitlySearching } from "./intent.mjs";
import {
  extractEmiratesFromText,
  extractEmiratesFromSession,
  inferEmirateFromCommunity,
  stripLocationFieldsForEmirate
} from "./emirate-scope.mjs";

const EMIRATE_NAMES = new Set([
  "dubai",
  "abu dhabi",
  "sharjah",
  "ajman",
  "ras al khaimah",
  "fujairah",
  "umm al quwain",
  "uae"
]);

const AREA_PATTERNS = [
  /\b(?:\d\s*bhk|\d\s*br|\d\s*bed(?:room)?)\s+(?:apartment|flat|villa|studio)?\s*in\s+([A-Za-z0-9][A-Za-z0-9\s'-]{2,40}?)(?:\s+for|,|\.|$)/i,
  /\b(?:studio|apartment|villa|flat|property|1bhk|2bhk|3bhk|4bhk)\s+in\s+([A-Za-z0-9][A-Za-z0-9\s'-]{2,40}?)(?:\s+for|,|\.|$)/i,
  /\b(?:spacious\s+)?(?:studio|apartment|villa|flat)\s+in\s+([A-Za-z0-9][A-Za-z0-9\s'-]{2,40}?)(?:\s+for|,|\.|$)/i,
  /\bin\s+(Al\s+[A-Za-z0-9][A-Za-z0-9\s'-]{2,40}?)(?:\s+for|,|\.|$)/i,
  /\bin\s+([A-Za-z0-9][A-Za-z0-9\s'-]{2,40}?)(?:\s+for|\s+under|\s+AED|,|\.|$)/i
];

const PRICE_IN_TEXT = /AED\s*([\d,]+)/i;

/** Extract a neighbourhood/community — never a bare emirate name. */
export function extractAreaFromText(blob = "") {
  const text = String(blob || "");
  for (const re of AREA_PATTERNS) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const area = m[1].trim().replace(/\s+/g, " ");
    if (area.length < 3) continue;
    if (EMIRATE_NAMES.has(area.toLowerCase())) continue;
    return area;
  }
  const named = text.match(
    /\b(al\s+rashidiya(?:\s*\d+)?|al\s+qassimia|al\s+majaz|al\s+nahda|muwaileh|university\s+city|al\s+taawun|al\s+khan)\b/i
  );
  if (named?.[1]) return named[1].replace(/\s+/g, " ").trim();
  return null;
}

export function buildLiveSearchQuery(inbound = "", criteria = {}, session = {}) {
  const text = String(inbound || "").trim();
  const wantsPhotos = userWantsPhotos(text);
  const explicitSearch = userExplicitlySearching(text);
  const merged = mergeCriteriaFromSession(criteria, session, { currentMessage: inbound });

  if (!wantsPhotos && explicitSearch) return text;

  const parts = [];
  if (merged.beds != null) {
    parts.push(merged.beds === 0 ? "studio" : `${merged.beds} bedroom`);
  } else if (merged.property_type === "studio") {
    parts.push("studio");
  }
  if (merged.community) parts.push(merged.community);
  if (merged.emirate || merged.emirates?.[0]) parts.push(merged.emirate || merged.emirates[0]);
  if (merged.max_price) parts.push(`under AED ${merged.max_price}`);
  if (merged.transaction_type === "sale") parts.push("for sale");
  else if (merged.transaction_type === "rent" || !merged.transaction_type) parts.push("for rent");

  if (!parts.length || wantsPhotos) {
    const blob = (session.messages || [])
      .slice(-12)
      .map((m) => m.body)
      .join(" ");
    const area = extractAreaFromText(blob);
    const price = blob.match(PRICE_IN_TEXT);
    if (area && !parts.some((p) => p.toLowerCase().includes(area.toLowerCase()))) {
      parts.unshift(area);
    }
    if (price && !merged.max_price) parts.push(`AED ${price[1]}`);
  }

  if (parts.length) {
    return `${parts.join(" ")} UAE property site:bayut.com OR site:propertyfinder.ae OR site:dubizzle.com`;
  }
  return text;
}

/** Pull area/budget/property type from recent chat (incl. assistant messages). */
export function mergeCriteriaFromSession(criteria = {}, session = {}, { currentMessage = "" } = {}) {
  let next = { ...criteria };
  const blob = [(session.messages || []).slice(-12).map((m) => m.body).join(" "), currentMessage]
    .filter(Boolean)
    .join(" ");

  const areaFromCurrent = extractAreaFromText(currentMessage);
  if (areaFromCurrent) {
    next.community = areaFromCurrent;
  } else {
    const area = extractAreaFromText(blob);
    if (area) {
      const current = String(next.community || "").toLowerCase();
      const isEmirateOnly = EMIRATE_NAMES.has(current);
      if (!next.community || isEmirateOnly) next.community = area;
    }
  }

  const fromCurrent = extractEmiratesFromText(currentMessage);
  if (fromCurrent.length) {
    const prevEmirate = next.emirate;
    next.emirate = fromCurrent[0];
    delete next.emirates;
    if (prevEmirate && prevEmirate !== next.emirate) {
      next = stripLocationFieldsForEmirate(next, next.emirate);
    }
  } else if (areaFromCurrent) {
    const inferred = inferEmirateFromCommunity(areaFromCurrent);
    if (inferred) {
      next.emirate = inferred;
      delete next.emirates;
    }
  } else if (next.community && !next.emirate) {
    const inferred = inferEmirateFromCommunity(next.community);
    if (inferred) {
      next.emirate = inferred;
      delete next.emirates;
    }
  } else if (next.emirate) {
    delete next.emirates;
  } else {
    const fromHistory = extractEmiratesFromSession(session);
    if (fromHistory.length) {
      next.emirate = fromHistory[0];
      delete next.emirates;
    } else if (next.emirates?.length === 1) {
      next.emirate = next.emirates[0];
      delete next.emirates;
    }
  }

  const price = blob.match(PRICE_IN_TEXT);
  if (price && next.max_price == null) next.max_price = Number(price[1].replace(/,/g, ""));

  const bareBudget = [currentMessage, ...(session.messages || []).slice(-3).filter((m) => m.role === "user").map((m) => m.body)]
    .find((b) => /^\s*\d{4,6}\s*$/.test(String(b || "")));
  if (bareBudget && next.max_price == null) next.max_price = Number(String(bareBudget).trim());

  if (/\b1\s*bhk\b|\b1\s*br\b|\b1\s*bed/i.test(blob) && next.beds == null) {
    next.beds = 1;
    next.property_type = next.property_type || "apartment";
  }
  if (/studio/i.test(blob) && next.beds == null) {
    next.beds = 0;
    next.property_type = "studio";
  }
  if (!next.transaction_type) next.transaction_type = "rent";

  if (next.emirate) next = stripLocationFieldsForEmirate(next, next.emirate);

  return next;
}
