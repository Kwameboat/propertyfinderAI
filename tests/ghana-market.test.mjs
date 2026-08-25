import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { clusterKey, groupListingsByCluster } from "../packages/real-estate/cluster.mjs";
import { normalizeGhanaPhone } from "../packages/real-estate/qualification.mjs";
import { parseAgentPinMessage } from "../packages/real-estate/ghana-viewing.mjs";
import { hashPin, generateViewingPin, createViewing, markViewingPaid, redeemViewingPin, listViewingLedger, createDeal } from "../packages/hub-db/ghana-viewing.mjs";
import { migrateRealEstate, upsertListing, searchListings } from "../packages/hub-db/real-estate.mjs";
import { migrateGhanaViewing } from "../packages/hub-db/ghana-viewing.mjs";
import { pullGhanaListingsForChat } from "../packages/real-estate/ghana-search.mjs";
import { resolveEmirateScope } from "../packages/real-estate/emirate-scope.mjs";
import { GHANA_SEED_LISTINGS } from "../packages/real-estate/data/seed-ghana-listings.mjs";

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

test("Ghana phones normalize to +233", () => {
  assert.equal(normalizeGhanaPhone("0244111222"), "+233244111222");
  assert.equal(normalizeGhanaPhone("+233244111222"), "+233244111222");
});

test("same physical unit clusters across portals", () => {
  const a = {
    source: "meqasa",
    emirate: "Accra",
    community: "East Legon",
    property_type: "self-contain",
    beds: 1,
    price_aed: 1800
  };
  const b = {
    source: "jiji",
    emirate: "Accra",
    community: "East Legon",
    property_type: "self-contain",
    beds: 1,
    price_aed: 1850
  };
  const c = {
    source: "ghanapropertycentre",
    emirate: "Accra",
    community: "East Legon",
    property_type: "self-contain",
    beds: 1,
    price_aed: 1750
  };
  assert.equal(clusterKey(a), clusterKey(b));
  assert.equal(clusterKey(a), clusterKey(c));
  const grouped = groupListingsByCluster([
    { ...a, id: "1" },
    { ...b, id: "2" },
    { ...c, id: "3" }
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].offers.length, 3);
});

test("different areas do not cluster", () => {
  const a = { emirate: "Accra", community: "East Legon", beds: 1, price_aed: 1800, property_type: "self-contain" };
  const b = { emirate: "Accra", community: "Osu", beds: 1, price_aed: 1800, property_type: "self-contain" };
  assert.notEqual(clusterKey(a), clusterKey(b));
});

test("PIN parse from agent WhatsApp text", () => {
  const parsed = parseAgentPinMessage("PIN 482910 my momo is 0244111222");
  assert.equal(parsed.pin, "482910");
  assert.equal(parsed.momo, "0244111222");
});

test("PIN hash is bound to viewing id", () => {
  const pin = generateViewingPin();
  assert.match(pin, /^\d{6}$/);
  assert.notEqual(hashPin(pin, "view-a"), hashPin(pin, "view-b"));
});

test("Ghana scope uses Accra from East Legon, not Dubai", async () => {
  await withMarket("GH", () => {
    const scoped = resolveEmirateScope({}, { currentMessage: "self-contain in East Legon" });
    assert.equal(scoped.emirate, "Accra");
    const empty = resolveEmirateScope({}, { currentMessage: "I need a room" });
    assert.equal(empty.emirate, "");
  });
});

test("UAE scope still defaults to Dubai", async () => {
  await withMarket("AE", () => {
    const scoped = resolveEmirateScope({}, { currentMessage: "show me 2 beds" });
    assert.equal(scoped.emirate, "Dubai");
  });
});

test("viewing fee ledger splits 50/50 then PIN releases agent hold", () => {
  const db = new DatabaseSync(":memory:");
  migrateGhanaViewing(db);
  const viewing = createViewing(db, { renter_phone: "+233244000111", renter_name: "Ama" });
  const pin = generateViewingPin();
  markViewingPaid(db, { viewingId: viewing.id, pin, platformShareGhs: 50, agentShareGhs: 50 });
  const paidLedger = listViewingLedger(db, viewing.id);
  assert.equal(paidLedger.length, 2);
  assert.equal(paidLedger.find((r) => r.kind === "viewing_fee_platform").status, "settled");
  assert.equal(paidLedger.find((r) => r.kind === "viewing_fee_agent_hold").status, "held");

  const done = redeemViewingPin(db, { pin, momo: "0244111222" });
  assert.equal(done.status, "completed");
  assert.equal(done.agent_momo, "0244111222");
  const after = listViewingLedger(db, viewing.id);
  assert.equal(after.find((r) => r.kind === "viewing_fee_agent_hold").status, "ready_to_payout");

  const deal = createDeal(db, { viewingId: viewing.id, agreedAmountGhs: 1800 });
  assert.equal(deal.commission_ghs, 180);
  assert.equal(deal.platform_share_ghs, 90);
  assert.equal(deal.agent_share_ghs, 90);
});

test("Ghana search clusters East Legon seed offers into one card", async () => {
  await withMarket("GH", async () => {
    const db = new DatabaseSync(":memory:");
    migrateRealEstate(db);
    migrateGhanaViewing(db);
    for (const row of GHANA_SEED_LISTINGS) {
      upsertListing(db, row);
    }
    const found = searchListings(db, { transaction_type: "rent", emirate: "Accra", include_seed: true }, 20);
    assert.ok(found.length >= 4);
    const pull = await pullGhanaListingsForChat(db, { emirate: "Accra", community: "East Legon", transaction_type: "rent" }, { limit: 8 });
    const east = pull.listings.filter((l) => l.community === "East Legon");
    assert.equal(east.length, 1);
    assert.equal(east[0].other_agent_count, 2);
  });
});
