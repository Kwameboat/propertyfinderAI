/**
 * Curated UAE developer & government URL registry for live RAG.
 * Add entries here — the Developer Intel agent fetches these on demand.
 */

export const DEVELOPER_SOURCES = [
  {
    id: "emaar",
    name: "Emaar",
    type: "developer",
    emirate: "Dubai",
    keywords: ["emaar", "creek harbour", "downtown", "dubai hills", "address"],
    urls: [
      "https://properties.emaar.com/en/properties/",
      "https://properties.emaar.com/en/our-communities/"
    ]
  },
  {
    id: "damac",
    name: "Damac",
    type: "developer",
    emirate: "Dubai",
    keywords: ["damac", "damac hills", "cavalli", "safaa"],
    urls: ["https://www.damacproperties.com/en/", "https://www.damacproperties.com/en/projects"]
  },
  {
    id: "nakheel",
    name: "Nakheel",
    type: "developer",
    emirate: "Dubai",
    keywords: ["nakheel", "palm jumeirah", "deira islands", "district one"],
    urls: ["https://www.nakheel.com/en", "https://www.nakheel.com/en/off-plan-projects"]
  },
  {
    id: "sobha",
    name: "Sobha Realty",
    type: "developer",
    emirate: "Dubai",
    keywords: ["sobha", "sobha hartland", "sobha one"],
    urls: ["https://www.sobharealty.com/", "https://www.sobharealty.com/properties"]
  },
  {
    id: "aldar",
    name: "Aldar",
    type: "developer",
    emirate: "Abu Dhabi",
    keywords: ["aldar", "yas island", "saadiyat", "reem island", "al reem"],
    urls: ["https://www.aldar.com/en", "https://www.aldar.com/en/explore-aldar/properties"]
  },
  {
    id: "azizi",
    name: "Azizi Developments",
    type: "developer",
    emirate: "Dubai",
    keywords: ["azizi", "azizi developments", "riviera", "meydan"],
    urls: ["https://www.azizidevelopments.com/", "https://www.azizidevelopments.com/projects"]
  },
  {
    id: "binghatti",
    name: "Binghatti",
    type: "developer",
    emirate: "Dubai",
    keywords: ["binghatti", "bugatti", "jvc binghatti"],
    urls: ["https://www.binghatti.com/", "https://www.binghatti.com/projects"]
  },
  {
    id: "meraas",
    name: "Meraas",
    type: "developer",
    emirate: "Dubai",
    keywords: ["meraas", "city walk", "bluewaters", "la mer"],
    urls: ["https://www.meraas.com/", "https://www.meraas.com/en/our-communities"]
  },
  {
    id: "danube",
    name: "Danube Properties",
    type: "developer",
    emirate: "Dubai",
    keywords: ["danube", "danube properties", "sparklz", "bayz"],
    urls: ["https://www.danubeproperties.com/", "https://www.danubeproperties.com/projects"]
  },
  {
    id: "ellington",
    name: "Ellington Properties",
    type: "developer",
    emirate: "Dubai",
    keywords: ["ellington", "belgravia", "wilton terraces"],
    urls: ["https://ellingtonproperties.ae/", "https://ellingtonproperties.ae/projects/"]
  },
  {
    id: "omniyat",
    name: "Omniyat",
    type: "developer",
    emirate: "Dubai",
    keywords: ["omniyat", "one za'abeel", "the opus"],
    urls: ["https://www.omniyat.com/", "https://www.omniyat.com/residential"]
  },
  {
    id: "dp",
    name: "Dubai Properties",
    type: "developer",
    emirate: "Dubai",
    keywords: ["dubai properties", "dp world", "villanova", "mudon"],
    urls: ["https://www.dp.ae/", "https://www.dp.ae/en/projects"]
  }
];

export const GOVERNMENT_SOURCES = [
  {
    id: "dld",
    name: "Dubai Land Department",
    type: "government",
    emirate: "Dubai",
    keywords: ["dld", "dubai land department", "land department", "title deed", "oqood", "broker commission"],
    urls: ["https://dld.gov.ae/en/", "https://dld.gov.ae/en/news/"]
  },
  {
    id: "dubailand",
    name: "Dubai REST / RERA",
    type: "government",
    emirate: "Dubai",
    keywords: ["rera", "dubailand", "dubai rest", "tenancy", "ejari", "broker regulation"],
    urls: ["https://dubailand.gov.ae/en/", "https://dubailand.gov.ae/en/news/"]
  },
  {
    id: "adrec",
    name: "ADREC",
    type: "government",
    emirate: "Abu Dhabi",
    keywords: ["adrec", "abu dhabi real estate", "municipality property"],
    urls: ["https://www.adrec.gov.ae/en", "https://www.adrec.gov.ae/en/news"]
  },
  {
    id: "dmt",
    name: "Abu Dhabi DMT",
    type: "government",
    emirate: "Abu Dhabi",
    keywords: ["dmt", "department of municipalities", "abu dhabi property law"],
    urls: ["https://www.dmt.gov.ae/en", "https://www.dmt.gov.ae/en/media-center/news"]
  }
];

export const ALL_INTEL_SOURCES = [...DEVELOPER_SOURCES, ...GOVERNMENT_SOURCES];

/** Domains for SearXNG site: filters */
export function intelSourceDomains() {
  const domains = new Set();
  for (const src of ALL_INTEL_SOURCES) {
    for (const url of src.urls) {
      try {
        domains.add(new URL(url).hostname.replace(/^www\./, ""));
      } catch {
        /* skip */
      }
    }
  }
  return [...domains];
}
