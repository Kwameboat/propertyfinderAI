import { openHubDb, upsertListing } from "../../../packages/hub-db/index.mjs";
import { GHANA_SEED_LISTINGS } from "../../../packages/real-estate/data/seed-ghana-listings.mjs";
import { clusterKey } from "../../../packages/real-estate/cluster.mjs";
import { isSupabaseEnabled } from "../../../packages/real-estate/supabase.mjs";

let cached = null;
let seeded = false;

function rewriteSeedMedia(row) {
  const images = (row.images || []).map((src) =>
    String(src).replace(/^\/gh-media\//, "/media/")
  );
  return { ...row, images };
}

export function getFieDb() {
  if (cached) return cached;
  const opened = openHubDb(process.env.JAB_HUB_DATA_DIR);
  cached = opened.db;
  return cached;
}

/** Seed demo Ghana listings into SQLite when Supabase is not configured. */
export function ensureFieSeed(db = getFieDb()) {
  if (seeded || isSupabaseEnabled()) return { seeded: false, reason: "supabase_or_done" };
  const count = db.prepare(`SELECT COUNT(*) AS n FROM re_listings WHERE is_active = 1`).get()?.n || 0;
  if (count > 0) {
    seeded = true;
    return { seeded: false, reason: "already_has_listings", count };
  }
  let n = 0;
  for (const row of GHANA_SEED_LISTINGS) {
    const listing = upsertListing(db, { ...rewriteSeedMedia(row), cluster_id: clusterKey(row) });
    db.prepare(`UPDATE re_listings SET cluster_id = ? WHERE id = ?`).run(
      clusterKey(listing),
      listing.id
    );
    n += 1;
  }
  seeded = true;
  return { seeded: true, count: n };
}
