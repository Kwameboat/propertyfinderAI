/**
 * Apply listing availability columns to Supabase.
 * Usage: node deploy/apply-listing-availability-migration.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHubEnv } from "../packages/real-estate/env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadHubEnv();

const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const dbPassword = process.env.SUPABASE_DB_PASSWORD || "";
const sql = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/002_listing_availability.sql"),
  "utf8"
);

async function main() {
  if (!url) throw new Error("SUPABASE_URL missing");
  if (!dbPassword) {
    console.log(
      JSON.stringify({
        ok: false,
        message:
          "Set SUPABASE_DB_PASSWORD in .env, or run supabase/migrations/002_listing_availability.sql in Supabase SQL Editor"
      })
    );
    process.exit(1);
  }

  const projectRef = url.match(/https:\/\/([^.]+)/)?.[1];
  if (!projectRef) throw new Error("Invalid SUPABASE_URL");

  const { Client } = await import("pg");
  const client = new Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: dbPassword,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log(JSON.stringify({ ok: true, migration: "002_listing_availability" }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
