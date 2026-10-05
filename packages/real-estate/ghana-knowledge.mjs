/**
 * Curated Ghana real-estate facts for FIE AI chat.
 * Partners and legal notes are from public sources — never invent extra firms.
 */

export const GHANA_RENT_MONTHLY_PARTNERS = [
  {
    id: "nras",
    name: "National Rental Assistance Scheme (NRAS)",
    kind: "Government scheme",
    summary:
      "Government programme: NRAS pays your rent advance straight to the landlord. You repay NRAS in monthly instalments, due on the 1st.",
    url: "https://www.nras.gov.gh/",
    howUrl: "https://www.nras.gov.gh/how-it-works",
    phone: "055 134 1515 / 020 908 9388",
    email: "info@nrasgh.com",
    notes:
      "Bring 3 months payslips, 3 months bank or MoMo statements (or audited accounts if you run a business), 2 IDs, and a GH₵100 application fee. Decision in 5–10 business days. As of Jan 2026 the scheme had helped about 4,732 people and was running in Greater Accra, Ashanti, Eastern, Western, Northern and Bono East, with plans to expand nationwide."
  },
  {
    id: "rent-masters",
    name: "Rent Masters Ghana",
    kind: "Private rent-advance financier",
    summary:
      "Pays the landlord the advance; you pay Rent Masters monthly (due on the 1st). You can bring a room you already found.",
    url: "https://www.rent-masters.com/",
    howUrl: "https://rent-masters.com/how-it-works",
    phone: "020 770 5339 / 055 923 4771",
    email: "info@rent-masters.com",
    notes:
      "9 Osu Badu Avenue, Accra (GA-156-3713). Same style of docs as NRAS: 3 months payslips, 3 months bank/MoMo statements or audited accounts, 2 IDs, GH₵100 processing fee, 5–10 business days."
  },
  {
    id: "renmo",
    name: "Renmo",
    kind: "Private rent-advance financier",
    summary:
      "They pay your landlord the lump sum today; you repay Renmo monthly. They say 0% interest on rent. You can bring an existing landlord.",
    url: "https://listings.renmo.homes/",
    phone: "",
    email: "",
    notes: "Apply in the browser or via their WhatsApp Coach. Soft credit check. Confirm current terms on their site before you commit."
  },
  {
    id: "archierent",
    name: "ArchieRent",
    kind: "Private rent-advance financier",
    summary:
      "Pre-finances rent: they pay the landlord, you repay ArchieRent monthly. You can find the house yourself or ask them to help.",
    url: "https://archielands.com/ArchieRent/index.php",
    phone: "+233 303 943 716",
    email: "info@archielands.com",
    notes:
      "Haatso Atomic Road, opposite Fidelity Bank, Accra. Also listed: 030 252 6766. They say approval in about 7 working days, one-time process fee, and they typically want a salaried worker with a company consent letter."
  },
  {
    id: "rentbrig",
    name: "RENTBRiG",
    kind: "Monthly-pay rentals (managed homes)",
    summary:
      "Greater Accra and Tema monthly rentals — pay as you go rather than 1–2 years advance. Some homes are furnished with utilities. This is their own stock / managed lets, not a scheme that finances any private landlord.",
    url: "https://www.rentbrig.com/",
    phone: "",
    email: "",
    notes: "Also lists corporate housing for organisations. Confirm availability and deposit on their site."
  }
];

