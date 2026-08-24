/**
 * Extract / merge UAE property search criteria from user messages.
 */

import { UAE_EMIRATES } from "../hub-db/real-estate.mjs";
import {
  COMMUNITY_EMIRATE,
  extractEmiratesFromText,
  inferEmirateFromCommunity,
  userWantsMultipleEmirates
} from "./emirate-scope.mjs";

export function extractInvestorIntent(text = "", existing = {}) {
  const lower = String(text || "").toLowerCase();
  if (/off[\s-]?plan|payment plan|handover|post[\s-]?handover|developer project/.test(lower)) return "off_plan";
  if (/invest|investor|yield|roi|cap rate|rental return|passive income/.test(lower)) return "invest";
  if (/\bbuy\b|purchase|for sale|ready property|freehold/.test(lower)) return "buy";
  return existing.investor_intent || existing.lead_type || null;
}

export function extractCriteria(text = "", existing = {}) {
  const lower = String(text || "").toLowerCase();
  const next = { ...existing };

  const investorIntent = extractInvestorIntent(text, existing);
  if (investorIntent) next.investor_intent = investorIntent;

  if (/off[\s-]?plan/.test(lower) || investorIntent === "off_plan") next.transaction_type = "off_plan";
  else if (/\bbuy\b|purchase|for sale|ready property/.test(lower) || investorIntent === "buy")
    next.transaction_type = "sale";
  else if (/\brent\b|lease|tenan/.test(lower)) next.transaction_type = "rent";

  if (/\bstudio\b/.test(lower)) {
    next.beds = 0;
    next.property_type = "studio";
  }

  if (/\b(?:apartment|flat)s?\b/.test(lower)) next.property_type = next.property_type || "apartment";
  if (/\bvilla/.test(lower)) next.property_type = "villa";
  if (/\bpenthouse/.test(lower)) next.property_type = "penthouse";
  if (/\btownhouse/.test(lower)) next.property_type = "townhouse";

  const bedMatch =
    lower.match(/(\d+)\s*(?:bhk|br|bed|bedroom)s?\b/) ||
    lower.match(/\b(\d+)bhk\b/);
  if (bedMatch) next.beds = Number(bedMatch[1]);

  const detectedEmirates = extractEmiratesFromText(text);
  if (detectedEmirates.length) {
    if (detectedEmirates.length > 1 && userWantsMultipleEmirates(text)) {
      next.emirates = detectedEmirates;
      next.emirate = detectedEmirates[0];
    } else {
      const prevEmirate = next.emirate;
      next.emirate = detectedEmirates[0];
      delete next.emirates;
      if (prevEmirate && prevEmirate !== next.emirate && next.community) {
        const commEm = inferEmirateFromCommunity(next.community);
        if (commEm && commEm !== next.emirate) {
          delete next.community;
        }
      }
    }
  }

  const budgetK = lower.match(/(\d{2,3})\s*k\b/);
  const budgetAed = lower.match(/aed\s*([\d,]+)/i) || lower.match(/([\d,]+)\s*aed/i);
  if (budgetK) {
    const val = Number(budgetK[1]) * 1000;
    if (next.transaction_type === "rent") next.max_price = val;
    else next.max_price = val;
  } else if (budgetAed) {
    next.max_price = Number(budgetAed[1].replace(/,/g, ""));
  } else if (/^\s*(\d{4,6})\s*$/.test(lower)) {
    next.max_price = Number(lower.trim());
  }

  const range = lower.match(/(\d{2,3})\s*[-–to]+\s*(\d{2,3})\s*k/);
  if (range) {
    next.min_price = Number(range[1]) * 1000;
    next.max_price = Number(range[2]) * 1000;
  }

  if (/unfurnished/.test(lower)) next.furnished = false;
  if (/furnished/.test(lower) && !/unfurnished/.test(lower)) next.furnished = true;

  const extraCommunities = ["al ain", "dubai marina", "jumeirah village circle"];
  const communityKeys = [...new Set([...Object.keys(COMMUNITY_EMIRATE), ...extraCommunities])].sort(
    (a, b) => b.length - a.length
  );
  for (const c of communityKeys) {
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (!new RegExp(`\\b${escaped}\\b`, "i").test(lower)) continue;
    const key = c === "dubai marina" ? "marina" : c === "jumeirah village circle" ? "jvc" : c;
    next.community =
      key === "jvc"
        ? "JVC"
        : key === "jlt"
          ? "JLT"
          : key === "qassimia" || key === "al qassimia"
            ? "Al Qassimia"
            : key === "al majaz"
              ? "Al Majaz"
              : key === "al nahda"
                ? "Al Nahda"
                : key === "muwaileh"
                  ? "Muwaileh"
                  : key === "university city"
                    ? "University City"
                    : key === "al ain"
                      ? "Al Ain"
                      : key.includes("rashidiya")
                        ? "Al Rashidiya 3"
                        : key.replace(/\b\w/g, (m) => m.toUpperCase());
    const inferred = inferEmirateFromCommunity(next.community) || COMMUNITY_EMIRATE[key];
    if (inferred) {
      next.emirate = inferred;
      delete next.emirates;
    }
    break;
  }

  const rashidiyaMatch = lower.match(/\bal\s+rashidiya(?:\s*(\d+))?\b/i);
  if (rashidiyaMatch) {
    next.community = rashidiyaMatch[1] ? `Al Rashidiya ${rashidiyaMatch[1]}` : "Al Rashidiya";
    next.emirate = "Ajman";
  }

  if (/asap|immediately|urgent/.test(lower)) next.move_in = "asap";
  const monthMatch = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i);
  if (monthMatch) next.move_in = monthMatch[0];

  return applyCriteriaRefinements(next, text, existing);
}

