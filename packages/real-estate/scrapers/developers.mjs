/**
 * Developer off-plan pages — Emaar public project listings (HTML/JSON-LD).
 */

import { fetchText, extractJsonLd, sleep, rateLimitMs } from "./http.mjs";
import { normalizeListingRow } from "./normalize.mjs";

const DEVELOPER_SOURCES = [
  {
    developer: "Emaar",
    emirate: "Dubai",
    url: "https://properties.emaar.com/en/properties/",
    source: "emaar"
  },
  {
    developer: "Damac",
    emirate: "Dubai",
    url: "https://www.damacproperties.com/en/",
    source: "damac"
  }
];

function parseDamacProjectLinks(html, meta) {
  const base = "https://www.damacproperties.com";
  const paths = new Set();
  const re = /href="(\/en\/(?:projects\/[^"#?]+|communities\/[^"#?]+\/projects\/[^"#?]+))"/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const path = m[1].replace(/\/$/, "");
    if (path.endsWith("/projects")) continue;
    paths.add(path);
  }
  return [...paths].slice(0, 30).map((path, i) => {
    const slug = path.split("/").filter(Boolean).pop() || `project-${i}`;
    const name = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return normalizeListingRow({
      source: meta.source,
      external_id: `damac-${slug}`.slice(0, 80),
      source_url: `${base}${path}`,
      transaction_type: "off_plan",
      property_type: "apartment",
      emirate: meta.emirate,
      community: name,
      developer: meta.developer,
      price_aed: 0,
      price_period: "total",
      description: `${meta.developer} — ${name}`
    });
  });
}

function parseEmaarCommunityLinks(html, meta) {
  const base = "https://properties.emaar.com";
  const paths = new Set();
  const re = /href="(\/en\/our-communities\/[^"#?]+)"/gi;
  let m;
  while ((m = re.exec(String(html || "")))) paths.add(m[1]);
  return [...paths].slice(0, 30).map((path, i) => {
    const slug = path.split("/").pop() || `community-${i}`;
    const name = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return normalizeListingRow({
      source: meta.source,
      external_id: `emaar-${slug}`.slice(0, 80),
      source_url: `${base}${path}`,
      transaction_type: "off_plan",
      property_type: "apartment",
      emirate: meta.emirate,
      community: name,
      developer: meta.developer,
      price_aed: 0,
      price_period: "total",
      description: `${meta.developer} — ${name} community`
    });
  });
}

function parseJsonLdProducts(blocks, meta) {
  const rows = [];
  for (const block of blocks) {
    const items = Array.isArray(block) ? block : [block];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (item["@type"] !== "Product" && item["@type"] !== "Apartment" && item["@type"] !== "Residence") continue;
      const price = Number(item.offers?.price || item.price || 0);
      if (!price && !item.name) continue;
      rows.push(
        normalizeListingRow({
          source: meta.source,
          external_id: String(item.sku || item.url || item.name).replace(/\W+/g, "-").slice(0, 80),
          source_url: item.url || meta.url,
          transaction_type: "off_plan",
          property_type: "apartment",
          emirate: meta.emirate,
          community: item.address?.addressLocality || "",
          price_aed: price || 0,
          price_period: "total",
          developer: meta.developer,
          description: item.name || item.description || "",
          images: item.image ? (Array.isArray(item.image) ? item.image : [item.image]) : []
        })
      );
    }
  }
  return rows;
}

export async function scrapeDevelopers(db, upsertListing, { sources } = {}) {
  let found = 0;
  let upserted = 0;
  const errors = [];

  const targets = sources?.length
    ? DEVELOPER_SOURCES.filter((m) => sources.includes(m.source))
    : DEVELOPER_SOURCES;

  for (const meta of targets) {
    try {
      const html = await fetchText(meta.url);
      const blocks = extractJsonLd(html);
      let rows = parseJsonLdProducts(blocks, meta);
      if (!rows.length && meta.developer === "Emaar") {
        rows = parseEmaarCommunityLinks(html, meta);
      }
      if (!rows.length && meta.developer === "Damac") {
        rows = parseDamacProjectLinks(html, meta);
      }
      found += rows.length;
      for (const row of rows) {
        upsertListing(db, row);
        upserted++;
      }
    } catch (e) {
      errors.push(`${meta.developer}: ${e.message}`);
    }
    await sleep(rateLimitMs());
  }

  return { found, upserted, errors };
}
