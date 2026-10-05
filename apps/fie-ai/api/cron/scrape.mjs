/**
 * Vercel Cron → Ghana portal scrape tick → Supabase.
 * Auth: Authorization: Bearer $CRON_SECRET  (Vercel sets this)
 *    or X-Ingest-Token: $JAB_RE_INGEST_TOKEN
 */
import { applyFieStandaloneEnv } from "../../lib/env.mjs";

applyFieStandaloneEnv();

import { verifyIngestToken } from "../../../../packages/real-estate/ingest.mjs";
import { isSupabaseEnabled } from "../../../../packages/real-estate/supabase.mjs";
import { runGhanaScrapeTick, ghanaIngestSources } from "../../../../packages/real-estate/ghana-ingest.mjs";

function authorized(req) {
  const auth = String(req.headers?.authorization || "");
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const ingest =
    req.headers?.["x-ingest-token"] ||
    auth.replace(/^Bearer\s+/i, "");
  return verifyIngestToken(ingest);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  if (!isSupabaseEnabled()) {
    res.status(503).json({
      ok: false,
      error: "Supabase not configured",
      need: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
    });
    return;
  }

  try {
    const body = typeof req.body === "object" && req.body ? req.body : {};
    const result = await runGhanaScrapeTick({
      sources: Array.isArray(body.sources) ? body.sources : undefined,
      emirates: Array.isArray(body.emirates) ? body.emirates : undefined,
      types: Array.isArray(body.types) ? body.types : undefined,
      maxPages: body.maxPages != null ? Number(body.maxPages) : undefined
    });
    res.status(200).json({
      ...result,
      configuredSources: ghanaIngestSources()
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}
