/**
 * Seed Princess Travel Consult persona + live deals board.
 * Run: node scripts/seed-princess-travel.mjs
 */
import {
  openHubDb,
  upsertClient,
  updateClientSettings,
  setClientDeals,
  getClient,
  listClientDeals,
  ensureWallet,
  applyWalletDelta
} from "../packages/hub-db/index.mjs";

const INSTANCE = "Princess Travel Consult";
const ADMIN_PHONE = "233599915630";

const PERSONA = `You chat as Afia from Princess Travel Consult on WhatsApp — a real Ghana recruitment/travel agent helping people with overseas job & travel packages.

Sound like a human on WhatsApp, NOT an AI or call-centre script:
- Short replies. Usually 1–3 short lines. Sometimes just one line.
- Casual Ghana WhatsApp English is fine (bro, pls, okay oo, etc.) — stay polite.
- One question at a time. Never dump a checklist of questions.
- No numbered steps, no bullet lists, no “Option 1/2/3”, no “I can help you with…”, no “How can I assist you today”.
- Don’t introduce yourself every time. Don’t say you’re an AI/assistant/bot.
- Mirror their energy. If they say “hi”, reply short. If they ask about Dubai, talk Dubai — don’t recite the whole country list unless they ask “what do you have”.
- Share deal info conversationally (“for security in Dubai it’s about 1200 AED first 3 months, then 1600…”) not as a formal brochure.
- Emoji: rare, max one if it fits. No spam.
- When they’re ready to apply/pay/talk to office, quietly end with [HANDOFF] (they must not see/notice that token).

Facts only from CURRENT LIVE DEALS. Never invent jobs, salaries, fees, or visas. Never promise approval or departure dates. Don’t ask for passport/Ghana Card photos in chat.`;

