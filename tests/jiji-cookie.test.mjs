import test from "node:test";
import assert from "node:assert/strict";
import {
  jijiCookieHeader,
  isJijiCookieConfigured,
  jijiFreeAccessAvailable,
  jijiUserAgent
} from "../packages/real-estate/scrapers/jiji-cookie.mjs";
import { jijiScrapeAvailable, ghanaIngestSources } from "../packages/real-estate/ghana-ingest.mjs";
import { rowFromJijiAd } from "../packages/real-estate/scrapers/jiji-html.mjs";

function withEnv(map, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(map)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test("Jiji cookie header builds from clearance", async () => {
  await withEnv(
    {
      JIJI_COOKIE: "",
      JIJI_CF_CLEARANCE: "abc123",
      JIJI_CF_BM: "bm99",
      FLARESOLVERR_URL: "off"
    },
    () => {
      assert.equal(isJijiCookieConfigured(), true);
      assert.equal(jijiCookieHeader(), "cf_clearance=abc123; __cf_bm=bm99");
      assert.equal(jijiFreeAccessAvailable(), true);
      assert.equal(jijiScrapeAvailable(), true);
      assert.ok(ghanaIngestSources().includes("jiji"));
    }
  );
});

test("without cookie or flaresolverr, Jiji is not in default sources", async () => {
  await withEnv(
    {
      JIJI_COOKIE: "",
      JIJI_CF_CLEARANCE: "",
      FLARESOLVERR_URL: "off",
      JAB_FIE_SCRAPE_SOURCES: "",
      JAB_RE_N8N_SOURCES: ""
    },
    () => {
      assert.equal(jijiScrapeAvailable(), false);
      assert.ok(!ghanaIngestSources().includes("jiji"));
    }
  );
});

test("rowFromJijiAd maps archived-shaped advert JSON", () => {
  const row = rowFromJijiAd(
    {
      id: 991122,
      title: "Self contain at East Legon",
      url: "/greater-accra/east-legon/self-contain-991122.html",
      price_obj: { value: 1500, period: "per month" },
      region_name: "East Legon",
      region_parent_name: "Accra",
      attrs: [
        { name: "Bedrooms", value: 1 },
        { name: "Bathrooms", value: 1 }
      ],
      image_url: "https://example.com/a.jpg"
    },
    "Accra",
    "rent",
    "jiji"
  );
  assert.ok(row);
  assert.equal(row.source, "jiji");
  assert.equal(row.price_aed, 1500);
  assert.equal(row.community, "East Legon");
  assert.equal(row.beds, 1);
  assert.ok(jijiUserAgent().includes("Mozilla"));
});
