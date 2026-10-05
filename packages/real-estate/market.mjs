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
    "East Legon Hills",
    "Airport Residential",
    "Airport Hills",
    "Airport City",
    "Cantonments",
    "Labone",
    "Osu",
    "Dzorwulu",
    "Roman Ridge",
    "Ridge",
    "Achimota",
    "Tesano",
    "Spintex",
    "Baatsona",
    "Teshie",
    "Nungua",
    "Adenta",
    "Adjiringanor",
    "Haatso",
    "Kwabenya",
    "North Legon",
    "Dansoman",
    "Kaneshie",
    "Abelemkpe",
    "McCarthy Hill",
    "Weija",
    "Trasacco",
    "Dome"
  ],
  Kumasi: ["Ahodwo", "Nhyiaeso", "Asokwa", "Ayeduase", "Kentinkrono", "Bantama"],
  Tema: ["Community 25", "Community 18", "Community 4", "Community 1", "Sakumono"]
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

/** Standalone FIE AI (Vercel) hosts the PWA at origin root, not under /gh. */
export function isFieStandalone() {
  return (
    process.env.JAB_FIE_STANDALONE === "1" ||
    process.env.JAB_FIE_STANDALONE === "true" ||
    Boolean(process.env.VERCEL && String(process.env.JAB_RE_MARKET || "").toUpperCase().startsWith("GH"))
  );
}

export function getMarketCode() {
  const raw = String(process.env.JAB_RE_MARKET || "AE").trim().toUpperCase();
  return raw === "GH" || raw === "GHANA" ? "GH" : "AE";
}

export function getMarket() {
  const market = { ...MARKETS[getMarketCode()] };
  if (market.code === "GH" && isFieStandalone()) {
    market.pwaPath = "/";
    market.logo = "/fie-ai-logo.webp";
  }
  return market;
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

/** Public WhatsApp number for FIE chat (wa.me). Accepts 024… or 233… */
export function ghanaWaPhoneDigits(raw = process.env.JAB_RE_WA_PHONE || process.env.JAB_RE_GH_WA_PHONE || "") {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = `233${digits.slice(1)}`;
  if (digits.length === 9 && /^[235]/.test(digits)) digits = `233${digits}`;
  return digits;
}

export function publicMarketConfig() {
  const m = getMarket();
  const whatsappPhone = m.code === "GH" ? ghanaWaPhoneDigits() : "";
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
    whatsappPhone: whatsappPhone || null,
    consent:
      m.code === "GH"
        ? "I agree to pay GH₵100 to book this viewing (GH₵50 platform, GH₵50 held for the listing agent until I visit)."
        : "I agree to share my details with the listing agent"
  };
}

export function ghanaSystemPromptPrefix() {
  return [
    "You are FIE AI — Ghana’s professional AI real estate agent for rentals and homes for sale in Accra, Kumasi, Tema, and other cities.",
    "Talk in GH₵. Common types: self-contain, chamber and hall, compound house, single room, 2-bedroom, apartment, house.",
    "Landlords often want 1–2 years advance; the Rent Act caps legal advance at six months for longer tenancies. If they cannot pay the lump sum, send them to the attached rent-monthly partners (NRAS, Rent Masters, Renmo, ArchieRent, RENTBRiG) with official links — never invent a company.",
    "Landlords and agents can list a property for rent or sale from the FIE AI app (List your property).",
    "To book a viewing the client MUST pay GH₵100 first. After payment they get a PIN on WhatsApp. They give that PIN to the listing agent at the property. Do not tell them they can view for free.",
    "Never invent listings or prices. Only use attached listing cards and live inventory facts.",
    "If several cards share the same cluster, they may be the same physical property advertised by different agents — say so briefly."
  ].join(" ");
}
