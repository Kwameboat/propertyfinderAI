/**
 * Seed UAE real estate knowledge base + sample listings.
 * Run: node scripts/seed-uae-real-estate.mjs
 */

import { openHubDb, upsertListing, upsertKnowledge, countActiveListings } from "../packages/hub-db/index.mjs";
import {
  syncListingToSupabase,
  isSupabaseEnabled
} from "../packages/real-estate/supabase.mjs";
import { generateExpandedSeedListings } from "../packages/real-estate/data/seed-listings.mjs";
import { loadHubEnv } from "../packages/real-estate/env.mjs";
import { isZeroCostMode } from "../packages/real-estate/mode.mjs";

loadHubEnv();

const skipDemoListings =
  isZeroCostMode() || String(process.env.JAB_RE_NO_DEMO_LISTINGS ?? "").match(/^(1|true|yes)$/i);

const KNOWLEDGE = [
  {
    slug: "ejari-overview",
    title: "Ejari — tenancy registration in Dubai",
    category: "faq",
    tags: ["ejari", "rent", "dubai", "tenancy"],
    body: `Ejari is Dubai's mandatory online tenancy registration system run via Dubai Land Department (DLD). Landlords or their agents register the lease so DEWA, visa, and other services can be linked to your address. Typical documents: Emirates ID, passport copy, signed tenancy contract, and landlord title deed or authorization. Registration fees apply (often paid by tenant or split — confirm in contract). Always register before or soon after move-in.`
  },
  {
    slug: "dewa-move-in",
    title: "DEWA activation — move-in utilities",
    category: "move_in",
    tags: ["dewa", "utilities", "dubai", "move in"],
    body: `DEWA (Dubai Electricity and Water Authority) supplies power and water. After Ejari, activate DEWA online or at a service centre with tenancy contract, Ejari certificate, Emirates ID, and passport. You'll pay a security deposit plus connection fees. Ask whether cooling is district cooling (Empower/Tabreed) or chiller included in rent — this affects monthly bills significantly.`
  },
  {
    slug: "rera-broker-role",
    title: "RERA and registered brokers",
    category: "faq",
    tags: ["rera", "broker", "regulation"],
    body: `RERA (Real Estate Regulatory Agency) regulates brokers and agents in Dubai. Licensed brokers should hold a RERA card/brn. Trakheesi permits are required for property advertisements in Dubai. As a renter or buyer, verify the agent's registration and the listing permit where shown. We connect you with listing agents but do not represent properties ourselves.`
  },
  {
    slug: "rent-vs-buy-uae",
    title: "Rent vs buy in the UAE — high-level",
    category: "process",
    tags: ["rent", "buy", "investment"],
    body: `Renting offers flexibility — typical leases are 1 year with cheques (1–4 cheques common). Buying gives ownership in designated freehold areas (especially Dubai and Abu Dhabi). Costs when buying include DLD transfer fee (~4% in Dubai), registration, and agent commission (often 2% buyer side — confirm). Off-plan spreads payment over construction but carries developer/handover risk. Run the numbers for your timeline — many expats rent first 1–2 years while exploring areas.`
  },
  {
    slug: "off-plan-basics",
    title: "Off-plan property — what to know",
    category: "off_plan",
    tags: ["off plan", "handover", "payment plan", "oqood"],
    body: `Off-plan means buying before construction completes. Payment plans are usually linked to construction milestones. Key checks: developer track record, escrow account (RERA-regulated projects in Dubai), SPA (Sales Purchase Agreement) review by a lawyer, handover date realism, and service charges after handover. Oqood registers off-plan ownership in Dubai. Snagging inspections at handover are essential.`
  },
  {
    slug: "dld-buyer-fees",
    title: "DLD fees when buying in Dubai",
    category: "process",
    tags: ["dld", "fees", "buy", "dubai"],
    body: `Major buyer cost in Dubai is DLD transfer fee — commonly 4% of property value plus admin charges. Additional costs may include trustee office fee, mortgage registration if financed, and agency commission. Budget 5–7% on top of price for total closing costs as a rule of thumb (verify current DLD schedule).`
  },
  {
    slug: "move-in-checklist",
    title: "Move-in checklist (UAE renter)",
    category: "move_in",
    tags: ["checklist", "move in", "ejari", "dewa", "internet"],
    body: `Typical order: (1) Sign tenancy contract — read break clauses and cheque schedule. (2) Register Ejari. (3) Activate DEWA. (4) Set up district cooling account if separate. (5) Internet/TV (Etisalat/du). (6) Snagging list for any defects — photo everything. (7) Update address for bank, Emirates ID if required. Keep copies of all receipts.`
  },
  {
    slug: "dubai-marina-guide",
    title: "Dubai Marina — area guide for renters",
    category: "area_guide",
    tags: ["marina", "dubai", "rent", "area"],
    body: `Dubai Marina is a high-rise waterfront community popular with expats. Pros: walkable promenade, metro access, restaurants, beach proximity. Cons: traffic at peak hours, premium rents, older towers may have higher service charges. Typical audience: young professionals and couples. Good if you want lifestyle and don't mind paying for location.`
  },
  {
    slug: "jvc-guide",
    title: "JVC (Jumeirah Village Circle) — area guide",
    category: "area_guide",
    tags: ["jvc", "dubai", "rent", "affordable"],
    body: `JVC offers more affordable rents than Marina/Downtown with family-friendly vibe. Mix of apartments and townhouses, plenty of supermarkets and schools nearby. Pros: value for money, community feel. Cons: further from beach, car helps. Popular for families and budget-conscious renters wanting Dubai address.`
  },
  {
    slug: "abu-dhabi-reem",
    title: "Abu Dhabi — Reem Island guide",
    category: "area_guide",
    tags: ["abu dhabi", "reem island", "rent"],
    body: `Reem Island is a major Abu Dhabi residential hub with modern towers, schools, and malls. Popular with expat families. Rents generally lower than premium Dubai Marina but quality stock is strong. Check commute to work (Saadiyat, Al Maryah, mainland).`
  },
  {
    slug: "sharjah-renting",
    title: "Renting in Sharjah",
    category: "area_guide",
    tags: ["sharjah", "rent", "emirates"],
    body: `Sharjah offers significantly lower rents than Dubai with strong family communities (Al Khan, Al Majaz, Muwaileh). Many Dubai workers commute daily — factor travel time. Sharjah has its own tenancy rules via Sharjah Real Estate Registration Directorate. Alcohol and some lifestyle rules differ from Dubai.`
  },
  {
    slug: "golden-visa-property",
    title: "Golden visa and property investment",
    category: "process",
    tags: ["golden visa", "investment", "buy"],
    body: `UAE golden visa routes have included property investment thresholds (historically around AED 2M+ for certain categories — verify current ICA/GDRFA rules as they change). Property must meet eligibility criteria. Consult immigration specialist and developer — we provide general awareness only, not immigration advice.`
  },
  {
    slug: "service-charges",
    title: "Service charges explained",
    category: "faq",
    tags: ["service charge", "buy", "off plan"],
    body: `Service charges cover building maintenance, common areas, security, and sometimes cooling infrastructure. Paid annually per sq ft — varies wildly by tower and area. When comparing buys or off-plan, ask for latest service charge rate (OC/reseller disclosure). High SC can erase rental yield.`
  },
  {
    slug: "seven-emirates-overview",
    title: "UAE seven emirates — property overview",
    category: "area_guide",
    tags: ["emirates", "dubai", "abu dhabi", "sharjah", "ajman", "rak", "fujairah", "uaq"],
    body: `Dubai: largest expat market, freehold zones, highest volume. Abu Dhabi: capital, strong government/energy sector demand. Sharjah: affordable, family-oriented. Ajman: budget alternative to Sharjah/Dubai border. RAK: tourism, some off-plan resorts. Fujairah: east coast, limited stock. UAQ: small residential market. Most listing volume is Dubai > Abu Dhabi > Sharjah > others.`
  },
  {
    slug: "uae-rent-market-trends",
    title: "UAE rental market — how to read live trends",
    category: "market",
    tags: ["market", "trend", "rent", "dubai", "abu dhabi", "statistics", "data"],
    body: `Our concierge computes live rent medians from active Bayut/Property Finder inventory — not stale reports. Dubai typically commands higher medians than Abu Dhabi for equivalent stock; Sharjah sits lower. Compare like-for-like (bed count, furnished vs unfurnished). Median annual rent is the best single figure for budgeting; always check min–max range for outliers. YoY movement in UAE rentals has recently been modest single-digit in most communities — verify against the live chart for the exact area asked.`
  }
];

