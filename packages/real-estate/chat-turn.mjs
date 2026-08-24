/**
 * Per-turn chat routing — answer the user's exact question, search only when needed.
 */

import {
  classifyIntent,
  intentNeedsListings,
  intentNeedsChart,
  userExplicitlyAsksForListings,
  userExplicitlySearching,
  userWantsPhotos,
  userAskingAboutProperty
} from "./intent.mjs";
import { extractCriteria } from "./qualification.mjs";
import { inferEmirateFromCommunity } from "./emirate-scope.mjs";
import { preferListingImages } from "./listing-images.mjs";
import { userWantsListingCompare, extractCompareIndices } from "./listing-compare.mjs";

const REFINE_SEARCH =
  /\b(?:cheaper|lower budget|less expensive|more affordable|under\s+\d|max\s+\d|budget\s+(?:of|is)|instead|rather|switch to|change to|what about|how about|try|show me|any in|only|just|furnished|unfurnished|with (?:a )?pool|pet(?:s)? allowed|sea view|marina view|closer to|near)\b/i;

const SHOWN_LISTING_FOLLOWUP =
  /(?:#\d\b|\b(?:first one|second one|third one|fourth one|fifth one|last one|that one|this one|the one|listing\s*#?\d|option\s*#?\d|number\s*#?\d|which one|tell me more|more about|more details|full listing|full details|open (?:it|that|this|the)|does (?:it|that|this|the)|is (?:it|the|that|this) |how much is (?:it|that|the)|what'?s the rent|any photos|show photos|more photos|shortlist|pick(?:ing)?)\b)/i;

const MORE_HOMES_AFTER_BOOKING =
  /\b(?:show (?:me )?(?:more|other|different)|other options|more options|keep looking|keep searching|something else|another (?:area|place|property)|different area|new listings|more listings|more homes|other homes)\b/i;

export function sessionHasBooking(session = {}) {
  return (
    session.status === "lead_submitted" ||
    Boolean(session.criteria?.booked_listing_id) ||
    Boolean(session.criteria?.booked_at)
  );
}

export function userWantsMoreHomesAfterBooking(text = "", session = {}) {
  const inbound = String(text || "").trim();
  if (MORE_HOMES_AFTER_BOOKING.test(inbound)) return true;
  const thisTurn = extractCriteria(inbound, {});
  const bookedCommunity = String(session.criteria?.booked_community || "").toLowerCase();
  if (
    thisTurn.community &&
    bookedCommunity &&
    thisTurn.community.toLowerCase() !== bookedCommunity &&
    inferEmirateFromCommunity(thisTurn.community)
  ) {
    return true;
  }
  return false;
}

const DIRECT_QUESTION =
  /\?|^(?:what|how|why|when|where|who|which|can i|could i|do you|does it|is there|are there|tell me|explain|help me understand)\b/i;

const GREETING_ONLY =
  /^(?:hi|hello|hey|thanks|thank you|ok|okay|cool|great|got it|cheers|salam|marhaba|shukran|yes|no|sure)\b[\s!.]*$/i;

const PURE_GREETING =
  /^(?:hi|hello|hey|thanks|thank you|cheers|salam|marhaba|shukran)\b[\s!.]*$/i;

/** User is refining an active property search (new criteria → re-search). */
export function userRefiningSearch(text = "", session = {}) {
  const lower = String(text || "").toLowerCase();
  if (userExplicitlySearching(lower)) return true;
  if (REFINE_SEARCH.test(lower) && (session.criteria?.emirate || session.criteria?.community || session.criteria?.beds != null)) {
    return true;
  }
  if (/^\s*\d{4,6}\s*$/.test(lower) && session.criteria?.community) return true;
  return false;
}

/** User refers to listings already shown in this chat. */
export function userAskingAboutShownListings(text = "", session = {}) {
  const lower = String(text || "").toLowerCase();
  const hasRecent = (session.criteria?.recent_listing_ids || []).length > 0;
  if (!hasRecent) return false;
  if (userWantsListingCompare(text)) return false;
  if (userRefiningSearch(text, session) && !SHOWN_LISTING_FOLLOWUP.test(lower)) return false;
  if (SHOWN_LISTING_FOLLOWUP.test(lower)) return true;
  if (/^(?:that|this|it)\b/.test(lower.trim()) && DIRECT_QUESTION.test(lower)) return true;
  return false;
}

export function extractFocusedListingIndex(text = "", session = {}) {
  const indices = extractCompareIndices(text);
  if (indices.length === 1) return indices[0];
  const lower = String(text || "").toLowerCase();
  if (/\bfirst\b|\b#1\b|\boption 1\b/.test(lower)) return 0;
  if (/\bsecond\b|\b#2\b|\boption 2\b/.test(lower)) return 1;
  if (/\bthird\b|\b#3\b|\boption 3\b/.test(lower)) return 2;
  if (/\bfourth\b|\b#4\b/.test(lower)) return 3;
  if (/\blast\b/.test(lower) && session.criteria?.recent_listing_ids?.length) {
    return session.criteria.recent_listing_ids.length - 1;
  }
  return null;
}

/**
 * Classify this turn for routing.
 * @returns {{ turn, intent, shouldSearch, shouldReuseRecent, focusIndex, answerMode }}
 */
export function classifyChatTurn(text = "", criteria = {}, session = {}) {
  const inbound = String(text || "").trim();
  const intent = classifyIntent(inbound, criteria);
  const wantsCompare = userWantsListingCompare(inbound);

  if (wantsCompare) {
    return {
      turn: "compare",
      intent,
      shouldSearch: false,
      shouldReuseRecent: true,
      focusIndex: null,
      answerMode: "compare"
    };
  }

  if (intentNeedsChart(intent, inbound)) {
    return {
      turn: "market",
      intent,
      shouldSearch: false,
      shouldReuseRecent: false,
      focusIndex: null,
      answerMode: "market"
    };
  }

  if (sessionHasBooking(session) && !userWantsMoreHomesAfterBooking(inbound, session)) {
    return {
      turn: "post_booking",
      intent: "general",
      shouldSearch: false,
      shouldReuseRecent: false,
      focusIndex: extractFocusedListingIndex(inbound, session),
      answerMode: "post_booking"
    };
  }

  const skipSearchIntents = new Set(["news", "market", "faq", "area_guide", "process", "move_in", "off_plan"]);
  if (skipSearchIntents.has(intent) && !userExplicitlyAsksForListings(inbound) && !userRefiningSearch(inbound, session)) {
    return {
      turn: intent,
      intent,
      shouldSearch: false,
      shouldReuseRecent: userAskingAboutShownListings(inbound, session),
      focusIndex: extractFocusedListingIndex(inbound, session),
      answerMode: intent === "faq" || intent === "process" ? "faq" : intent === "area_guide" ? "area" : intent
    };
  }

  if (userAskingAboutShownListings(inbound, session)) {
    return {
      turn: "listing_followup",
      intent,
      shouldSearch: false,
      shouldReuseRecent: true,
      focusIndex: extractFocusedListingIndex(inbound, session),
      answerMode: "listing_followup"
    };
  }

  if (PURE_GREETING.test(inbound)) {
    return {
      turn: "greeting",
      intent: "general",
      shouldSearch: false,
      shouldReuseRecent: false,
      focusIndex: null,
      answerMode: "greeting"
    };
  }

  const thisTurn = extractCriteria(inbound, {});
  const namedPlaceSearch =
    Boolean(thisTurn.community) ||
    Boolean(
      (thisTurn.emirate || thisTurn.emirates?.length) &&
        (thisTurn.beds != null || thisTurn.property_type || thisTurn.max_price != null || userAskingAboutProperty(inbound))
    );

  const explicitSearch =
    userExplicitlyAsksForListings(inbound) ||
    userRefiningSearch(inbound, session) ||
    intentNeedsListings(intent) ||
    userWantsPhotos(inbound) ||
    namedPlaceSearch;

  if (explicitSearch) {
    return {
      turn: "listing_search",
      intent,
      shouldSearch: true,
      shouldReuseRecent: false,
      focusIndex: null,
      answerMode: "search"
    };
  }

  if (GREETING_ONLY.test(inbound)) {
    return {
      turn: "greeting",
      intent: "general",
      shouldSearch: false,
      shouldReuseRecent: false,
      focusIndex: null,
      answerMode: "greeting"
    };
  }

  if (DIRECT_QUESTION.test(inbound) && !userAskingAboutProperty(inbound)) {
    return {
      turn: "question",
      intent,
      shouldSearch: false,
      shouldReuseRecent: false,
      focusIndex: null,
      answerMode: intent === "general" ? "general" : intent
    };
  }

  return {
    turn: "general",
    intent,
    shouldSearch: false,
    shouldReuseRecent: false,
    focusIndex: null,
    answerMode: "general"
  };
}

function mergeSnapshotListing(snap, row) {
  if (!snap && !row) return null;
  if (!row) return snap;
  if (!snap) return row;
  const images = preferListingImages(snap.images || (snap.image ? [snap.image] : []), row.images || (row.image ? [row.image] : []));
  const snapDesc = String(snap.description || "").trim();
  const rowDesc = String(row.description || "").trim();
  return {
    ...row,
    ...snap,
    images,
    image: images[0] || snap.image || row.image || null,
    description: snapDesc.length >= rowDesc.length ? snapDesc : rowDesc,
    amenities: snap.amenities?.length ? snap.amenities : row.amenities || [],
    source_url: snap.source_url || row.source_url,
    baths: snap.baths ?? row.baths,
    size_sqft: snap.size_sqft ?? row.size_sqft
  };
}

export async function loadRecentListings(db, session = {}, { getListingStore, focusIndex = null, limit = 8 } = {}) {
  const snapshots = session.criteria?.recent_listings || [];
  const ids = session.criteria?.recent_listing_ids || snapshots.map((s) => s.id).filter(Boolean);
  if (!ids.length && snapshots.length) return snapshots.slice(0, limit);

  const byId = new Map(snapshots.map((s) => [String(s.id), s]));
  const order = focusIndex != null && ids[focusIndex] ? [ids[focusIndex], ...ids.filter((_, i) => i !== focusIndex)] : ids;

  const rows = [];
  for (const id of order.slice(0, limit)) {
    const snap = byId.get(String(id)) || snapshots.find((s) => s.source && id === `${s.source}:${s.external_id}`);
    let row = null;
    try {
      row = await getListingStore(db, id);
    } catch {
      /* skip store miss */
    }
    const merged = mergeSnapshotListing(snap, row);
    if (merged) rows.push(merged);
  }
  return rows;
}
