/**
 * PropertyFinder Gh — standalone Ghana housing PWA + API for Vercel (or local Node).
 * Chat/browse/viewing + Ghana scrapers that write to Supabase.
 */
import { applyFieStandaloneEnv } from "./lib/env.mjs";

applyFieStandaloneEnv();

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFieDb, ensureFieSeed } from "./lib/db.mjs";
import {
  createSession as createReSession,
  getSession as getReSession
} from "../../packages/hub-db/real-estate.mjs";
import { redeemViewingPin } from "../../packages/hub-db/ghana-viewing.mjs";
import { publicMarketConfig, isGhanaMarket } from "../../packages/real-estate/market.mjs";
import {
  handleRentChat,
  handleRentTranscribe,
  submitRentLead,
  formatListingCard,
  formatListingDetail
} from "../../packages/real-estate/chat.mjs";
import {
  searchListingsStore,
  getListingStore,
  getListingsStatus
} from "../../packages/real-estate/listings-store.mjs";
import { groupListingsByCluster, attachClusterMeta } from "../../packages/real-estate/cluster.mjs";
import { isSupabaseEnabled } from "../../packages/real-estate/supabase.mjs";
import {
  confirmGhanaViewingPayment,
  handleGhanaPaystackWebhook,
  parseAgentPinMessage
} from "../../packages/real-estate/ghana-viewing.mjs";
import { submitOwnerListing } from "../../packages/real-estate/owner-listing.mjs";
import { verifyPaystackSignature } from "../../packages/paystack.mjs";
import {
  verifyIngestToken,
  runIngestScrape,
  runIngestStaleCleanup
} from "../../packages/real-estate/ingest.mjs";
import { GHANA_INGEST_SOURCES } from "../../packages/real-estate/scrape-runner.mjs";
import {
  runGhanaScrapeTick,
  runGhanaScrapeAll,
  ghanaIngestSources,
  ingestGhanaListingBatch
} from "../../packages/real-estate/ghana-ingest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const db = getFieDb();
ensureFieSeed(db);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const hits = new Map();
function rentRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 60_000;
  const max = Number(process.env.JAB_FIE_RATE_MAX || 60);
  const bucket = hits.get(ip) || [];
  const recent = bucket.filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (recent.length > max) {
    res.status(429).json({ ok: false, error: "Too many requests" });
    return;
  }
  next();
}

app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

function rentIngestAuth(req, res, next) {
  const token =
    req.headers["x-ingest-token"] ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (cronSecret && token === cronSecret) {
    next();
    return;
  }
  if (!verifyIngestToken(token)) {
    res.status(401).json({ ok: false, error: "Invalid or missing ingest token (X-Ingest-Token)" });
    return;
  }
  next();
}

app.get("/api/health", async (_req, res) => {
  let inventory = null;
  try {
    inventory = await getListingsStatus(db);
  } catch (error) {
    inventory = { error: error.message };
  }
  res.json({
    ok: true,
    app: "fie-ai",
    market: "GH",
    standalone: true,
    store: isSupabaseEnabled() ? "supabase" : "sqlite",
    supabase: isSupabaseEnabled(),
    scrapeSources: ghanaIngestSources(),
    inventory
  });
});

app.get("/api/rent/config", (_req, res) => {
  res.json({
    ok: true,
    market: publicMarketConfig(),
    store: isSupabaseEnabled() ? "supabase" : "sqlite",
    scrapeSources: ghanaIngestSources()
  });
});