const LISTINGS = [
  {
    source: "seed",
    external_id: "rent-jvc-2br-01",
    transaction_type: "rent",
    property_type: "apartment",
    beds: 2,
    baths: 2,
    emirate: "Dubai",
    community: "JVC",
    building: "Belgravia",
    price_aed: 82000,
    price_period: "yearly",
    furnished: false,
    amenities: ["pool", "gym", "parking"],
    images: ["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=640"],
    description: "Spacious 2BR unfurnished with balcony, community pool and gym.",
    agent_name: "Sarah Ahmed",
    agent_phone: "+971501234567",
    agency_name: "Sample Realty",
    source_url: "https://www.bayut.com/"
  },
  {
    source: "seed",
    external_id: "rent-marina-2br-01",
    transaction_type: "rent",
    property_type: "apartment",
    beds: 2,
    baths: 2,
    emirate: "Dubai",
    community: "Dubai Marina",
    price_aed: 145000,
    price_period: "yearly",
    furnished: true,
    amenities: ["pool", "concierge", "parking"],
    images: ["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=640"],
    description: "Fully furnished 2BR with marina view, mid-floor, ready to move.",
    agent_name: "Omar Hassan",
    agent_phone: "+971509876543",
    source_url: "https://www.propertyfinder.ae/"
  },
  {
    source: "seed",
    external_id: "rent-reem-2br-01",
    transaction_type: "rent",
    property_type: "apartment",
    beds: 2,
    baths: 2,
    emirate: "Abu Dhabi",
    community: "Reem Island",
    price_aed: 95000,
    price_period: "yearly",
    furnished: false,
    images: ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=640"],
    agent_name: "Fatima Al Ketbi",
    agent_phone: "+971521112233",
    source_url: "https://www.bayut.com/"
  },
  {
    source: "seed",
    external_id: "rent-sharjah-3br-01",
    transaction_type: "rent",
    property_type: "apartment",
    beds: 3,
    baths: 2,
    emirate: "Sharjah",
    community: "Al Majaz",
    price_aed: 55000,
    price_period: "yearly",
    furnished: false,
    images: ["https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=640"],
    agent_name: "Rajesh Kumar",
    agent_phone: "+971541234567",
    source_url: "https://www.dubizzle.com/"
  },
  {
    source: "seed",
    external_id: "sale-dhills-3br-01",
    transaction_type: "sale",
    property_type: "apartment",
    beds: 3,
    baths: 3,
    emirate: "Dubai",
    community: "Dubai Hills",
    price_aed: 3200000,
    price_period: "total",
    furnished: false,
    images: ["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=640"],
    agent_name: "James Wilson",
    agent_phone: "+971551234567",
    source_url: "https://www.propertyfinder.ae/"
  },
  {
    source: "seed",
    external_id: "offplan-emaar-1br-01",
    transaction_type: "off_plan",
    property_type: "apartment",
    beds: 1,
    baths: 1,
    emirate: "Dubai",
    community: "Dubai Creek Harbour",
    price_aed: 1450000,
    price_period: "total",
    handover_date: "2028-Q2",
    payment_plan: "60/40 during construction",
    developer: "Emaar",
    furnished: false,
    images: ["https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=640"],
    agent_name: "Emaar Sales",
    agent_phone: "+97180036227",
    source_url: "https://www.emaar.com/"
  },
  {
    source: "seed",
    external_id: "offplan-damac-2br-01",
    transaction_type: "off_plan",
    property_type: "apartment",
    beds: 2,
    baths: 2,
    emirate: "Dubai",
    community: "Business Bay",
    price_aed: 2100000,
    handover_date: "2027-Q4",
    payment_plan: "70/30",
    developer: "Damac",
    images: ["https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=640"],
    agent_name: "Damac Sales Desk",
    agent_phone: "+97144443522",
    source_url: "https://www.damacproperties.com/"
  },
  {
    source: "seed",
    external_id: "rent-ajman-1br-01",
    transaction_type: "rent",
    property_type: "apartment",
    beds: 1,
    baths: 1,
    emirate: "Ajman",
    community: "Al Nuaimiya",
    price_aed: 28000,
    price_period: "yearly",
    furnished: false,
    images: ["https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=640"],
    agent_name: "Ajman Homes",
    agent_phone: "+97167456789",
    source_url: "https://www.bayut.com/"
  },
  {
    source: "seed",
    external_id: "rent-rak-2br-01",
    transaction_type: "rent",
    property_type: "apartment",
    beds: 2,
    baths: 2,
    emirate: "Ras Al Khaimah",
    community: "Al Hamra",
    price_aed: 48000,
    price_period: "yearly",
    furnished: true,
    images: ["https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=640"],
    agent_name: "RAK Properties Agent",
    agent_phone: "+971722334455",
    source_url: "https://www.propertyfinder.ae/"
  }
];

async function main() {
  const { db } = openHubDb();

  let k = 0;
  for (const doc of KNOWLEDGE) {
    upsertKnowledge(db, doc);
    k++;
  }

  if (skipDemoListings) {
    console.log(
      JSON.stringify({
        ok: true,
        knowledgeDocs: k,
        listings: 0,
        activeListings: countActiveListings(db),
        supabase: isSupabaseEnabled(),
        supabaseSynced: 0,
        skippedDemoListings: true,
        reason: isZeroCostMode() ? "zero_cost_mode" : "JAB_RE_NO_DEMO_LISTINGS"
      })
    );
    return;
  }

  let l = 0;
  let supabaseSynced = 0;
  for (const row of LISTINGS) {
    const listing = upsertListing(db, row);
    l++;
    if (isSupabaseEnabled()) {
      await syncListingToSupabase(listing);
      supabaseSynced++;
    }
  }

  for (const row of generateExpandedSeedListings()) {
    const listing = upsertListing(db, row);
    l++;
    if (isSupabaseEnabled()) {
      await syncListingToSupabase(listing);
      supabaseSynced++;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    knowledgeDocs: k,
    listings: l,
    activeListings: countActiveListings(db),
    supabase: isSupabaseEnabled(),
    supabaseSynced
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
