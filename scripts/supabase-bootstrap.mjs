/**
 * Test Supabase connection and sync listings from local DB.
 * Run: node scripts/supabase-bootstrap.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openHubDb, getListing } from "../packages/hub-db/index.mjs";
import { isSupabaseEnabled, syncListingToSupabase } from "../packages/real-estate/supabase.mjs";
import { loadHubEnv } from "../packages/real-estate/env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

async function loadEnvFile() {
  loadHubEnv();
}

async function testConnection() {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const apiKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!base || !apiKey) throw new Error("SUPABASE_URL and key missing");

  const headers = { apikey: apiKey };
  if (!String(apiKey).startsWith("sb_")) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${base}/rest/v1/listings?select=id&limit=1`, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const text = await res.text();
  if (res.status === 404 || /PGRST205|relation.*does not exist/i.test(text)) {
    throw new Error(
      "Table listings not found — run supabase/migrations/001_real_estate.sql in Supabase SQL Editor first"
    );
  }
  if (!res.ok) throw new Error(`Supabase ping ${res.status}: ${text.slice(0, 200)}`);
  return { ok: true, sample: text.slice(0, 100) };
}

async function main() {
  await loadEnvFile();
  if (!isSupabaseEnabled()) {
    console.error("Set SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (or service role) in .env");
    process.exit(1);
  }

  console.log("Testing Supabase…");
  const ping = await testConnection();
  console.log(JSON.stringify({ ping }));

  const { db } = openHubDb();
  const rows = db.prepare(`SELECT id FROM re_listings WHERE is_active = 1`).all();
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const listing = getListing(db, row.id);
    if (!listing) continue;
    try {
      await syncListingToSupabase(listing);
      synced++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.error("sync error:", e.message);
    }
  }

  console.log(JSON.stringify({ synced, failed, total: rows.length, supabase: true }));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
