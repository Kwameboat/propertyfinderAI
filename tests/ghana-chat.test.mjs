import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { classifyIntent, userAskingAboutProperty } from "../packages/real-estate/intent.mjs";
import { classifyChatTurn } from "../packages/real-estate/chat-turn.mjs";
import { buildRealEstateSystemPrompt } from "../packages/real-estate/prompt.mjs";
import {
  userWantsGhanaRentFinance,
  retrieveGhanaKnowledge,
  GHANA_RENT_MONTHLY_PARTNERS,
  ghanaAgentSystemPrompt
} from "../packages/real-estate/ghana-knowledge.mjs";
import { formatGhanaLiveFactsBlock, buildGhanaInventoryChart } from "../packages/real-estate/ghana-live-facts.mjs";
import { retrieveKnowledge } from "../packages/real-estate/rag.mjs";
import { migrateRealEstate, upsertListing } from "../packages/hub-db/real-estate.mjs";
import { GHANA_SEED_LISTINGS } from "../packages/real-estate/data/seed-ghana-listings.mjs";
import { buildGhanaLiveFacts } from "../packages/real-estate/ghana-live-facts.mjs";

function withMarket(code, fn) {
  const prev = process.env.JAB_RE_MARKET;
  process.env.JAB_RE_MARKET = code;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev == null) delete process.env.JAB_RE_MARKET;
      else process.env.JAB_RE_MARKET = prev;
    });
}

test("rent-advance questions match Ghana finance intent", () => {
  assert.equal(userWantsGhanaRentFinance("I can't pay 2 years advance, who can pay my rent monthly?"), true);
  assert.equal(userWantsGhanaRentFinance("Tell me about NRAS"), true);
  assert.equal(userWantsGhanaRentFinance("show me self-contain in East Legon"), false);
});

test("Ghana knowledge retrieval includes NRAS partners", () => {
  const docs = retrieveGhanaKnowledge("who pays my rent advance so I pay monthly", { rentFinance: true });
  const blob = docs.map((d) => d.body).join(" ");
  assert.match(blob, /National Rental Assistance Scheme/);
  assert.match(blob, /nras\.gov\.gh/);
  assert.match(blob, /Rent Masters/);
  assert.ok(GHANA_RENT_MONTHLY_PARTNERS.some((p) => p.id === "nras"));
  assert.ok(GHANA_RENT_MONTHLY_PARTNERS.every((p) => /^https:\/\//.test(p.url)));
});

test("Ghana rent-level questions use market mode, not a listing dump", async () => {
  await withMarket("GH", () => {
    const msg = "What does a self-contain in East Legon usually cost per month?";
    assert.equal(classifyIntent(msg), "market");
    const turn = classifyChatTurn(msg, {}, {});
    assert.equal(turn.answerMode, "market");
    assert.equal(turn.shouldSearch, false);
  });
});

test("Ghana classifyIntent treats rent finance as process, not a listing dump", async () => {
  await withMarket("GH", () => {
    const intent = classifyIntent("I can't afford two years rent advance. Which company pays the landlord?");
    assert.equal(intent, "process");
    const turn = classifyChatTurn("I can't pay 2 years rent advance. Who pays monthly?", {}, {});
    assert.equal(turn.answerMode, "rent_finance");
    assert.equal(turn.shouldSearch, false);
    assert.equal(userAskingAboutProperty("I can't pay 2 years rent advance"), false);
  });
});

test("Ghana system prompt is GH₵ and names real partners, not UAE rules", async () => {
  await withMarket("GH", () => {
    const prompt = buildRealEstateSystemPrompt({
      userMessage: "Who can pay my rent monthly?",
      answerMode: "rent_finance",
      knowledgeBlock: "NRAS https://www.nras.gov.gh/"
    });
    assert.match(prompt, /FIE AI/);
    assert.match(prompt, /GH₵/);
    assert.match(prompt, /NRAS/);
    assert.doesNotMatch(prompt, /RERA-aware/);
    assert.doesNotMatch(prompt, /Proactively mention cheques/);
    assert.doesNotMatch(prompt, /get name \+ UAE mobile/);
    assert.match(ghanaAgentSystemPrompt(), /Rent Act/);
  });
});

test("UAE prompt is unchanged when market is AE", async () => {
  await withMarket("AE", () => {
    const prompt = buildRealEstateSystemPrompt({ userMessage: "Ejari please", answerMode: "faq" });
    assert.match(prompt, /Dar Concierge/);
    assert.match(prompt, /Ejari/);
    assert.equal(classifyIntent("I can't pay 2 years rent advance"), "general");
  });
});

test("Ghana RAG uses in-memory Ghana docs not UAE RERA", async () => {
  await withMarket("GH", () => {
    const db = new DatabaseSync(":memory:");
    migrateRealEstate(db);
    const docs = retrieveKnowledge(db, { query: "NRAS rent advance monthly", intent: "process", rentFinance: true });
    assert.ok(docs.some((d) => /NRAS|Rental Assistance/i.test(`${d.title} ${d.body}`)));
  });
});

test("live Ghana facts cite inventory medians and never invent companies", async () => {
  await withMarket("GH", async () => {
    const db = new DatabaseSync(":memory:");
    migrateRealEstate(db);
    for (const row of GHANA_SEED_LISTINGS) upsertListing(db, row);
    const facts = await buildGhanaLiveFacts(db, {
      criteria: { emirate: "Accra", community: "East Legon", transaction_type: "rent" },
      message: "what is rent like in East Legon?"
    });
    assert.ok(facts.match.sample >= 1);
    const block = formatGhanaLiveFactsBlock(facts);
    assert.match(block, /LIVE GHANA INVENTORY/);
    assert.match(block, /East Legon|Accra/);
    const chart = buildGhanaInventoryChart(facts);
    if (chart) {
      assert.equal(chart.unit, "GH₵/mo");
      assert.ok(chart.bars.length >= 1);
    }

    upsertListing(db, {
      ...GHANA_SEED_LISTINGS[0],
      source: "ghanapropertycentre",
      external_id: "yearly-mislabel-el",
      source_url: "https://ghanapropertycentre.com/for-rent/self-contain-test",
      property_type: "self-contain",
      beds: 1,
      price_aed: 22200,
      price_period: "monthly",
      transaction_type: "rent"
    });
    const selfFacts = await buildGhanaLiveFacts(db, {
      criteria: {
        emirate: "Accra",
        community: "East Legon",
        transaction_type: "rent",
        property_type: "self-contain",
        beds: 1
      },
      message: "What does a self-contain in East Legon usually cost per month?"
    });
    assert.ok(selfFacts.match.median != null);
    assert.ok(selfFacts.match.median < 8000, `self-contain median should be monthly not yearly, got ${selfFacts.match.median}`);
    assert.match(formatGhanaLiveFactsBlock(selfFacts), /self-contain/);
  });
});
