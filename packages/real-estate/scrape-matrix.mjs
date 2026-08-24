/**
 * Coverage grid — top UAE communities × rent/sale for bulk ingest expansion.
 */

export const MATRIX_EMIRATES = ["Dubai", "Abu Dhabi", "Sharjah", "Ajman"];

export const MATRIX_COMMUNITIES = {
  Dubai: [
    "Dubai Marina",
    "JVC",
    "Business Bay",
    "Downtown",
    "JLT",
    "Dubai Hills",
    "Palm Jumeirah",
    "Silicon Oasis",
    "Motor City",
    "Sports City",
    "Al Barsha",
    "Discovery Gardens",
    "International City",
    "Mirdif",
    "Arabian Ranches"
  ],
  "Abu Dhabi": [
    "Reem Island",
    "Yas Island",
    "Al Reem",
    "Khalifa City",
    "Al Raha Beach",
    "Saadiyat Island",
    "Corniche",
    "Al Reef"
  ],
  Sharjah: ["Al Majaz", "Al Nahda", "Al Qassimia", "Muwaileh", "Al Rashidiya 3", "Al Khan", "Al Taawun", "Al Nahda Sharjah"],
  Ajman: ["Al Rashidiya 3", "Al Nuaimiya", "Al Jurf", "Al Mowaihat", "Al Rawda", "Al Hamidiya", "Emirates City"]
};

/** Property Finder community slug overrides. */
export const PF_COMMUNITY_SLUG = {
  JVC: "jumeirah-village-circle-jvc",
  "Dubai Marina": "dubai-marina",
  "Business Bay": "business-bay",
  Downtown: "downtown-dubai",
  JLT: "jumeirah-lake-towers-jlt",
  "Dubai Hills": "dubai-hills-estate",
  "Palm Jumeirah": "palm-jumeirah",
  "Silicon Oasis": "dubai-silicon-oasis",
  "Motor City": "motor-city",
  "Sports City": "dubai-sports-city",
  "Reem Island": "reem-island",
  "Yas Island": "yas-island",
  "Al Majaz": "al-majaz",
  "Al Nahda": "al-nahda-sharjah",
  "Al Qassimia": "al-qassimia",
  Muwaileh: "muwaileh",
  "Al Rashidiya 3": "al-rashidiya-3",
  "Al Khan": "al-khan",
  "Al Taawun": "al-taawun",
  "Al Nuaimiya": "al-nuaimiya",
  "Al Jurf": "al-jurf",
  "Al Mowaihat": "al-mowaihat",
  "Al Rawda": "al-rawda",
  "Al Hamidiya": "al-hamidiya",
  "Emirates City": "emirates-city"
};

export function communityToPfSlug(community = "", emirate = "Dubai") {
  const name = String(community || "").trim();
  if (PF_COMMUNITY_SLUG[name]) return PF_COMMUNITY_SLUG[name];
  const emSlug = emirate.toLowerCase().replace(/\s+/g, "-");
  const cSlug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  if (!cSlug) return null;
  return `${cSlug}-${emSlug}`.replace(/--+/g, "-");
}

export function listMatrixJobs({ emirates = MATRIX_EMIRATES, types = ["rent", "sale"] } = {}) {
  const jobs = [];
  for (const emirate of emirates) {
    const communities = MATRIX_COMMUNITIES[emirate] || [];
    for (const community of communities) {
      for (const type of types) {
        jobs.push({ emirate, community, transaction_type: type === "rent" ? "rent" : "sale" });
      }
    }
  }
  return jobs;
}
