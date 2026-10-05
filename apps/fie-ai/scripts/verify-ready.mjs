/**
 * Preflight check before Vercel deploy.
 *   node scripts/verify-ready.mjs
 *   node scripts/verify-ready.mjs --strict   # fail if Supabase missing
 */
import { applyFieStandaloneEnv } from "../lib/env.mjs";

applyFieStandaloneEnv();

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSupabaseEnabled } from "../../../packages/real-estate/supabase.mjs";
import { ghanaIngestSources, buildGhanaScrapeTicks } from "../../../packages/real-estate/ghana-ingest.mjs";
import { scrapeSourceToRows } from "../../../packages/real-estate/scrape-runner.mjs";
import { prepareListing } from "../../../packages/real-estate/ingest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const strict = process.argv.includes("--strict");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
}

check("public/index.html", existsSync(path.join(publicDir, "index.html")));
check("public/sw.js", existsSync(path.join(publicDir, "sw.js")));
check("public/manifest.webmanifest", existsSync(path.join(publicDir, "manifest.webmanifest")));
check("JAB_RE_MARKET=GH", process.env.JAB_RE_MARKET === "GH");
check("JAB_FIE_STANDALONE", process.env.JAB_FIE_STANDALONE === "1");
check("GEMINI_API_KEY", Boolean(process.env.GEMINI_API_KEY), process.env.GEMINI_API_KEY ? "set" : "missing (chat needs it)");
check("SUPABASE", isSupabaseEnabled(), isSupabaseEnabled() ? "configured" : "missing");
check("JAB_RE_INGEST_TOKEN or CRON_SECRET", Boolean(process.env.JAB_RE_INGEST_TOKEN || process.env.CRON_SECRET));

const sources = ghanaIngestSources();
const ticks = buildGhanaScrapeTicks({ sources, cities: ["Accra"], types: ["rent"], maxPages: 1 });
check("scrape ticks", ticks.length > 0, `${ticks.length} ticks · sources=${sources.join(",")}`);

let scrapeOk = false;
try {
  const scrape = await scrapeSourceToRows("ghanapropertycentre", {
    emirates: ["Accra"],
    types: ["rent"],
    maxPages: 1
  });
  const prepared = (scrape.rows || []).map((r) => prepareListing(r)).filter(Boolean);
  scrapeOk = prepared.length > 0;
  check("live GPC scrape", scrapeOk, `${prepared.length} prepared rows`);
} catch (error) {
  check("live GPC scrape", false, error.message);
}

const failed = checks.filter((c) => !c.ok);
const softFailNames = new Set(["GEMINI_API_KEY", "SUPABASE", "JAB_RE_INGEST_TOKEN or CRON_SECRET"]);
const hardFailed = failed.filter((c) => strict || !softFailNames.has(c.name));

console.log(JSON.stringify({ ok: hardFailed.length === 0, checks }, null, 2));
if (hardFailed.length) process.exit(1);
