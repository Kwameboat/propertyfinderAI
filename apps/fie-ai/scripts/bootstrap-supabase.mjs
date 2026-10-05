/**
 * First-fill Supabase from a live Ghana Property Centre scrape.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/bootstrap-supabase.mjs
 *   node scripts/bootstrap-supabase.mjs --dry-run
 *   node scripts/bootstrap-supabase.mjs --city=Accra --type=rent --pages=1
 */
import { applyFieStandaloneEnv } from "../lib/env.mjs";

applyFieStandaloneEnv();

import { loadHubEnv } from "../../../packages/real-estate/env.mjs";
import { scrapeSourceToRows } from "../../../packages/real-estate/scrape-runner.mjs";
import { prepareListing } from "../../../packages/real-estate/ingest.mjs";
import {
  isSupabaseEnabled,
  batchSyncListingsToSupabase,
  countActiveListingsSupabase,
  countListingsBySourceSupabase
} from "../../../packages/real-estate/supabase.mjs";
import { ghanaListingSources } from "../../../packages/real-estate/market.mjs";

loadHubEnv();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const city = args.find((a) => a.startsWith("--city="))?.split("=")[1] || "Accra";
const type = args.find((a) => a.startsWith("--type="))?.split("=")[1] || "rent";
const pages = Number(args.find((a) => a.startsWith("--pages="))?.split("=")[1] || 1);
const source = args.find((a) => a.startsWith("--source="))?.split("=")[1] || "ghanapropertycentre";

if (!dryRun && !isSupabaseEnabled()) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --dry-run)");
  process.exit(1);
}

const scrape = await scrapeSourceToRows(source, {
  emirates: [city],
  types: [type],
  maxPages: Math.max(1, Math.min(3, pages))
});

const prepared = (scrape.rows || []).map((row) => prepareListing(row)).filter(Boolean);

let upserted = 0;
if (!dryRun && prepared.length) {
  const result = await batchSyncListingsToSupabase(prepared);
  upserted = result.upserted || 0;
}

let inventory = null;
if (!dryRun && isSupabaseEnabled()) {
  const [total, bySource] = await Promise.all([
    countActiveListingsSupabase(),
    countListingsBySourceSupabase(ghanaListingSources())
  ]);
  inventory = { total, bySource };
}

console.log(
  JSON.stringify(
    {
      ok: scrape.ok || prepared.length > 0,
      dryRun,
      source,
      city,
      type,
      pages,
      found: scrape.found,
      prepared: prepared.length,
      upserted,
      errors: (scrape.errors || []).slice(0, 5),
      sample: prepared.slice(0, 3).map((r) => ({
        source: r.source,
        external_id: r.external_id,
        community: r.community,
        price_aed: r.price_aed,
        cluster_id: r.cluster_id,
        images: (r.images || []).length
      })),
      inventory
    },
    null,
    2
  )
);

if (!prepared.length) process.exit(2);