/** Follow-up refinements: cheaper, what about X, only furnished, etc. */
export function applyCriteriaRefinements(criteria = {}, text = "", previous = {}) {
  const lower = String(text || "").toLowerCase();
  const next = { ...criteria };

  if (/\b(?:cheaper|lower budget|less expensive|more affordable|reduce budget)\b/.test(lower)) {
    const cap = next.max_price || previous.max_price;
    if (cap) next.max_price = Math.round(cap * 0.85);
  }

  if (/\b(?:more expensive|higher budget|premium|luxury|upscale)\b/.test(lower)) {
    const cap = next.max_price || previous.max_price;
    if (cap) next.max_price = Math.round(cap * 1.25);
  }

  const underMatch = lower.match(/\bunder\s+(?:aed\s*)?([\d,]+)\b/i) || lower.match(/\bmax(?:imum)?\s+(?:aed\s*)?([\d,]+)\b/i);
  if (underMatch) next.max_price = Number(underMatch[1].replace(/,/g, ""));

  if (/\bwhat about\b|\bhow about\b|\binstead\b|\brather\b|\bswitch to\b|\btry\b/.test(lower)) {
    const areaMatch = lower.match(/\b(?:what|how) about\s+([a-z0-9][a-z0-9\s'-]{2,40}?)(?:\s+instead|\?|$|,)/i);
    if (areaMatch?.[1]) {
      const area = areaMatch[1].trim().replace(/\s+/g, " ");
      if (!/^(?:that|this|it|those|these|cheaper|furnished)$/i.test(area)) {
        next.community = area.replace(/\b\w/g, (m) => m.toUpperCase());
      }
    }
  }

  if (/\bpet(?:s)? allowed\b|\bpet friendly\b/.test(lower)) next.amenity = "pets";
  if (/\bpool\b|\bgym\b|\bbeach\b|\bsea view\b|\bmarina view\b/.test(lower)) {
    if (/\bpool\b/.test(lower)) next.amenity = "pool";
    if (/\bsea view\b|\bmarina view\b/.test(lower)) next.amenity = "view";
  }

  return next;
}

export function criteriaReadyForSearch(criteria = {}, transactionType = "rent") {
  const hasLocation = Boolean(criteria.emirates?.length || criteria.emirate || criteria.community);
  const hasBeds = criteria.beds != null || transactionType === "off_plan";
  const hasBudget = criteria.max_price != null || transactionType === "off_plan";
  return hasLocation && (hasBeds || hasBudget);
}

export function scoreLead(criteria = {}, messages = []) {
  let score = 0;
  if (criteria.beds != null) score += 15;
  if (criteria.emirates?.length || criteria.emirate) score += 15;
  if (criteria.max_price != null) score += 20;
  if (criteria.community) score += 10;
  if (criteria.furnished != null) score += 5;
  if (messages.length >= 4) score += 10;
  if (criteria.transaction_type) score += 10;
  if (criteria.investor_intent === "invest" || criteria.investor_intent === "off_plan") score += 15;
  return Math.min(100, score);
}

export function normalizeUaePhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("971")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+971${digits.slice(1)}`;
  if (digits.length === 9) return `+971${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export { UAE_EMIRATES };
