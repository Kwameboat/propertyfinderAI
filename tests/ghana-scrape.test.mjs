import test from "node:test";
import assert from "node:assert/strict";
import { parseGpcSearchHtml } from "../packages/real-estate/scrapers/ghanapropertycentre-html.mjs";
import { getN8nIngestSources, getScrapeEmirates } from "../packages/real-estate/mode.mjs";
import { GHANA_PORTALS } from "../packages/real-estate/market.mjs";
import { INGEST_SOURCES } from "../packages/real-estate/scrape-runner.mjs";

const GPC_FIXTURE = `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","numberOfItems":2,"itemListElement":[
  {"@type":"ListItem","position":1,"url":"https://ghanapropertycentre.com/for-rent/flats-apartments/self-contained/greater-accra/east-legon/49637-luxury-1-bedroom-furnished","name":"Luxury 1 Bedroom Furnished","image":"https://images.ghanapropertycentre.com/properties/images/49637/photo.jpeg","offers":{"@type":"Offer","price":1800,"priceCurrency":"GHS"}},
  {"@type":"ListItem","position":2,"url":"https://ghanapropertycentre.com/for-rent/houses/greater-accra/osu/67439-executive-4-bedroom","name":"Executive 4 Bedroom","image":"https://images.ghanapropertycentre.com/properties/images/67439/photo.webp","offers":{"@type":"Offer","price":15000,"priceCurrency":"GHS"}}
]}</script>
`;

test("GPC JSON-LD search HTML parses priced Ghana rentals", () => {
  const rows = parseGpcSearchHtml(GPC_FIXTURE, { city: "Accra", transactionType: "rent" });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "ghanapropertycentre");
  assert.equal(rows[0].emirate, "Accra");
  assert.equal(rows[0].community, "East Legon");
  assert.equal(rows[0].property_type, "self-contain");
  assert.equal(rows[0].beds, 1);
  assert.equal(rows[0].price_aed, 1800);
  assert.equal(rows[1].community, "Osu");
  assert.equal(rows[1].beds, 4);
});

test("Ghana ingest sources are the Ghana portals", async () => {
  const prev = process.env.JAB_RE_MARKET;
  process.env.JAB_RE_MARKET = "GH";
  delete process.env.JAB_RE_N8N_SOURCES;
  try {
    assert.deepEqual(getN8nIngestSources(), [...GHANA_PORTALS]);
    assert.deepEqual(getScrapeEmirates(), ["Accra", "Kumasi", "Tema"]);
    for (const source of GHANA_PORTALS) {
      assert.ok(INGEST_SOURCES.includes(source), source);
    }
  } finally {
    if (prev == null) delete process.env.JAB_RE_MARKET;
    else process.env.JAB_RE_MARKET = prev;
  }
});
