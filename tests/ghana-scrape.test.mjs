import test from "node:test";
import assert from "node:assert/strict";
import { parseGpcSearchHtml, parseGpcGalleryHtml, preferFullGpcImages } from "../packages/real-estate/scrapers/ghanapropertycentre-html.mjs";
import { listingNeedsDetailEnrich } from "../packages/real-estate/listing-detail-enrich.mjs";
import { getN8nIngestSources, getScrapeEmirates } from "../packages/real-estate/mode.mjs";
import { GHANA_PORTALS, GHANA_DIRECT_SOURCE, ghanaListingSources } from "../packages/real-estate/market.mjs";
import { INGEST_SOURCES, GHANA_SCRAPE_TYPES } from "../packages/real-estate/scrape-runner.mjs";
import {
  isGpcDetailUrl,
  isGpcSearchUrl,
  gpcLiveSearchUrls
} from "../packages/real-estate/ghana-live-search.mjs";
import { buildLiveSearchQuery } from "../packages/real-estate/live-search-query.mjs";
import { rowFromJijiAd, uniqueJijiCities } from "../packages/real-estate/scrapers/jiji-html.mjs";
import { jsonFromFlareHtml } from "../packages/real-estate/scrapers/flaresolverr.mjs";

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

test("GPC JSON-LD search HTML parses priced Ghana sales", () => {
  const html = `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","numberOfItems":1,"itemListElement":[
  {"@type":"ListItem","position":1,"url":"https://ghanapropertycentre.com/for-sale/houses/greater-accra/east-legon/88001-3-bedroom-house","name":"3 Bedroom House","image":"https://images.ghanapropertycentre.com/properties/images/88001/photo.jpeg","offers":{"@type":"Offer","price":850000,"priceCurrency":"GHS"}}
]}</script>
`;
  const rows = parseGpcSearchHtml(html, { city: "Accra", transactionType: "sale" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transaction_type, "sale");
  assert.equal(rows[0].community, "East Legon");
  assert.equal(rows[0].price_aed, 850000);
  assert.equal(rows[0].price_period, "total");
});

test("GPC live search URLs target area showtype pages, not fake details", () => {
  const urls = gpcLiveSearchUrls({ city: "Accra", area: "East Legon", transactionType: "sale" });
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => isGpcSearchUrl(u)));
  assert.ok(urls.every((u) => !isGpcDetailUrl(u)));
  assert.ok(urls.some((u) => u.includes("/for-sale/") && u.includes("east-legon") && u.includes("showtype")));
});

test("GPC classifiers keep index pages out of detail enrich", () => {
  const showtype = "https://ghanapropertycentre.com/for-sale/houses/greater-accra/east-legon/showtype";
  const inCity = "https://ghanapropertycentre.com/for-sale/houses/in/accra";
  const detail = "https://ghanapropertycentre.com/for-sale/houses/greater-accra/east-legon/88001-3-bedroom-house";
  assert.equal(isGpcSearchUrl(showtype), true);
  assert.equal(isGpcDetailUrl(showtype), false);
  assert.equal(isGpcSearchUrl(inCity), true);
  assert.equal(isGpcDetailUrl(inCity), false);
  assert.equal(isGpcDetailUrl(detail), true);
  assert.equal(isGpcSearchUrl(detail), false);
});

test("Ghana live search query uses Ghana portals not Bayut", async () => {
  const prev = process.env.JAB_RE_MARKET;
  process.env.JAB_RE_MARKET = "GH";
  try {
    const q = buildLiveSearchQuery(
      "houses for sale in East Legon",
      { transaction_type: "sale", emirate: "Accra", community: "East Legon" },
      {}
    );
    assert.match(q, /ghanapropertycentre\.com/);
    assert.match(q, /East Legon/i);
    assert.doesNotMatch(q, /bayut\.com/);
  } finally {
    if (prev == null) delete process.env.JAB_RE_MARKET;
    else process.env.JAB_RE_MARKET = prev;
  }
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
    assert.deepEqual(GHANA_SCRAPE_TYPES, ["rent", "sale"]);
    assert.ok(!GHANA_PORTALS.includes(GHANA_DIRECT_SOURCE));
    assert.ok(ghanaListingSources().includes(GHANA_DIRECT_SOURCE));
    assert.ok(!INGEST_SOURCES.includes(GHANA_DIRECT_SOURCE));
  } finally {
    if (prev == null) delete process.env.JAB_RE_MARKET;
    else process.env.JAB_RE_MARKET = prev;
  }
});

test("Jiji Accra and Tema share Greater Accra so they scrape once", () => {
  assert.deepEqual(uniqueJijiCities(["Accra", "Tema", "Kumasi"]), ["Accra", "Kumasi"]);
});

