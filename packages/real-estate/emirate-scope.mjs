/**
 * Strict emirate scoping — one emirate per search unless user explicitly asks for several.
 */

const EMIRATE_ALIASES = [
  ["abu dhabi", "Abu Dhabi"],
  ["abudhabi", "Abu Dhabi"],
  ["ras al khaimah", "Ras Al Khaimah"],
  ["umm al quwain", "Umm Al Quwain"],
  ["sharjah", "Sharjah"],
  ["fujairah", "Fujairah"],
  ["ajman", "Ajman"],
  ["dubai", "Dubai"]
];

export const COMMUNITY_EMIRATE = {
  "reem island": "Abu Dhabi",
  "yas island": "Abu Dhabi",
  "khalifa city": "Abu Dhabi",
  "al raha beach": "Abu Dhabi",
  "saadiyat island": "Abu Dhabi",
  "al reef": "Abu Dhabi",
  "corniche": "Abu Dhabi",
  "al majaz": "Sharjah",
  "al qassimia": "Sharjah",
  "al nahda": "Sharjah",
  muwaileh: "Sharjah",
  "university city": "Sharjah",
  "al taawun": "Sharjah",
  "al khan": "Sharjah",
  rashidiya: "Ajman",
  "al rashidiya": "Ajman",
  marina: "Dubai",
  jvc: "Dubai",
  "jumeirah village": "Dubai",
  "business bay": "Dubai",
  downtown: "Dubai",
  jlt: "Dubai",
  "silicon oasis": "Dubai",
  "dubai hills": "Dubai",
  "palm jumeirah": "Dubai",
  "motor city": "Dubai",
  "sports city": "Dubai",
  "discovery gardens": "Dubai",
  "international city": "Dubai",
  mirdif: "Dubai",
  "arabian ranches": "Dubai"
};

/** Portal URL slug → emirate (order matters: abu-dhabi before dubai). */
const URL_EMIRATE_PATTERNS = [
  [/abu-dhabi|abudhabi|al-ain/, "Abu Dhabi"],
  [/ras-al-khaimah|rak/, "Ras Al Khaimah"],
  [/umm-al-quwain|uaq/, "Umm Al Quwain"],
  [/sharjah/, "Sharjah"],
  [/fujairah/, "Fujairah"],
  [/ajman/, "Ajman"],
  [/dubai/, "Dubai"]
];

const MULTI_EMIRATE_RE =
  /\b(dubai\s+(?:and|&|or|\+)\s+abu dhabi|abu dhabi\s+(?:and|&|or|\+)\s+dubai|both emirates|all (?:seven\s+)?emirates|across (?:the\s+)?uae|any emirate)\b/i;

function aliasPattern(alias) {
  return alias.replace(/\s+/g, "\\s+");
}

/** Word-boundary emirate detection (avoids matching "dubai" inside "abu dhabi"). */
export function extractEmiratesFromText(text = "") {
  const lower = String(text || "").toLowerCase();
  const found = [];
  const used = new Set();

  for (const [alias, name] of EMIRATE_ALIASES) {
    const re = new RegExp(`\\b${aliasPattern(alias)}\\b`, "i");
    if (re.test(lower) && !used.has(name)) {
      found.push(name);
      used.add(name);
    }
  }
  return found;
}

/** Scan prior user turns (newest first) for an emirate mention. */
export function extractEmiratesFromSession(session = {}) {
  const userMsgs = (session.messages || [])
    .filter((m) => m.role === "user")
    .map((m) => String(m.body || ""))
    .reverse();

  for (const body of userMsgs) {
    const found = extractEmiratesFromText(body);
    if (found.length) return found;
  }
  return [];
}

export function inferEmirateFromCommunity(community = "") {
  const c = String(community || "").toLowerCase().trim();
  if (!c) return null;
  for (const [key, emirate] of Object.entries(COMMUNITY_EMIRATE)) {
    if (c.includes(key)) return emirate;
  }
  return null;
}