export const GHANA_KNOWLEDGE_DOCS = [
  {
    slug: "rent-monthly-partners",
    title: "Companies that pay rent advance so you pay monthly",
    category: "rent_finance",
    tags: "nras rent masters renmo archierent rentbrig monthly advance pay as you go cannot afford two years",
    body: [
      "In Ghana many landlords still ask for 6–24 months rent up front even though the Rent Act caps legal advance at six months for longer tenancies. If the client cannot raise that lump sum, send them to real partners — never invent a company.",
      "",
      ...GHANA_RENT_MONTHLY_PARTNERS.map((p) => {
        const contact = [p.phone, p.email].filter(Boolean).join(" · ");
        return `- ${p.name} (${p.kind}): ${p.summary} ${p.notes} Link: ${p.url}${contact ? ` · ${contact}` : ""}`;
      }),
      "",
      "Tell them FIE AI is not NRAS or these firms. We find the room; they apply with the partner. Eligibility is the partner's call (income proof, IDs, sometimes a processing fee). Do not promise approval."
    ].join("\n")
  },
  {
    slug: "rent-advance-law",
    title: "Rent advance: law vs what landlords actually ask",
    category: "faq",
    tags: "rent control act 220 six months advance two years illegal mahama",
    body: [
      "Practice: Accra landlords commonly ask 1–2 years (sometimes more) before you get the keys. That is the pain clients mean when they say they cannot rent.",
      "Law: Rent Act, 1963 (Act 220) as amended by PNDCL 5, section 25(5) — a landlord must not collect more than 6 months advance for a tenancy longer than 6 months, or more than 2 months for a shorter tenancy.",
      "Enforcement: Rent Control (Acting Commissioner Frederick Opoku) said from 1 April 2026 they will prosecute over-advance demands. President Mahama has also told tenants to report landlords asking more than six months. Penalties reported in the press: fine and/or imprisonment under the Act — quote the Act, not a made-up cedi figure.",
      "Advise: get a written tenancy, receipts, and a Rent Card. Report over-advance at the nearest Rent Control office or https://rentcontrol.mwh.gov.gh/. Still, many private lets on the ground have not yet shifted — be honest about that gap, then offer NRAS / Rent Masters / Renmo / ArchieRent / RENTBRiG."
    ].join("\n")
  },
  {
    slug: "fie-viewing",
    title: "FIE AI viewing fee, PIN, and close",
    category: "process",
    tags: "viewing fee pin 100 cedis momo commission 10 percent",
    body: [
      "To book a viewing the client pays GH₵100 first. GH₵50 is the platform fee now; GH₵50 is held for the listing agent until the client visits.",
      "After pay, the client gets a 6-digit PIN on WhatsApp. They give that PIN to the listing agent at the property. The agent confirms on /gh/agent with their MoMo number. Do not tell anyone they can view for free.",
      "If the client takes the room, commission is 10% of the agreed amount, split 50/50 between FIE AI and the listing agent.",
      "Landlords and agents can list rent or sale from the FIE AI app (List your property)."
    ].join("\n")
  },
  {
    slug: "property-types",
    title: "Ghana property types people actually search",
    category: "faq",
    tags: "self-contain chamber and hall compound single room apartment house",
    body: [
      "Self-contain: private room with its own washroom (and often a small kitchenette). The default first home for many young workers in Accra.",
      "Chamber and hall: bedroom plus a sitting hall, often sharing a compound washroom/kitchen unless it is 'self-contained chamber and hall'.",
      "Single room / 'single room self-contain': one room; confirm washroom.",
      "Compound house: several rooms around a courtyard; shared facilities; cheaper; common in older Accra neighbourhoods.",
      "Apartment / flat: self-contained unit in a block, typical in East Legon, Airport, Cantonments, Spintex.",
      "House / 'self compound': a whole house, sometimes with a small yard. Townhouses and gated estates around East Legon, Airport Hills, Trasacco, Community 25.",
      "Sale listings are quoted as a total price in GH₵, not AED. Rent is quoted per month, but the cash you need on day one is usually months of advance."
    ].join("\n")
  },
  {
    slug: "accra-areas",
    title: "Accra areas — how a local agent talks about them",
    category: "area_guide",
    tags: "east legon osu spintex labone cantonments airport adenta achimota dansoman",
    body: [
      "East Legon: prime rental belt — self-contains, apartments, townhouses. Close to American House, Oxford Street-east, restaurants. Prices sit above Accra average. Watch traffic on the Legon / Tetteh Quarshie side.",
      "Airport Residential / Airport Hills / Cantonments / Labone: diplomatic and expat belt. Higher rents, quieter streets, easier generator/security packages.",
      "Osu: city life, Oxford Street, walkable food and nightlife. Mix of older walk-ups and newer apartments. Noise and parking are the honest downsides.",
      "Spintex / Baatsona / Community 25 (Tema side of the Accra–Tema corridor): newer estates, malls, slightly more space for the money than central Accra. Commute into Accra can be heavy.",
      "Adenta / Adjiringanor / Haatso / Kwabenya: family and student-adjacent; more house-and-compound stock; longer trotro/taxi into the CBD.",
      "Achimota / Tesano / Dzorwulu / Roman Ridge / Abelemkpe: mixed residential, good for people working towards North Ridge / airport.",
      "Dansoman / Kaneshie / Weija / McCarthy Hill: west Accra; often better value, longer airport run.",
      "Tema / Sakumono: port city, planned communities. Good if they work Tema or want monthly-pay stock (RENTBRiG covers Tema).",
      "Kumasi (Ahodwo, Nhyiaeso, Asokwa): Ashanti capital — use live listings, do not quote Accra prices.",
      "Always prefer LIVE INVENTORY numbers over these vibe notes when a sample exists."
    ].join("\n")
  },
  {
    slug: "renting-process",
    title: "How renting actually works in Ghana",
    category: "process",
    tags: "inspection tenancy agreement rent card lands commission agent fee",
    body: [
      "1. Agree area, type (self-contain vs chamber and hall vs apartment), monthly rent, and how many months advance the landlord wants.",
      "2. Inspect in person. FIE charges GH₵100 to book that viewing (PIN at the gate).",
      "3. Confirm who owns it — ask for ID, site plan / indenture if buying, and never pay a 'reservation' to a random MoMo without a receipt.",
      "4. Written tenancy: parties, rent, advance paid, duration, who pays ECG/water, notice period. Get a Rent Card.",
      "5. Utilities: ECG prepaid meter is common; Ghana Water may be prepaid or shared. There is no DEWA in Ghana. Data is MTN / Telecel / AT, not Du/Etisalat.",
      "6. Agency fees vary; FIE's close fee is 10% of the agreed amount if they take the room through us.",
      "7. If advance is more than six months, point them to Rent Control and to NRAS / private monthly-pay partners."
    ].join("\n")
  },
  {
    slug: "buying-ghana",
    title: "Buying property in Ghana — keep it grounded",
    category: "process",
    tags: "lands commission indenture plot house sale freehold leasehold",
    body: [
      "Most urban land is stool/skin or state leasehold, not a UAE-style freehold apartment with RERA. Title due diligence at Lands Commission matters more than a pretty listing photo.",
      "Ask for: site plan, indenture or lease, consent if needed, and a lawyer. FIE can show live sale listings (Ghana Property Centre, Jiji, Meqasa, direct FIE listings) but is not a conveyancer.",
      "Quote prices in GH₵ total. Do not talk DLD fees, Ejari, or golden visa."
    ].join("\n")
  },
  {
    slug: "utilities",
    title: "Move-in utilities in Ghana",
    category: "move_in",
    tags: "ecg ghana water prepaid meter generator internet mtn",
    body: [
      "Power: ECG (or NEDCo up-country). Many rentals are prepaid — buy credit after the landlord clears arrears. Ask whether a generator or inverter is shared.",
      "Water: Ghana Water Company; some compounds use poly-tanks and borehole. Confirm who pays.",
      "Internet: fibre (e.g. Surfline/busy areas) or MTN/Telecel router. Not DEWA, not Ejari, not chiller.",
      "Do not invent connection fees. If they need a number, say they should confirm with ECG / Ghana Water for that meter."
    ].join("\n")
  }
];

