/**
 * Knowledge retrieval for UAE real estate concierge.
 */

import { searchKnowledge } from "../hub-db/real-estate.mjs";

export function formatKnowledgeBlockForPrompt(docs = []) {
  if (!docs.length) {
    return "KNOWLEDGE BASE: no matching docs — use general UAE property knowledge carefully and suggest verifying with RERA/DLD.";
  }
  const blocks = docs.map(
    (d) => `### ${d.title} (${d.category})\n${String(d.body || "").slice(0, 1800)}`
  );
  return ["KNOWLEDGE BASE (trusted reference — prefer over guessing):", ...blocks].join("\n\n");
}

export function retrieveKnowledge(db, { query = "", intent = "general", limit = 6 } = {}) {
  const intentTags = {
    faq: "faq renting ejari rera",
    move_in: "move in dewa ejari checklist",
    process: "buy sell mortgage expat dld",
    off_plan: "off plan oqood handover payment plan",
    market: "market trend rent prices dubai abu dhabi investment yield statistics",
    news: "uae real estate news regulation rera dld",
    area_guide: query,
    general: query
  };
  const q = [query, intentTags[intent] || ""].filter(Boolean).join(" ");
  return searchKnowledge(db, q, limit);
}
