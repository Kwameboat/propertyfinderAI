/**

 * Lightweight intent classification for UAE real estate concierge chat.

 */



const INTENTS = [

  "news",

  "market",

  "faq",

  "area_guide",

  "process",

  "move_in",

  "off_plan",

  "search_rent",

  "search_buy",

  "search_off_plan",

  "connect_agent",

  "general"

];



const NON_LISTING_INTENTS = new Set(["news", "market", "faq", "area_guide", "process", "move_in", "off_plan", "general"]);

export { NON_LISTING_INTENTS };



export function userExplicitlySearching(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/i need real data|need real data|not general perception|actual numbers|statistics/.test(lower)) return false;
  return /find|show me|search|looking for|need a|want a|i need a|i need an|i want a|i'm looking|im looking|got any|what do you have|what's available|whats available|any available|options in|homes in|properties in|apartments in|apartment in|villa in|studio in|flat in|pull up|send me some|can you find|help me find|any listings|see listings|see properties|see apartments|see homes|see places|\d\s*(?:bed|br|bhk)|for rent|to rent|for sale/.test(
    lower
  );
}



/** User wants to see listing photos in the app (not external links). */

export function userWantsPhotos(text = "") {

  const lower = String(text || "").toLowerCase();

  return /picture|photo|photos|pics|images|gallery|see what (?:they|it) look|what do they look|show me (?:the|some|a)?\s*(?:place|property|home|flat|apartment|studio|listing)|let me see|can i see|want to see/.test(

    lower

  );

}



/** User is asking about concrete homes (not market/area chat). */

export function userAskingAboutProperty(text = "") {

  const lower = String(text || "").toLowerCase();

  if (/trend|market|average rent|how much is rent|how much does|investment yield|cap rate|compare areas|calculator|checklist|ejari|dewa|news|regulation/.test(lower)) {

    return false;

  }

  return /apartment|apartments|flat|flats|villa|villas|townhouse|penthouse|penthouses|studio|studios|duplex|property|properties|home|homes|condo|unit|units|bedroom|bedrooms|\d\s*(?:bhk|br|bed)|for rent|to rent|for sale|to buy|place to live|housing|accommodation|listing|listings/.test(

    lower

  );

}



/** This turn only — user explicitly asked to see/find listings. */

export function userExplicitlyAsksForListings(text = "") {

  const lower = String(text || "").toLowerCase();

  if (userWantsPhotos(text)) return true;

  if (!userExplicitlySearching(text)) return false;

  return userAskingAboutProperty(text) || /listings|properties|homes|places|units|available/.test(lower);

}



export function shouldShowListingCards(text = "", criteria = {}, intent = "general") {
  if (userWantsPhotos(text) && userExplicitlyAsksForListings(text)) return true;
  if (/^\s*\d{4,6}\s*$/.test(String(text || "")) && (criteria.community || criteria.beds != null || criteria.property_type)) {
    return true;
  }
  if (criteria.community && !NON_LISTING_INTENTS.has(intent)) return true;
  if (NON_LISTING_INTENTS.has(intent) && !userExplicitlyAsksForListings(text) && intent !== "general") return false;
  if (intentNeedsListings(intent)) return true;
  if (userExplicitlyAsksForListings(text)) return true;
  if (userExplicitlySearching(text) && userAskingAboutProperty(text)) return true;
  return false;
}