test("Jiji advert JSON maps to a priced Ghana rental", () => {
  const row = rowFromJijiAd(
    {
      id: 16503937,
      title: "2bdrm House in Community 25 for rent",
      url: "/community-25/houses-apartments-for-rent/2bdrm-house-in-community-25-for-rent-cYU9SHtEYlo8c9gQMHNyI4aA.html?page=1&amp;pos=1",
      region_name: "Community 25",
      region_parent_name: "Tema Metropolitan",
      price_obj: { value: 4000, view: "GH₵ 4,000", period: "per month" },
      attrs: [
        { name: "Bedrooms", value: 2 },
        { name: "Bathrooms", value: 2 }
      ],
      image_obj: { url: "https://pictures-ghana.jijistatic.net/61759030_photo.jpg" },
      slug: "2bdrm-house-in-community-25-for-rent"
    },
    "Accra",
    "rent",
    "jiji"
  );
  assert.equal(row.source, "jiji");
  assert.equal(row.external_id, "16503937");
  assert.equal(row.emirate, "Tema");
  assert.equal(row.community, "Community 25");
  assert.equal(row.price_aed, 4000);
  assert.equal(row.beds, 2);
  assert.equal(row.transaction_type, "rent");
  assert.equal(row.property_type, "house");
  assert.match(row.source_url, /^https:\/\/jiji\.com\.gh\/community-25\/houses-apartments-for-rent\//);
  assert.equal(row.images[0], "https://pictures-ghana.jijistatic.net/61759030_photo.jpg");
});

test("FlareSolverr HTML wrapper unwraps Jiji JSON", () => {
  const html = `<html><body><pre>{"adverts_list":{"count":2,"adverts":[{"id":1}]}}</pre></body></html>`;
  const data = jsonFromFlareHtml(html);
  assert.equal(data.adverts_list.count, 2);
  assert.equal(data.adverts_list.adverts[0].id, 1);
});

test("GPC detail HTML parses the Alpine propertyGallery photos", () => {
  const html = `
<section x-data="propertyGallery(JSON.parse('[{\\u0022full\\u0022:\\u0022https:\\\\/\\\\/images.ghanapropertycentre.com\\\\/properties\\\\/images\\\\/19191\\\\/photo-a.jpeg\\u0022,\\u0022thumb\\u0022:\\u0022https:\\\\/\\\\/images.ghanapropertycentre.com\\\\/properties\\\\/images\\\\/thumbs\\\\/19191\\\\/photo-a.jpeg\\u0022},{\\u0022full\\u0022:\\u0022https:\\\\/\\\\/images.ghanapropertycentre.com\\\\/properties\\\\/images\\\\/19191\\\\/photo-b.jpeg\\u0022,\\u0022thumb\\u0022:\\u0022https:\\\\/\\\\/images.ghanapropertycentre.com\\\\/properties\\\\/images\\\\/thumbs\\\\/19191\\\\/photo-b.jpeg\\u0022},{\\u0022full\\u0022:\\u0022https:\\\\/\\\\/images.ghanapropertycentre.com\\\\/properties\\\\/images\\\\/19191\\\\/photo-c.jpeg\\u0022,\\u0022thumb\\u0022:\\u0022https:\\\\/\\\\/images.ghanapropertycentre.com\\\\/properties\\\\/images\\\\/thumbs\\\\/19191\\\\/photo-c.jpeg\\u0022}]'), false, '2 Bed Airport')">
<span x-text="(currentIndex + 1) + ' / 3'"></span>
</section>`;
  const images = parseGpcGalleryHtml(html);
  assert.equal(images.length, 3);
  assert.equal(images[0], "https://images.ghanapropertycentre.com/properties/images/19191/photo-a.jpeg");
  assert.ok(images.every((url) => !url.includes("/thumbs/")));
});

test("GPC thumb plus matching full-size photo collapses to the full URL", () => {
  const images = preferFullGpcImages([
    "https://images.ghanapropertycentre.com/properties/images/thumbs/19191/photo-a.jpeg",
    "https://images.ghanapropertycentre.com/properties/images/19191/photo-a.jpeg",
    "https://images.ghanapropertycentre.com/properties/images/19191/photo-b.jpeg"
  ]);
  assert.deepEqual(images, [
    "https://images.ghanapropertycentre.com/properties/images/19191/photo-a.jpeg",
    "https://images.ghanapropertycentre.com/properties/images/19191/photo-b.jpeg"
  ]);
});

test("GPC search JSON-LD still only has the SERP cover image", () => {
  const rows = parseGpcSearchHtml(GPC_FIXTURE, { city: "Accra", transactionType: "rent" });
  assert.equal(rows[0].images.length, 1);
});

test("GPC SERP thumbs still need detail enrich; full galleries do not", () => {
  const thumbListing = {
    source_url: "https://ghanapropertycentre.com/for-rent/flats-apartments/greater-accra/east-legon/19191-apt",
    images: [
      "https://images.ghanapropertycentre.com/properties/images/thumbs/19191/photo-a.jpeg"
    ],
    description: "Luxurious Fully Furnished 2 Bedrooms Apartment"
  };
  const galleryListing = {
    ...thumbListing,
    images: [
      "https://images.ghanapropertycentre.com/properties/images/19191/photo-a.jpeg",
      "https://images.ghanapropertycentre.com/properties/images/19191/photo-b.jpeg"
    ]
  };
  assert.equal(listingNeedsDetailEnrich(thumbListing, { minImages: 4 }), true);
  assert.equal(listingNeedsDetailEnrich(galleryListing, { minImages: 4 }), false);
});