const DEALS = [
  {
    title: "Dubai — Direct employment (all job types)",
    destination: "Dubai / UAE",
    salary: "From 1,200 AED (role-dependent)",
    fee: "Varies by role; some roles list service charge payable after visa approval",
    requirements: "Valid passport (often 6+ months), passport photo, Ghana Card / National ID where required",
    benefits: "Role-dependent; many packages include accommodation/transport/medical",
    notes: "Direct employment packages. Confirm exact role before quoting fees."
  },
  {
    title: "Dubai — Security Guards",
    destination: "Dubai, UAE",
    salary: "1,200 AED (months 1–3), then 1,600 AED",
    fee: "Service charge 20,000 GHS — pay after visa approval (agency-stated)",
    requirements: "Passport (min 6 months), passport photo (white background), National ID / Ghana Card. All nationalities can apply.",
    benefits: "Accommodation, transportation, medical insurance, weekly off",
    notes: "100% direct employment; Same Day MOL / deployment timing is agency-stated, not guaranteed."
  },
  {
    title: "UAE — Warehouse Packing Work",
    destination: "UAE",
    salary: "2,000 AED",
    fee: "Confirm with consultant",
    requirements: "Able to pack/label/sort; follow warehouse procedures",
    benefits: "Accommodation, transportation, medical, friendly work culture",
    notes: "Duties: packing, labeling, sorting, keeping warehouse clean/safe."
  },
  {
    title: "UAE — Female Cleaners",
    destination: "UAE",
    salary: "1,400 AED total (1,200 basic + 200 bonus)",
    fee: "Confirm with consultant",
    requirements: "Female only; age 21–40; physically fit; basic English/Arabic an advantage; cleaning experience preferred; no education certificate required",
    benefits: "Direct employment from home country; free accommodation; visa & insurance provided; on-time salary (agency-stated)",
    notes: "Immediate departure / limited slots are marketing claims — confirm availability with consultant."
  },
  {
    title: "UAE — Taxi Drivers (Ajman & Sharjah)",
    destination: "Ajman & Sharjah, UAE",
    salary: "2,500–3,500 AED (commission-based)",
    fee: "Visa & ticket at cool/package price — confirm with consultant",
    requirements: "Valid driving license; experience preferred; from Africa applicants; online interview daily",
    benefits: "Visa provided; ticket provided (agency-stated package)",
    notes: "About 100 positions marketed; immediate departure claims need consultant confirmation."
  },
  {
    title: "UAE — Professional Painters",
    destination: "UAE",
    salary: "1,800 AED",
    fee: "Confirm with consultant",
    requirements: "Experienced professional painters; ~20 positions",
    benefits: "Visa & insurance provided; accommodation provided; monthly salary on time (agency-stated)",
    notes: "Work in UAE — confirm start date with consultant."
  },
  {
    title: "Armenia (Europe) — Hotel/Restaurant/Construction/Factory roles",
    destination: "Armenia (Europe)",
    salary: "7,000–10,000 GHS (depends on position; agency-stated)",
    fee: "Confirm with consultant",
    requirements: "Passport; passport picture; serious applicants only",
    benefits: "Roles: Hotel Cleaners, Restaurant Cleaners/Dishwashers, Construction Helpers, Factory Workers",
    notes: "Processing time marketed as 2–4 weeks — not a guarantee."
  },
  {
    title: "Saudi Arabia — Bus & Van Drivers",
    destination: "Saudi Arabia",
    salary: "1,400 SR / month",
    fee: "Confirm with consultant",
    requirements: "Drivers for bus and van roles; ready for deployment",
    benefits: "Competitive benefits; accommodation provided (agency-stated)",
    notes: "Immediate deployment marketing — confirm with consultant."
  },
  {
    title: "Schengen — European visa package",
    destination: "Schengen / Europe",
    salary: "N/A (visa assist)",
    fee: "Confirm with consultant",
    requirements: "Passport and supporting docs as advised by consultant",
    benefits: "European visa assistance package",
    notes: "Visa outcome is never guaranteed."
  },
  {
    title: "Brazil — Visit + job assistance (expo / beauty fair 2026 packages)",
    destination: "Brazil",
    salary: "Job assistance after visit (agency package)",
    fee: "Deposit involved — confirm amount with consultant before paying",
    requirements: "Passport data page, birth certificate, Ghana Card (front & back), police report, passport-size picture, signature, visa fee receipt",
    benefits: "Visit packages tied to events such as Inter Expo 2026 Agricultural Exhibition (29 Aug–6 Sep 2026) and Beauty Fair International 2026 (5–8 Sep 2026)",
    notes: "Deposit required. Confirm event fit and fees with consultant."
  },
  {
    title: "Russia — Visit to job on arrival",
    destination: "Russia",
    salary: "From 1,000 USD (agency-stated)",
    fee: "Confirm with consultant",
    requirements: "Passport and docs as advised",
    benefits: "Visit-to-job-on-arrival package",
    notes: "Job-on-arrival is not a guarantee."
  },
  {
    title: "China — Visit visa to job assistance",
    destination: "China",
    salary: "Confirm with consultant",
    fee: "Confirm with consultant",
    requirements: "Passport and docs as advised",
    benefits: "Visit visa + job assistance package",
    notes: "Outcomes not guaranteed."
  },
  {
    title: "Germany — Working visa",
    destination: "Germany",
    salary: "From 1,100 EUR (agency-stated)",
    fee: "Confirm with consultant",
    requirements: "Passport and docs as advised for working visa",
    benefits: "Working visa package",
    notes: "Visa/job outcomes not guaranteed."
  },
  {
    title: "Japan — Visit to job on arrival",
    destination: "Japan",
    salary: "From 1,000 USD (agency-stated)",
    fee: "Confirm with consultant",
    requirements: "Passport and docs as advised",
    benefits: "Visit-to-job-on-arrival package",
    notes: "Job-on-arrival is not a guarantee."
  },
  {
    title: "Malaysia — Visit visa to job on arrival",
    destination: "Malaysia",
    salary: "From 8,000 GHS (agency-stated)",
    fee: "Confirm with consultant",
    requirements: "Passport and docs as advised",
    benefits: "Visit-to-job-on-arrival package",
    notes: "Job-on-arrival is not a guarantee."
  },
  {
    title: "Mexico — Visa and job assistance",
    destination: "Mexico",
    salary: "Confirm with consultant",
    fee: "Confirm with consultant",
    requirements: "Passport and docs as advised",
    benefits: "Visa + job assistance package",
    notes: "Outcomes not guaranteed."
  },
  {
    title: "Albania — Job on arrival",
    destination: "Albania",
    salary: "Confirm with consultant",
    fee: "Confirm with consultant",
    requirements: "Passport and docs as advised",
    benefits: "Job-on-arrival package",
    notes: "Job-on-arrival is not a guarantee."
  },
  {
    title: "Turkey — Visit to work on arrival",
    destination: "Turkey",
    salary: "From 700 USD (agency-stated)",
    fee: "Confirm with consultant",
    requirements: "Passport and docs as advised",
    benefits: "Visit-to-work-on-arrival package",
    notes: "Work-on-arrival is not a guarantee."
  },
  {
    title: "Female Electric Bike Delivery",
    destination: "Confirm location with consultant (local / special offer)",
    salary: "2,000–3,500 range; 3.5 per delivery (confirm currency/location)",
    fee: "Agency flyer states no agents / no fees — confirm",
    requirements: "Female only; valid ID; Android smartphone; good local-area knowledge; responsible & reliable",
    benefits: "Electric bike provided; flexible hours; direct employment claims on flyer",
    notes: "Confirm whether this is local Ghana or overseas before pitching as international."
  }
];

const { db } = openHubDb();
upsertClient(db, {
  instanceName: INSTANCE,
  displayName: "Princess Travel Consult",
  status: "open"
});
updateClientSettings(db, INSTANCE, {
  displayName: "Princess Travel Consult",
  storeTagline: "International recruitment & travel-assist packages",
  contactPhone: ADMIN_PHONE,
  whatsappOrderNumber: ADMIN_PHONE,
  adminPhones: ADMIN_PHONE,
  systemPrompt: PERSONA,
  handoffKeywords:
    "human,agent,speak to someone,talk to someone,call me,representative,consultant,office,apply now,i want to apply,ready to pay"
});
setClientDeals(db, INSTANCE, DEALS);

const wallet = ensureWallet(db, INSTANCE);
if ((wallet.balance_points || 0) < 200) {
  applyWalletDelta(db, {
    instanceName: INSTANCE,
    direction: "credit",
    amount: 500,
    reason: "seed_bonus",
    note: "Princess Travel Consult setup bonus"
  });
}

const client = getClient(db, INSTANCE);
const deals = listClientDeals(db, INSTANCE);
console.log(
  JSON.stringify(
    {
      ok: true,
      instance: client.instance_name,
      admin_phones: client.admin_phones,
      promptChars: String(client.system_prompt || "").length,
      deals: deals.length,
      sample: deals.slice(0, 3).map((d) => `#${d.id} ${d.title}`)
    },
    null,
    2
  )
);
