/**
 * Apply scrape_runs RLS policy on Supabase (one-time fix).
 * Run on VPS: node scripts/supabase-fix-scrape-runs-rls.mjs
 */
import { loadHubEnv } from "../packages/real-estate/env.mjs";

loadHubEnv();

const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";

if (!url || !key) {
  console.error("SUPABASE_URL and key required");
  process.exit(1);
}

const sql = `
alter table scrape_runs enable row level security;
drop policy if exists "Server manage scrape_runs" on scrape_runs;
create policy "Server manage scrape_runs" on scrape_runs for all using (true) with check (true);
`;

async function main() {
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (dbPassword) {
    const projectRef = url.match(/https:\/\/([^.]+)/)?.[1];
    if (projectRef) {
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
      console.log(JSON.stringify({ ok: true, method: "pg", message: "scrape_runs RLS policy applied" }));
      return;
    }
  }

  console.log(
    JSON.stringify({
      ok: false,
      message: "Set SUPABASE_DB_PASSWORD in .env and re-run, OR paste this SQL in Supabase SQL Editor:",
      sql: sql.trim()
    })
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
