import { openHubDb, upsertListing } from "../packages/hub-db/index.mjs";
import { GHANA_SEED_LISTINGS } from "../packages/real-estate/data/seed-ghana-listings.mjs";
import { clusterKey } from "../packages/real-estate/cluster.mjs";
import { loadHubEnv } from "../packages/real-estate/env.mjs";

loadHubEnv();
const { db } = openHubDb();
let n = 0;
for (const row of GHANA_SEED_LISTINGS) {
  const listing = upsertListing(db, { ...row, cluster_id: clusterKey(row) });
  db.prepare(`UPDATE re_listings SET cluster_id = ? WHERE id = ?`).run(clusterKey(listing), listing.id);
  n += 1;
}
console.log(`Seeded ${n} Ghana listings.`);
