/**
 * Local / CI Ghana scrape → Supabase (same path Vercel cron uses).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/scrape-to-supabase.mjs
 *   node scripts/scrape-to-supabase.mjs --all
 *   node scripts/scrape-to-supabase.mjs --source=ghanapropertycentre --city=Accra --type=rent
 */
import { applyFieStandaloneEnv } from "../lib/env.mjs";

applyFieStandaloneEnv();

import { loadHubEnv } from "../../../packages/real-estate/env.mjs";
import { isSupabaseEnabled } from "../../../packages/real-estate/supabase.mjs";
import {
  runGhanaScrapeTick,
  runGhanaScrapeAll,
  ghanaIngestSources
} from "../../../packages/real-estate/ghana-ingest.mjs";
import { runIngestScrape } from "../../../packages/real-estate/ingest.mjs";

loadHubEnv();

const args = process.argv.slice(2);
const all = args.includes("--all");
const source = args.find((a) => a.startsWith("--source="))?.split("=")[1];
const city = args.find((a) => a.startsWith("--city="))?.split("=")[1];
const type = args.find((a) => a.startsWith("--type="))?.split("=")[1];
const maxPages = Number(args.find((a) => a.startsWith("--pages="))?.split("=")[1] || 1);

if (!isSupabaseEnabled()) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

let result;
if (source) {
  result = await runIngestScrape(source, {
    emirates: city ? [city] : undefined,
    types: type ? [type] : ["rent", "sale"],
    maxPages
  });
} else if (all) {
  result = await runGhanaScrapeAll({ maxPages });
} else {
  result = await runGhanaScrapeTick({ maxPages });
}

console.log(
  JSON.stringify(
    {
      ...result,
      configuredSources: ghanaIngestSources()
    },
    null,
    2
  )
);
