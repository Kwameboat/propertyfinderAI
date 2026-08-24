/**
 * Purge listings from Supabase (+ SQLite when available).
 *
 *   node scripts/purge-demo-listings.mjs              # demo/seed only
 *   node scripts/purge-demo-listings.mjs --all        # wipe all listings (full re-scrape)
 *   node scripts/purge-demo-listings.mjs --inactive   # also delete is_active=false
 */

import {
  isSupabaseEnabled,
  deleteDemoListingsSupabase,
  deleteInactiveListingsSupabase,
  deleteAllListingsSupabase,
  countActiveListingsSupabase,
  countListingsBySourceSupabase
} from "../packages/real-estate/supabase.mjs";
import { loadHubEnv } from "../packages/real-estate/env.mjs";

loadHubEnv();

const purgeAll = process.argv.includes("--all");
const purgeInactive = process.argv.includes("--inactive") || purgeAll;

async function purgeSqlite({ all }) {
  try {
    const hub = await import("../packages/hub-db/index.mjs");
    const { db } = hub.openHubDb();
    let demo = { total: 0 };
    if (all) {
      const r = db.prepare(`DELETE FROM re_listings`).run();
      demo = { total: r.changes || 0, all: true };
    } else {
      demo = hub.deleteDemoListings(db);
    }
    const inactive = purgeInactive ? hub.deleteInactiveListings(db) : 0;
    return { demo, inactive, active: hub.countActiveListings(db) };
  } catch (error) {
    return { skipped: true, reason: error.message };
  }
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("SUPABASE_URL and key required");
    process.exit(1);
  }

  const sqlite = await purgeSqlite({ all: purgeAll });
  const supabaseDemo = purgeAll
    ? await deleteAllListingsSupabase()
    : await deleteDemoListingsSupabase();
  const supabaseInactive =
    purgeInactive && !purgeAll ? await deleteInactiveListingsSupabase() : { deleted: 0 };

  const status = {
    listings: await countActiveListingsSupabase(),
    sources: await countListingsBySourceSupabase()
  };

  console.log(
    JSON.stringify(
      {
        ok: true,
        at: new Date().toISOString(),
        mode: purgeAll ? "all" : "demo",
        sqlite,
        supabase: { purge: supabaseDemo, inactive: supabaseInactive },
        status
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
