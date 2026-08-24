/**
 * Apply all additive Supabase migrations needed for full RE app function.
 * Prefers Management API (SUPABASE_ACCESS_TOKEN); falls back to pg + SUPABASE_DB_PASSWORD.
 *
 * Usage: node deploy/apply-all-re-migrations.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHubEnv } from "../packages/real-estate/env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
loadHubEnv();

const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_API_TOKEN || "";
const dbPassword = process.env.SUPABASE_DB_PASSWORD || "";
const ref = url.match(/https:\/\/([^.]+)/)?.[1] || "";
const apiKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";

const MIGRATIONS = [
  {
    name: "002_inventory",
    file: "supabase/migrations/002_inventory.sql",
    verify: async () => restOk("inventory?select=id&limit=1")
  },
  {
    name: "002_listing_availability",
    file: "supabase/migrations/002_listing_availability.sql",
    verify: async () => restOk("listings?select=listing_status&limit=1")
  },
  {
    name: "003_developer_intel",
    file: "supabase/migrations/003_developer_intel.sql",
    verify: async () => restOk("developer_intel?select=id&limit=1")
  }
];

async function restOk(pathname) {
  if (!url || !apiKey) return false;
  const res = await fetch(`${url}/rest/v1/${pathname}`, {
    headers: { apikey: apiKey },
    signal: AbortSignal.timeout(15000)
  });
  if (res.status === 404) return false;
  const text = await res.text();
  if (/PGRST205|does not exist|42703|column.*does not exist/i.test(text)) return false;
  return res.ok;
}

async function runSql(sql) {
  if (token) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(120000)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`);
    return "mgmt_api";
  }

  if (!dbPassword) throw new Error("Need SUPABASE_ACCESS_TOKEN or SUPABASE_DB_PASSWORD");
  const { Client } = await import("pg");
  const client = new Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: dbPassword,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
  return "pg";
}

async function applyMigration(m) {
  if (await m.verify()) {
    return { name: m.name, status: "already_applied" };
  }
  const sql = fs.readFileSync(path.join(ROOT, m.file), "utf8");
  const method = await runSql(sql);
  if (!(await m.verify())) {
    throw new Error(`${m.name} ran via ${method} but verification failed`);
  }
  return { name: m.name, status: "applied", method };
}

async function main() {
  if (!url || !ref) throw new Error("SUPABASE_URL missing or invalid");
  if (!token && !dbPassword) throw new Error("Need SUPABASE_ACCESS_TOKEN or SUPABASE_DB_PASSWORD");
  if (!apiKey) throw new Error("Need SUPABASE_PUBLISHABLE_KEY or service role key for verification");

  const results = [];
  for (const m of MIGRATIONS) {
    try {
      results.push(await applyMigration(m));
    } catch (error) {
      results.push({ name: m.name, status: "error", error: error.message });
    }
  }

  const failed = results.filter((r) => r.status === "error");
  console.log(JSON.stringify({ ok: !failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
