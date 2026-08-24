/**
 * CLI for multi-source listing ingest (same logic n8n calls via HTTP).
 *
 *   node scripts/re-n8n-ingest.mjs --source=bayut
 *   node scripts/re-n8n-ingest.mjs --all
 *   node scripts/re-n8n-ingest.mjs --all --sources=bayut,propertyfinder,emaar
 */

import { loadHubEnv } from "../packages/real-estate/env.mjs";
import { runIngestScrape, runIngestScrapeAll } from "../packages/real-estate/ingest.mjs";
import { isSupabaseEnabled } from "../packages/real-estate/supabase.mjs";
import { INGEST_SOURCES, DEFAULT_N8N_SOURCES } from "../packages/real-estate/scrape-runner.mjs";
import { getN8nIngestSources } from "../packages/real-estate/mode.mjs";

loadHubEnv();

const args = process.argv.slice(2);
const all = args.includes("--all");
const sourceArg = args.find((a) => a.startsWith("--source="));
const sourcesArg = args.find((a) => a.startsWith("--sources="));
const source = sourceArg ? sourceArg.split("=")[1] : null;
const sources = sourcesArg ? sourcesArg.split("=")[1].split(",") : getN8nIngestSources();

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  if (all) {
    const result = await runIngestScrapeAll(sources);
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
    return;
  }

  if (!source) {
    console.error(`Usage: --source=<name> or --all\nSources: ${INGEST_SOURCES.join(", ")}`);
    process.exit(1);
  }

  if (!INGEST_SOURCES.includes(source)) {
    console.error(`Unknown source: ${source}. Allowed: ${INGEST_SOURCES.join(", ")}`);
    process.exit(1);
  }

  const result = await runIngestScrape(source);
  console.log(JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