const FINANCE_RE =
  /\b(?:nras|rent masters|rentmasters|rentbrig|rent ?brig|renmo|archierent|archie rent)\b|pay(?:ing)? (?:my |the )?rent monthly|pay rent as you go|cannot afford (?:the )?(?:rent )?advance|can'?t afford (?:the )?(?:rent )?advance|can'?t pay (?:two|2|one|1) years?(?: rent)?|two years? advance|2 years? advance|rent advance|who (?:can|will) pay (?:my )?rent|company that pays? (?:the )?rent|companies that pay rent|monthly rent payment scheme|pay as you go rent/i;

export function userWantsGhanaRentFinance(text = "") {
  return FINANCE_RE.test(String(text || ""));
}

function scoreDoc(doc, words) {
  const hay = `${doc.title} ${doc.category} ${doc.tags} ${doc.body}`.toLowerCase();
  let score = 0;
  for (const w of words) {
    if (hay.includes(w)) score += 1;
  }
  if (doc.category === "rent_finance" && words.some((w) => /nras|monthly|advance|masters|renmo|archie|brig/.test(w))) {
    score += 8;
  }
  return score;
}

export function retrieveGhanaKnowledge(query = "", { intent = "general", limit = 6, rentFinance = false } = {}) {
  const q = String(query || "").toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  const intentBoost = {
    process: ["process", "viewing", "advance", "finance"],
    faq: ["faq", "advance", "types"],
    move_in: ["utilities", "ecg", "water"],
    area_guide: ["accra", "areas", "east", "osu"],
    market: ["areas", "types"],
    news: ["advance", "law"]
  };
  const extra = intentBoost[intent] || [];
  const scored = GHANA_KNOWLEDGE_DOCS.map((doc) => ({
    doc,
    score: scoreDoc(doc, [...words, ...extra])
  }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const take = (slug) => {
    const row = GHANA_KNOWLEDGE_DOCS.find((d) => d.slug === slug);
    if (row && !picked.some((p) => p.slug === slug)) picked.push(row);
  };

  if (rentFinance || userWantsGhanaRentFinance(query)) {
    take("rent-monthly-partners");
    take("rent-advance-law");
    take("fie-viewing");
  }

  for (const { doc, score } of scored) {
    if (picked.length >= limit) break;
    if (!rentFinance && score <= 0) continue;
    if (!picked.some((p) => p.slug === doc.slug)) picked.push(doc);
  }

  if (!picked.length) {
    take("fie-viewing");
    take("property-types");
    take("renting-process");
  }

  return picked.slice(0, limit).map((d) => ({
    title: d.title,
    category: d.category,
    body: d.body,
    slug: d.slug
  }));
}

export function formatGhanaKnowledgeBlock(docs = []) {
  if (!docs.length) {
    return "KNOWLEDGE BASE: use Ghana live inventory and the rent-monthly partner list. Never use UAE (RERA/Ejari/DEWA) knowledge.";
  }
  const blocks = docs.map((d) => `### ${d.title} (${d.category})\n${String(d.body || "").slice(0, 2200)}`);
  return ["KNOWLEDGE BASE (Ghana — trusted; prefer over guessing):", ...blocks].join("\n\n");
}

export function formatGhanaPartnersForPrompt(partners = GHANA_RENT_MONTHLY_PARTNERS) {
  const lines = partners.map((p, i) => {
    const contact = [p.phone, p.email].filter(Boolean).join(" · ");
    return `${i + 1}. ${p.name} — ${p.kind}\n   ${p.summary}\n   ${p.notes}\n   Link: ${p.url}${contact ? `\n   ${contact}` : ""}`;
  });
  return [
    "RENT-MONTHLY PARTNERS (real companies — name these when they cannot pay 1–2 years advance; include the link; do not invent others):",
    ...lines
  ].join("\n");
}

export function ghanaAgentSystemPrompt() {
  return [
    "You are FIE AI — a professional Ghanaian real estate agent. Accra, Kumasi, Tema, Takoradi, Cape Coast, Tamale are your market. You talk like a sharp agent who actually walks East Legon, Osu, Spintex and Ahodwo: warm, direct, no corporate filler.",
    "You hear voice notes and you reply in the client's language: Ghanaian English, Twi (Akan), Fante, Ewe, Ga, Dagbani, Hausa, or Ghanaian Pidgin — including mixed messages. Do not force Pidgin or Twi unless they used it.",
    "Currency is GH₵ only. Rent is quoted per month; sale is a GH₵ total. Never say AED, emirate, RERA, Ejari, DEWA, chiller, cheques, DLD, or golden visa.",
    "Know the ground: self-contain, chamber and hall, compound house, single room, apartment, house. Landlords often want 1–2 years advance even though the Rent Act caps legal advance at six months for longer tenancies — say both things honestly.",
    "When they ask who can pay the landlord now and collect monthly, use ONLY the attached RENT-MONTHLY PARTNERS. Lead with NRAS (government), then Rent Masters, Renmo, ArchieRent, and RENTBRiG (managed monthly homes). Give the official link. Do not promise they will be approved.",
    "Answer the exact question in the first sentence. Use LIVE INVENTORY FACTS for prices and counts. If the sample is thin, say so — never invent a median or a fake listing.",
    "Viewings: they must pay GH₵100 first. After pay they get a PIN on WhatsApp for the listing agent. If they take the room, 10% of the agreed amount, split 50/50. Do not offer a free viewing.",
    "You are their agent on this chat, not a lawyer, not Lands Commission, not NRAS. If several cards share a cluster, they may be the same unit advertised by different agents — say so briefly."
  ].join(" ");
}
