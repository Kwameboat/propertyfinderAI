/**
 * Expanded demo listings across all 7 emirates (production baseline when API/scrape unavailable).
 */

import { UAE_EMIRATES } from "../../hub-db/real-estate.mjs";

const COMMUNITIES = {
  Dubai: ["JVC", "Dubai Marina", "Business Bay", "Downtown", "Silicon Oasis", "Dubai Hills"],
  "Abu Dhabi": ["Reem Island", "Yas Island", "Al Reem", "Khalifa City"],
  Sharjah: ["Al Majaz", "Al Nahda", "Muwaileh"],
  Ajman: ["Al Nuaimiya", "Corniche Ajman"],
  "Umm Al Quwain": ["Al Salamah", "UAQ Marina"],
  "Ras Al Khaimah": ["Al Hamra", "Mina Al Arab"],
  Fujairah: ["Dibba", "Fujairah City"]
};

const PROPERTY_PHOTOS = [
  "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1280&q=80",
  "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1280&q=80",
  "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1280&q=80",
  "https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1280&q=80",
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1280&q=80",
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1280&q=80",
  "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1280&q=80",
  "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1280&q=80",
  "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1280&q=80",
  "https://images.unsplash.com/photo-1605276374104-de6872b6579a?w=1280&q=80"
];

function imagesForListing(index) {
  const count = 6 + (index % 3);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(PROPERTY_PHOTOS[(index + i) % PROPERTY_PHOTOS.length]);
  }
  return out;
}

const PLATFORMS = [
  { source: "bayut", source_url: "https://www.bayut.com/" },
  { source: "propertyfinder", source_url: "https://www.propertyfinder.ae/" },
  { source: "dubizzle", source_url: "https://dubai.dubizzle.com/" },
  { source: "emaar", source_url: "https://properties.emaar.com/en/properties/" }
];

function platformForListing(index, transactionType) {
  if (transactionType === "off_plan") return PLATFORMS[3];
  return PLATFORMS[index % 3];
}

export function generateExpandedSeedListings() {
  const rows = [];
  let n = 0;

  for (const emirate of UAE_EMIRATES) {
    const communities = COMMUNITIES[emirate] || [emirate];
    for (const tx of ["rent", "sale", "off_plan"]) {
      for (let beds = 1; beds <= 3; beds++) {
        const community = communities[n % communities.length];
        const base =
          tx === "rent"
            ? 45000 + beds * 18000 + (emirate === "Dubai" ? 20000 : 0)
            : tx === "sale"
              ? 850000 + beds * 450000
              : 1100000 + beds * 350000;
        n++;
        const platform = platformForListing(n, tx);
        rows.push({
          source: platform.source,
          external_id: `gen-${platform.source}-${emirate.toLowerCase().replace(/\s+/g, "-")}-${tx}-${beds}br-${n}`,
          transaction_type: tx,
          property_type: beds >= 3 ? "townhouse" : "apartment",
          beds,
          baths: Math.max(1, beds),
          emirate,
          community,
          price_aed: base,
          price_period: tx === "rent" ? "yearly" : "total",
          handover_date: tx === "off_plan" ? "2028-Q1" : null,
          payment_plan: tx === "off_plan" ? "60/40 construction" : "",
          developer: tx === "off_plan" ? (emirate === "Abu Dhabi" ? "Aldar" : "Emaar") : "",
          furnished: tx === "rent" ? n % 2 === 0 : null,
          amenities: ["pool", "gym", "parking"].slice(0, 1 + (n % 3)),
          images: imagesForListing(n),
          description: `${beds}BR ${tx.replace("_", "-")} in ${community}, ${emirate}`,
          agent_name: `${emirate} Agent ${n}`,
          agent_phone: `+9715${String(10000000 + (n % 89999999)).slice(0, 8)}`,
          agency_name: `${emirate} Realty`,
          source_url: platform.source_url
        });
      }
    }
  }

  return rows;
}
