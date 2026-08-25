/**
 * Market switch: UAE (Dar Concierge) vs Ghana (FIE AI).
 * Default AE so the live UAE deploy is unchanged unless JAB_RE_MARKET=GH.
 */

export const GHANA_CITIES = [
  "Accra",
  "Kumasi",
  "Tema",
  "Takoradi",
  "Cape Coast",
  "Tamale",
  "Kasoa",
  "Madina"
];

export const GHANA_AREAS = {
  Accra: [
    "East Legon",
    "Airport Residential",
    "Airport Hills",
    "Cantonments",
    "Labone",
    "Osu",
    "Dzorwulu",
    "Roman Ridge",
    "Achimota",
    "Spintex",
    "Adenta",
    "Adjiringanor",
    "Haatso",
    "Kwabenya",
    "Dansoman",
    "Kaneshie",
    "Abelemkpe",
    "McCarthy Hill",
    "Weija",
    "Trasacco"
  ],
  Kumasi: ["Ahodwo", "Nhyiaeso", "Asokwa", "Ayeduase", "Kentinkrono"],
  Tema: ["Community 25", "Community 18", "Community 1", "Sakumono"]
};

const MARKETS = {
  AE: {
    code: "AE",
    brand: "Dar Concierge AI",
    shortName: "Dar Concierge",
    tagline: "Your UAE AI Property Assistant",
    currency: "AED",
    currencySymbol: "AED",
    phoneLabel: "UAE phone",
    phonePlaceholder: "+971 50 xxx xxxx",
    phoneRegion: "AE",
    cities: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah", "Umm Al Quwain"],
    portals: ["bayut", "propertyfinder", "dubizzle", "emaar", "damac"],
    viewingFeeGhs: 0,
    commissionRate: 0,
    payToView: false,
    pwaPath: "/rent"
  },
  GH: {
    code: "GH",
    brand: "FIE AI",
    shortName: "FIE",
    tagline: "Your AI real estate agent in Ghana",
    logo: "/fie-ai-logo.webp",
    currency: "GHS",
    currencySymbol: "GH₵",
    phoneLabel: "Ghana phone",
    phonePlaceholder: "024 xxx xxxx",
    phoneRegion: "GH",
    cities: GHANA_CITIES,
    portals: ["meqasa", "jiji", "ghanapropertycentre", "tonaton"],
    directSource: "fie_direct",
    viewingFeeGhs: 100,
    platformShareGhs: 50,
    agentShareGhs: 50,
    commissionRate: 0.1,
    commissionSplitPlatform: 0.5,
    payToView: true,
    pwaPath: "/gh"
  }
};

export function getMarketCode() {
  const raw = String(process.env.JAB_RE_MARKET || "AE").trim().toUpperCase();
  return raw === "GH" || raw === "GHANA" ? "GH" : "AE";
}

export function getMarket() {
  return MARKETS[getMarketCode()];
}

export function isGhanaMarket() {
  return getMarketCode() === "GH";
}

export const GHANA_PORTALS = MARKETS.GH.portals;
export const GHANA_DIRECT_SOURCE = MARKETS.GH.directSource || "fie_direct";
export const GHANA_LISTING_SOURCES = [...GHANA_PORTALS, GHANA_DIRECT_SOURCE];
export const UAE_PORTALS = MARKETS.AE.portals;

/** Portal + landlord/agent listings shown in Ghana search (excludes scrape-only filters). */
export function ghanaListingSources() {
  return [...GHANA_LISTING_SOURCES];
}

export function marketPortalSources(market = getMarket()) {
  return [...(market.portals || [])];
}

export function formatMoney(amount, market = getMarket()) {
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString(market.code === "GH" ? "en-GH" : "en-AE");
  return market.code === "GH" ? `GH₵ ${formatted}` : `AED ${formatted}`;
}

export function publicMarketConfig() {
  const m = getMarket();
  return {
    code: m.code,
    brand: m.brand,
    shortName: m.shortName,
    tagline: m.tagline,
    currency: m.currency,
    currencySymbol: m.currencySymbol,
    phoneLabel: m.phoneLabel,
    phonePlaceholder: m.phonePlaceholder,
    cities: m.cities,
    payToView: m.payToView,
    viewingFeeGhs: m.viewingFeeGhs,
    pwaPath: m.pwaPath,
    logo: m.logo || "/dar-concierge-logo.png",
    consent:
      m.code === "GH"
        ? "I agree to pay GH₵100 to book this viewing (GH₵50 platform, GH₵50 held for the listing agent until I visit)."
        : "I agree to share my details with the listing agent"
  };
}

export function ghanaSystemPromptPrefix() {
  return [
    "You are FIE AI — Ghana’s AI real estate agent for rentals and homes for sale in Accra, Kumasi, Tema, and other cities.",
    "Talk in GH₵. Common types: self-contain, chamber and hall, compound house, single room, 2-bedroom, apartment, house.",
    "Landlords and agents can list a property for rent or sale from the FIE AI app (List your property).",
    "To book a viewing the client MUST pay GH₵100 first. After payment they get a PIN on WhatsApp. They give that PIN to the listing agent at the property. Do not tell them they can view for free.",
    "Never invent listings. Only use attached listing cards.",
    "If several cards share the same cluster, they may be the same physical property advertised by different agents — say so briefly."
  ].join(" ");
}
