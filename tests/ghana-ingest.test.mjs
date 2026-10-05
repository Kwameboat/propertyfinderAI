import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGhanaScrapeTicks,
  pickGhanaScrapeTick,
  ghanaIngestSources,
  VERCEL_SAFE_GHANA_SOURCES,
  withClusterId
} from "../packages/real-estate/ghana-ingest.mjs";
import { prepareListing } from "../packages/real-estate/ingest.mjs";

test("Vercel-safe Ghana sources exclude Jiji by default", () => {
  const prev = process.env.FLARESOLVERR_URL;
  const prevSources = process.env.JAB_FIE_SCRAPE_SOURCES;
  delete process.env.FLARESOLVERR_URL;
  delete process.env.JAB_FIE_SCRAPE_SOURCES;
  delete process.env.JAB_RE_N8N_SOURCES;
  try {
    assert.deepEqual(ghanaIngestSources(), [...VERCEL_SAFE_GHANA_SOURCES]);
    assert.ok(!ghanaIngestSources().includes("jiji"));
  } finally {
    if (prev == null) delete process.env.FLARESOLVERR_URL;
    else process.env.FLARESOLVERR_URL = prev;
    if (prevSources == null) delete process.env.JAB_FIE_SCRAPE_SOURCES;
    else process.env.JAB_FIE_SCRAPE_SOURCES = prevSources;
  }
});

test("scrape ticks are one source × city × type", () => {
  const ticks = buildGhanaScrapeTicks({
    sources: ["ghanapropertycentre"],
    cities: ["Accra", "Kumasi"],
    types: ["rent", "sale"],
    maxPages: 1
  });
  assert.equal(ticks.length, 4);
  assert.deepEqual(ticks[0], {
    source: "ghanapropertycentre",
    emirates: ["Accra"],
    types: ["rent"],
    maxPages: 1
  });
  const picked = pickGhanaScrapeTick(ticks, 0);
  assert.equal(picked.source, "ghanapropertycentre");
  assert.equal(picked.tickCount, 4);
});

test("prepareListing attaches cluster_id for Supabase sync", () => {
  const row = prepareListing({
    source: "ghanapropertycentre",
    external_id: "gpc-test-1",
    source_url: "https://example.com/1",
    transaction_type: "rent",
    property_type: "self-contain",
    beds: 1,
    emirate: "Accra",
    community: "East Legon",
    price_aed: 1800
  });
  assert.ok(row);
  assert.ok(row.cluster_id);
  assert.equal(withClusterId(row).cluster_id, row.cluster_id);
});
