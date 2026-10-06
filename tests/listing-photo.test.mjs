import test from "node:test";
import assert from "node:assert/strict";
import {
  listingPhotoSrc,
  listingPhotoSrcs,
  upgradePortalImageUrl,
  jijiDecodedSize
} from "../packages/real-estate/listing-photo-url.mjs";
import { formatListingCard } from "../packages/real-estate/chat.mjs";
import { rowFromJijiAd } from "../packages/real-estate/scrapers/jiji-html.mjs";

test("GPC SERP thumbs upgrade to full-size listing photos", () => {
  const thumb =
    "https://images.ghanapropertycentre.com/properties/images/thumbs/19191/photo-a.jpeg";
  assert.equal(
    upgradePortalImageUrl(thumb),
    "https://images.ghanapropertycentre.com/properties/images/19191/photo-a.jpeg"
  );
});

test("Jiji 300px CDN URLs decode as small and go through the sharpener", () => {
  const b64 = Buffer.from("300-400-581eb5704e").toString("base64").replace(/=+$/, "");
  const url = `https://pictures-ghana.jijistatic.net/62074330_${b64}.jpg`;
  assert.equal(jijiDecodedSize(url), 300);
  const src = listingPhotoSrc(url);
  assert.match(src, /^\/api\/rent\/photo\?u=/);
  assert.match(src, /jijistatic/);
});

test("local PropertyFinder Gh media is not proxied", () => {
  assert.equal(listingPhotoSrc("/gh-media/osu.svg"), "/gh-media/osu.svg");
  assert.equal(
    listingPhotoSrc("/uploads/owner-listings/a/b.jpg"),
    "/uploads/owner-listings/a/b.jpg"
  );
  const already = "/api/rent/photo?u=https%3A%2F%2Fexample.com%2Fa.jpg";
  assert.equal(listingPhotoSrc(already), already);
});

test("chat cards wrap portal photos in the enhancer URL", () => {
  const card = formatListingCard({
    source: "jiji",
    external_id: "1",
    source_url: "https://jiji.com.gh/accra/houses-apartments-for-rent/x",
    transaction_type: "rent",
    emirate: "Accra",
    community: "East Legon",
    price_aed: 1800,
    images: ["https://pictures-ghana.jijistatic.net/61759030_photo.jpg"]
  });
  assert.match(card.images[0], /^\/api\/rent\/photo\?u=/);
  assert.match(card.image, /^\/api\/rent\/photo\?u=/);
});

test("Jiji ads prefer the largest decoded photo when several sizes exist", () => {
  const small = Buffer.from("300-400-abc").toString("base64").replace(/=+$/, "");
  const large = Buffer.from("1024-1365-abc").toString("base64").replace(/=+$/, "");
  const row = rowFromJijiAd(
    {
      id: 99,
      title: "2 bedroom house for rent",
      url: "/east-legon/houses-apartments-for-rent/x.html",
      region_name: "East Legon",
      region_parent_name: "Accra",
      price_obj: { value: 2500, period: "per month" },
      image_obj: { url: `https://pictures-ghana.jijistatic.net/99_${small}.jpg` },
      images: [{ url: `https://pictures-ghana.jijistatic.net/99_${large}.jpg` }]
    },
    "Accra",
    "rent",
    "jiji"
  );
  assert.match(row.images[0], /99_/);
  assert.equal(jijiDecodedSize(row.images[0]), 1024);
});

test("listingPhotoSrcs de-duplicates", () => {
  const url = "https://pictures-ghana.jijistatic.net/1_photo.jpg";
  assert.equal(listingPhotoSrcs([url, url]).length, 1);
});

test("sharp enhancer upscales a tiny JPEG into a larger webp", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../apps/hub/listing-photo.mjs", import.meta.url));
  const sharp = require("sharp");
  const { enhanceImageBuffer } = await import("../apps/hub/listing-photo.mjs");
  const tiny = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 90, g: 90, b: 90 } }
  })
    .jpeg({ quality: 40 })
    .toBuffer();
  const out = await enhanceImageBuffer(tiny, { strong: true });
  assert.ok(out?.length > 0);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "webp");
  assert.ok(meta.width >= 200, `expected upscale, got width ${meta.width}`);
});
