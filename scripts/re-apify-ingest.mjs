/**
 * Test Apify ingest for Bayut / Property Finder.
 * Usage:
 *   node scripts/re-apify-ingest.mjs --source=bayut
 *   node scripts/re-apify-ingest.mjs --source=propertyfinder
 */
import { loadHubEnv } from "../packages/real-estate/env.mjs";
import { isApifyConfigured } from "../packages/real-estate/apify-client.mjs";
import { runApifyIngest } from "../packages/real-estate/apify-ingest.mjs";
import { isSupabaseEnabled } from "../packages/real-estate/supabase.mjs";

loadHubEnv();

const sourceArg = process.argv.find((a) => a.startsWith("--source="));
const source = sourceArg ? sourceArg.split("=")[1] : null;

async function main() {
  if (!isApifyConfigured()) {
    console.error("Set APIFY_API_TOKEN in .env");
    process.exit(1);
  }
  if (!isSupabaseEnabled()) {
    console.error("Supabase required");
    process.exit(1);
  }
  if (!source) {
    console.error("Usage: --source=bayut|propertyfinder");
    process.exit(1);
  }

  const result = await runApifyIngest(source, {
    emirates: ["Dubai"],
    maxPages: 1,
    maxResults: 20
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