app.post("/api/rent/ingest", rentIngestAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      res.status(503).json({ ok: false, error: "Supabase required for ingest" });
      return;
    }
    const listings = Array.isArray(req.body?.listings) ? req.body.listings : [];
    const source = String(req.body?.source || "batch").trim();
    if (!listings.length) {
      res.status(400).json({ ok: false, error: "listings array required" });
      return;
    }
    const result = await ingestGhanaListingBatch(listings, { source });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/ingest/scrape", rentIngestAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      res.status(503).json({ ok: false, error: "Supabase required for scrape" });
      return;
    }
    const source = String(req.body?.source || req.query?.source || "").trim();
    const allowed = ghanaIngestSources({ includeJiji: true });
    if (!source) {
      res.status(400).json({ ok: false, error: "source required", allowed });
      return;
    }
    if (!GHANA_INGEST_SOURCES.includes(source) && source !== "tonaton") {
      res.status(400).json({ ok: false, error: `Unknown source: ${source}`, allowed });
      return;
    }
    const result = await runIngestScrape(source, {
      emirates: req.body?.emirates,
      types: req.body?.types || ["rent", "sale"],
      maxPages: req.body?.maxPages != null ? Number(req.body.maxPages) : 1
    });
    res.json({ ok: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/ingest/scrape-all", rentIngestAuth, async (req, res) => {
  try {
    const result = await runGhanaScrapeAll({
      sources: Array.isArray(req.body?.sources) ? req.body.sources : undefined,
      emirates: req.body?.emirates,
      types: req.body?.types,
      maxPages: req.body?.maxPages != null ? Number(req.body.maxPages) : 2
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/ingest/stale", rentIngestAuth, async (req, res) => {
  try {
    const result = await runIngestStaleCleanup();
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Cron-friendly tick (also available at /api/cron/scrape as a dedicated function). */
app.all("/api/cron/scrape", rentIngestAuth, async (req, res) => {
  try {
    const result = await runGhanaScrapeTick({
      sources: Array.isArray(req.body?.sources) ? req.body.sources : undefined,
      emirates: Array.isArray(req.body?.emirates) ? req.body.emirates : undefined,
      types: Array.isArray(req.body?.types) ? req.body.types : undefined,
      maxPages: req.body?.maxPages != null ? Number(req.body.maxPages) : undefined
    });
    res.json({ ...result, configuredSources: ghanaIngestSources() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/session", rentRateLimit, (req, res) => {
  try {
    const session = createReSession(db, { userPhone: String(req.body?.userPhone || "") });
    res.json({ ok: true, sessionId: session.id });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/rent/session/:id", (req, res) => {
  try {
    const session = getReSession(db, req.params.id);
    if (!session) {
      res.status(404).json({ ok: false, error: "Session not found" });
      return;
    }
    res.json({
      ok: true,
      session: {
        id: session.id,
        criteria: session.criteria,
        status: session.status,
        messages: (session.messages || []).map((m) => ({
          role: m.role,
          body: m.body,
          at: m.at
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/chat", rentRateLimit, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!sessionId || !message) {
      res.status(400).json({ ok: false, error: "sessionId and message required" });
      return;
    }
    const result = await handleRentChat(db, {
      sessionId,
      message,
      userPhone: String(req.body?.userPhone || "")
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/transcribe", rentRateLimit, async (req, res) => {
  try {
    const result = await handleRentTranscribe({
      audioBase64: req.body?.audioBase64,
      mimeType: req.body?.mimeType || "audio/webm"
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/rent/browse", async (req, res) => {
  try {
    const criteria = {};
    if (req.query.type) criteria.transaction_type = String(req.query.type);
    if (req.query.emirate) criteria.emirate = String(req.query.emirate);
    if (req.query.beds) criteria.beds = Number(req.query.beds);
    if (req.query.max_price) criteria.max_price = Number(req.query.max_price);
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 20));
    const listingsRaw = await searchListingsStore(db, criteria, limit);
    const listings = isGhanaMarket()
      ? groupListingsByCluster(listingsRaw).map((g) => attachClusterMeta(g.listing, g.offers))
      : listingsRaw;
    res.json({
      ok: true,
      listings: listings.map((l) => formatListingCard(l)),
      store: isSupabaseEnabled() ? "supabase" : "sqlite"
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/rent/listings/:id", async (req, res) => {
  try {
    const listing = await getListingStore(db, req.params.id, { enrich: true });
    if (!listing) {
      res.status(404).json({ ok: false, error: "Listing not found" });
      return;
    }
    res.json({ ok: true, listing: formatListingDetail(listing) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/lead", rentRateLimit, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    const listingId = req.body?.listingId ? String(req.body.listingId) : null;
    const renterName = String(req.body?.renterName || "").trim();
    const renterPhone = String(req.body?.renterPhone || "").trim();
    const consent = Boolean(req.body?.consent);
    const notes = String(req.body?.notes || req.body?.viewingPreference || "").trim();
    if (!sessionId || !renterPhone) {
      res.status(400).json({ ok: false, error: "sessionId and renterPhone required" });
      return;
    }
    const result = await submitRentLead(db, {
      sessionId,
      listingId,
      renterName,
      renterPhone,
      consent,
      notes
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/viewing/confirm", rentRateLimit, async (req, res) => {
  try {
    const result = await confirmGhanaViewingPayment(db, {
      viewingId: req.body?.viewingId,
      reference: req.body?.reference
    });
    res.json({
      ok: true,
      viewingId: result.viewing.id,
      status: result.viewing.status,
      already: result.already,
      whatsappSent: result.whatsappSent,
      pin: process.env.JAB_RE_GH_DEV_PAY ? result.pin : undefined
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/viewing/redeem-pin", rentRateLimit, async (req, res) => {
  try {
    const parsed = parseAgentPinMessage(String(req.body?.text || ""));
    const pin = req.body?.pin || parsed.pin;
    const momo = req.body?.momo || parsed.momo;
    if (!pin || !momo) {
      res.status(400).json({ ok: false, error: "PIN and MoMo number required" });
      return;
    }
    const viewing = redeemViewingPin(db, { pin, momo, fromPhone: req.body?.fromPhone || "" });
    res.json({
      ok: true,
      viewing: {
        id: viewing.id,
        status: viewing.status,
        renter_name: viewing.renter_name,
        agent_momo: viewing.agent_momo,
        redeemed_at: viewing.redeemed_at
      }
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/owner-listing", rentRateLimit, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await submitOwnerListing(db, {
      ...body,
      photos: body.photoUrls || body.photos || body.photo_urls || []
    });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error || "Could not save listing" });
      return;
    }
    res.json({
      ok: true,
      listing: result.listing ? formatListingCard(result.listing) : null
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/billing/paystack/webhook", async (req, res) => {
  try {
    const event = req.body || {};
    const raw = Buffer.from(JSON.stringify(event));
    const sig = req.headers["x-paystack-signature"];
    if (process.env.PAYSTACK_SECRET_KEY && !verifyPaystackSignature(raw, sig)) {
      res.status(401).json({ ok: false, error: "invalid signature" });
      return;
    }
    const meta = event?.data?.metadata || {};
    if (meta.type === "ghana_viewing") {
      await handleGhanaPaystackWebhook(db, event);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/thanks", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>PropertyFinder Gh</title></head>
<body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto;background:#0a0a0a;color:#f5f5f5">
<h1>Payment received</h1>
<p>If GH₵100 went through, your viewing PIN is on its way. Give that PIN to the listing agent only when you see the room.</p>
<p><a href="/agent" style="color:#c9a227">Listing agent: enter PIN + MoMo</a></p>
<p><a href="/" style="color:#c9a227">Back to PropertyFinder Gh</a></p>
<script>
const q = new URLSearchParams(location.search);
const viewingId = q.get("viewing");
const reference = q.get("reference");
if (viewingId || reference) {
  fetch("/api/rent/viewing/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewingId, reference })
  }).catch(() => {});
}
</script>
</body></html>`);
});

app.get("/sw.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(PUBLIC_DIR, "sw.js"));
});

app.get("/manifest.webmanifest", (_req, res) => {
  res.setHeader("Content-Type", "application/manifest+json");
  res.sendFile(path.join(PUBLIC_DIR, "manifest.webmanifest"));
});

app.use(express.static(PUBLIC_DIR, { maxAge: process.env.VERCEL ? "1h" : 0, index: false }));

app.get(["/", "/index.html", "/agent", "/agent.html"], (req, res) => {
  const file = req.path.startsWith("/agent") ? "agent.html" : "index.html";
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(PUBLIC_DIR, file));
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.status(404).type("html").send("<!doctype html><title>PropertyFinder Gh</title><p>Not found. <a href=/>Home</a></p>");
});

export default app;

const isVercel = Boolean(process.env.VERCEL);
const isMain =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (!isVercel && isMain) {
  const port = Number(process.env.PORT || 3010);
  app.listen(port, () => {
    console.log(`PropertyFinder Gh standalone → http://127.0.0.1:${port}`);
  });
}