export function intentNeedsChart(intent, text = "") {
  const lower = String(text || "").toLowerCase();
  if (userExplicitlyAsksForListings(text)) return false;
  if (/compare (?:these|them|#\d|the listings|side by side|which one|which is better)/.test(lower)) return false;
  if (intent === "market" || intent === "news") return true;

  if (intent === "move_in" && /calculator|cost|estimate|dewa|monthly/.test(lower)) return true;

  if (/trend|average rent|how much|market|calculator|compare|vs |versus|investment|yield|numbers|real data|statistics/.test(lower)) return true;

  return false;

}



export function hasSearchCriteria(criteria = {}) {

  return Boolean(

    criteria.community ||

      criteria.emirates?.length ||

      criteria.emirate ||

      criteria.beds != null ||

      criteria.max_price != null ||

      criteria.transaction_type

  );

}



export function classifyIntent(text = "", criteria = {}) {

  const lower = String(text || "").toLowerCase();



  if (/connect|contact agent|speak to agent|call the agent|whatsapp the agent/.test(lower)) {

    return "connect_agent";

  }

  if (/news|headline|latest|announcement|regulation|rera update|dld/.test(lower)) {

    return "news";

  }

  if (/trend|market|average rent|prices (?:in|for)|good time to buy|investment|yield|cap rate|rents (?:in|are)|how much (?:is|does)|numbers|real data|statistics|data on/.test(lower)) {
    return "market";
  }

  if (/move[\s-]?in|dewa|ejari|chiller|district cooling|snagging|checklist|utilities|internet setup|calculator|monthly cost/.test(lower)) {

    return "move_in";

  }

  if (/how (?:to|do)|steps|process|expat|mortgage|freehold|leasehold|dld fee|commission|visa|golden visa/.test(lower)) {

    return "process";

  }

  if (
    /tell me about|area guide|what(?:'s| is) .+ like|how(?:'s| is) .+ (?:like|for living)|vibe (?:in|of)/.test(
      lower
    ) &&
    !userAskingAboutProperty(lower) &&
    !userExplicitlySearching(lower) &&
    !/\d\s*(?:bed|br|bhk)/.test(lower)
  ) {
    return "area_guide";
  }

  if (/compare|vs|versus/.test(lower)) {
    if (/compare (?:these|them|#\d|the listings|the properties|side by side|which one)/.test(lower)) {
      return userExplicitlySearching(lower) ? "search_rent" : "general";
    }
  }

  if (/ejari|rera|tenancy|deposit|notice period|service charge|broker fee/.test(lower)) {

    return "faq";

  }

  if (/off[\s-]?plan|payment plan|handover|developer|emaar|damac|nakheel|aldar|sobha|binghatti|azizi/.test(lower)) {

    if (userExplicitlyAsksForListings(lower)) return "search_off_plan";

    return "off_plan";

  }



  if (userExplicitlyAsksForListings(lower)) {

    if (/buy|purchase|for sale/.test(lower) || criteria.transaction_type === "sale") return "search_buy";

    if (/off[\s-]?plan/.test(lower) || criteria.transaction_type === "off_plan") return "search_off_plan";

    return "search_rent";

  }



  return "general";

}



export function intentNeedsWeb(intent) {
  return intent === "news" || intent === "market" || intent === "area_guide" || intent === "process";
}



/** Live fetch from developer & government URL registry. */
export function intentNeedsDeveloperIntel(intent, text = "") {
  const lower = String(text || "").toLowerCase();
  if (intent === "off_plan" || intent === "search_off_plan") return true;
  if (intent === "news" && /dld|rera|regulation|developer|government|land department|adrec|dmt/.test(lower)) {
    return true;
  }
  if (/developer|developers|off[\s-]?plan|payment plan|handover|new project|project launch|launched by/.test(lower)) {
    return true;
  }
  if (/emaar|damac|nakheel|aldar|sobha|binghatti|azizi|meraas|danube|ellington|omniyat|dubai properties/.test(lower)) {
    return true;
  }
  if (/dld\.gov|dubailand|rera|adrec|dmt\.gov|land department|real estate regulation/.test(lower)) {
    return true;
  }
  return false;
}



export function intentNeedsKnowledge(intent) {
  return [
    "faq",
    "area_guide",
    "process",
    "move_in",
    "off_plan",
    "general",
    "market",
    "news",
    "search_rent",
    "search_buy",
    "search_off_plan"
  ].includes(intent);
}



export function intentNeedsListings(intent) {

  return ["search_rent", "search_buy", "search_off_plan"].includes(intent);

}



export function transactionTypeForIntent(intent, criteria = {}) {

  if (criteria.transaction_type) return criteria.transaction_type;

  if (intent === "search_buy") return "sale";

  if (intent === "search_off_plan") return "off_plan";

  if (intent === "search_rent") return "rent";

  return null;

}



export { INTENTS };