/** Resolve emirate from listing row + portal URL (guards mis-tagged DB rows). */
export function inferEmirateFromListing(listing = {}) {
  const url = String(listing.source_url || "").toLowerCase();
  if (url) {
    for (const [re, emirate] of URL_EMIRATE_PATTERNS) {
      if (re.test(url)) return emirate;
    }
  }
  const loc = String(listing.location || "").toLowerCase();
  if (loc) {
    for (const [re, emirate] of URL_EMIRATE_PATTERNS) {
      if (re.test(loc.replace(/\s+/g, "-"))) return emirate;
    }
    const fromLoc = extractEmiratesFromText(loc);
    if (fromLoc.length) return fromLoc[0];
  }
  return listing.emirate || null;
}

export function userWantsMultipleEmirates(text = "") {
  return MULTI_EMIRATE_RE.test(String(text || ""));
}

/** Drop community/sub-community tied to a different emirate than the active search. */
export function stripLocationFieldsForEmirate(criteria = {}, emirate = "") {
  if (!emirate || !criteria.community) return criteria;
  const commEm = inferEmirateFromCommunity(criteria.community);
  if (commEm && commEm !== emirate) {
    const next = { ...criteria };
    delete next.community;
    delete next.sub_community;
    return next;
  }
  return criteria;
}

function resolveFromDetectedList(detected = [], wantsMulti = false) {
  if (!detected.length) return null;
  if (detected.length === 1) return { emirate: detected[0], emirates: undefined };
  if (wantsMulti) return { emirate: detected[0], emirates: detected };
  return { emirate: detected[0], emirates: undefined };
}

/**
 * Collapse criteria to a strict emirate scope for listing search.
 * Priority: current message → session history → community → stored criteria → Dubai default.
 */
export function resolveEmirateScope(criteria = {}, { currentMessage = "", session = {} } = {}) {
  const wantsMulti =
    userWantsMultipleEmirates(currentMessage) ||
    userWantsMultipleEmirates((session.messages || []).map((m) => m.body).join(" "));

  const fromCurrent = extractEmiratesFromText(currentMessage);
  const fromCurrentScope = resolveFromDetectedList(fromCurrent, wantsMulti);
  if (fromCurrentScope) return fromCurrentScope;

  const fromSession = extractEmiratesFromSession(session);
  const fromSessionScope = resolveFromDetectedList(fromSession, wantsMulti);
  if (fromSessionScope) return fromSessionScope;

  const fromCommunity = inferEmirateFromCommunity(criteria.community);
  if (fromCommunity) return { emirate: fromCommunity, emirates: undefined };

  if (criteria.emirate) return { emirate: criteria.emirate, emirates: undefined };

  if (criteria.emirates?.length === 1) return { emirate: criteria.emirates[0], emirates: undefined };

  if (criteria.emirates?.length > 1 && wantsMulti) {
    return { emirate: criteria.emirates[0], emirates: criteria.emirates };
  }

  return { emirate: "Dubai", emirates: undefined };
}

export function allowedEmirates(scope = {}) {
  if (scope.emirates?.length) return scope.emirates;
  if (scope.emirate) return [scope.emirate];
  return [];
}

export function listingMatchesEmirateScope(listing = {}, scope = {}) {
  const allowed = allowedEmirates(scope);
  if (!allowed.length) return true;
  const set = new Set(allowed);
  const emirate = inferEmirateFromListing(listing);
  return emirate ? set.has(emirate) : false;
}

export function filterListingsByEmirate(listings = [], scope = {}) {
  const allowed = allowedEmirates(scope);
  if (!allowed.length) return listings;
  return listings.filter((l) => listingMatchesEmirateScope(l, scope));
}

/** Normalize search criteria with strict single-emirate default. */
export function normalizeSearchCriteria(criteria = {}, { currentMessage = "", session = {} } = {}) {
  const scope = resolveEmirateScope(criteria, { currentMessage, session });
  let next = { ...criteria, emirate: scope.emirate };
  if (scope.emirates?.length > 1) next.emirates = scope.emirates;
  else delete next.emirates;
  next = stripLocationFieldsForEmirate(next, scope.emirate);
  return next;
}

/** Apply emirate scope to in-memory session criteria (call before search). */
export function applyEmirateScopeToCriteria(criteria = {}, { currentMessage = "", session = {} } = {}) {
  const normalized = normalizeSearchCriteria(criteria, { currentMessage, session });
  const scope = resolveEmirateScope(normalized, { currentMessage, session });
  return { criteria: normalized, scope };
}
