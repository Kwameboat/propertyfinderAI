import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import {
  openHubDb,
  listClients,
  getClient,
  upsertClient,
  updateClientSettings,
  listContacts,
  getContact,
  getContactByPhone,
  updateContact,
  upsertContact,
  createContact,
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaignStatus,
  updateCampaignParts,
  claimNextRecipient,
  markRecipient,
  nextRunningCampaign,
  listAgents,
  getAgent,
  getAgentByLogin,
  createAgent,
  updateAgent,
  hashAgentPassword,
  listLeads,
  getLead,
  assignLeadToAgent,
  updateLeadStatus,
  processHandoff,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  onboardClientStore,
  normalizeAgentType,
  buildOnboardSystemPrompt,
  getClientByStoreSlug,
  getClientByStoreToken,
  ensureClientStoreLinks,
  updateShopLocation,
  getAgencySettings,
  resolveAgencyInstanceName,
  isAgencyInstance,
  updateAgencySettings,
  ensureClientBillingEmail,
  listPointPackages,
  getPointPackage,
  createPointPackage,
  updatePointPackage,
  deletePointPackage,
  getPointRates,
  setPointRates,
  getWallet,
  listWallets,
  applyWalletDelta,
  listLedger,
  listPaystackPayments,
  completePaystackPayment,
  getPaystackPaymentByReference,
  rateKeyForCampaignPart,
  pointsForRate,
  ensureWallet,
  listKnowledgeDocs,
  upsertKnowledgeDoc,
  deleteKnowledgeDoc,
  listInboxThreads,
  listConversationMessages,
  listBookings,
  createBooking,
  addConversationMessage,
  markCustomerPaymentPaid,
  getCustomerPaymentByReference,
  listSocialAccounts,
  upsertSocialAccount,
  disconnectSocialAccount,
  listSocialPosts,
  getSocialPost,
  getSocialStats,
  SOCIAL_PLATFORMS,
  getHubPaths,
  listPlatformTenants,
  ensurePlatformSlug,
  buildPlatformWaLink,
  resolvePlatformSlugForClient
} from "../../packages/hub-db/index.mjs";
import { resolveAccountCreds, isAccountReady } from "../../packages/social-publishers/creds.mjs";
import {
  oauthAppConfig,
  signOAuthState,
  verifyOAuthState,
  buildOAuthAuthorizeUrl,
  completeOAuthForPlatform,
  publicHubBase
} from "../../packages/social-oauth.mjs";
import { geocodeAddress } from "../../packages/yango-delivery.mjs";
import {
  paystackConfigured,
  paystackPublicKey,
  verifyPaystackSignature,
  paystackVerify
} from "../../packages/paystack.mjs";
import { validatePlatformSlug } from "../../packages/platform-slug.mjs";
import {
  initClientTopup,
  notifyPaymentSuccess,
  maybeNotifyLowBalance
} from "../../packages/billing-notify.mjs";
import { telegramOpsConfigured } from "../../packages/telegram-notify.mjs";
import { metaDirectConfigured } from "../../packages/meta-cloud.mjs";
import {
  createSession as createReSession,
  getSession as getReSession,
  getReLead
} from "../../packages/hub-db/index.mjs";
import { handleRentChat, handleRentTranscribe, submitRentLead, formatListingCard, formatListingDetail } from "../../packages/real-estate/chat.mjs";
import { publicMarketConfig, isGhanaMarket } from "../../packages/real-estate/market.mjs";
import {
  confirmGhanaViewingPayment,
  handleGhanaPaystackWebhook,
  parseAgentPinMessage,
  redeemViewingPin,
  listViewings,
  createDeal,
  listViewingLedger,
  listDeals,
  getViewing
} from "../../packages/real-estate/ghana-viewing.mjs";
import {
  createSavedSearchFromSession,
  listSavedSearches,
  deactivateSavedSearch
} from "../../packages/real-estate/saved-search.mjs";
import { computeMoveInCost, parseMoveInCalculatorInput } from "../../packages/real-estate/calculators.mjs";
import { compareListingsByIds } from "../../packages/real-estate/listing-compare.mjs";
import { pullLiveListingsForChat } from "../../packages/real-estate/live-pull.mjs";
import { isSupabaseEnabled } from "../../packages/real-estate/supabase.mjs";
import {
  ingestListingBatch,
  runIngestScrape,
  runIngestScrapeAll,
  runIngestStaleCleanup,
  verifyIngestToken
} from "../../packages/real-estate/ingest.mjs";
import { INGEST_SOURCES, DEFAULT_N8N_SOURCES } from "../../packages/real-estate/scrape-runner.mjs";
import { searchListingsStore, getListingStore, getListingsStatus } from "../../packages/real-estate/listings-store.mjs";
import { runApifyIngest, ingestApifyItems } from "../../packages/real-estate/apify-ingest.mjs";
import { isZeroCostMode, getModeSummary, getN8nIngestSources } from "../../packages/real-estate/mode.mjs";
import { isApifyConfigured, propertyFinderUsesApify, isApifyPrimaryPortal } from "../../packages/real-estate/apify-client.mjs";
import {
  getReAdminDashboard,
  listReLeads,
  patchReLead,
  getReLeadById,
  listAdminListings,
  countAdminListings,
  getAdminListingById,
  patchAdminListing,
  listScrapeRuns,
  triggerPuppeteerIngest,
  triggerStaleCleanup,
  scrapeListingsFromUrl
} from "../../packages/real-estate/re-admin.mjs";
import {
  runPuppeteerIngestScrape,
  runPuppeteerIngestAll,
  PUPPETEER_INGEST_SOURCES,
  getPuppeteerCronSources,
  isPuppeteerScrapeEnabled
} from "../../packages/real-estate/puppeteer-scrape.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.JAB_HUB_PORT || 3000);
const SESSION_COOKIE = "jab_hub_session";
const MAX_RECIPIENTS_WARN = Number(process.env.JAB_HUB_MAX_RECIPIENTS_WARN || 50);
const HUB_PUBLIC_URL = process.env.JAB_HUB_PUBLIC_URL || "http://127.0.0.1:3000";
const RENT_HTTPS_ORIGIN = String(process.env.JAB_RENT_HTTPS_ORIGIN || "https://wa.jabdigitalhub.com")
  .trim()
  .replace(/\/$/, "");

const { db, paths } = openHubDb();
const sessions = new Map();
let workerBusy = false;
const ENV_PATH = path.join(REPO_ROOT, ".env");

async function readHubEnv() {
  try {
    const raw = await readFile(ENV_PATH, "utf8");
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const idx = line.indexOf("=");
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

async function setHubEnvValue(key, value) {
  let raw = "";
  try {
    raw = await readFile(ENV_PATH, "utf8");
  } catch {
    raw = "";
  }

  const lines = raw.split(/\r?\n/);
  let updated = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      updated = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!updated) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${value}`);
  }

  await writeFile(ENV_PATH, `${next.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

async function getBootstrap() {
  const hubEnv = await readHubEnv();
  // Expose selected .env keys to process.env for Paystack helpers, etc.
  for (const key of [
    "PAYSTACK_SECRET_KEY",
    "PAYSTACK_PUBLIC_KEY",
    "PAYSTACK_WEBHOOK_SECRET",
    "JAB_HUB_PUBLIC_URL",
    "JAB_AGENCY_INSTANCE",
    "META_APP_ID",
    "META_APP_SECRET",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
    "X_API_KEY",
    "X_API_SECRET",
    "LINKEDIN_CLIENT_ID",
    "LINKEDIN_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "JAB_SOCIAL_TOKEN_SECRET",
    "JAB_SOCIAL_PUBLIC_MEDIA_BASE"
  ]) {
    if (hubEnv[key] && !process.env[key]) process.env[key] = hubEnv[key];
  }
  if (hubEnv.JAB_HUB_PUBLIC_URL) {
    // keep module-level HUB_PUBLIC_URL in sync when set in .env
  }
  const evoApiUrl = (hubEnv.SERVER_URL || "http://localhost:8080").replace(/\/$/, "");
  const globalKey = hubEnv.AUTHENTICATION_API_KEY;
  const adminPassword = process.env.HUB_ADMIN_PASSWORD || hubEnv.HUB_ADMIN_PASSWORD || "jab-hub-admin";
  if (!globalKey) throw new Error("Missing AUTHENTICATION_API_KEY in .env");
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.JAB_HUB_PRODUCTION === "1";
  if (isProduction && adminPassword === "jab-hub-admin") {
    throw new Error("Set HUB_ADMIN_PASSWORD in production (.env)");
  }
  return { evoApiUrl, globalKey, adminPassword, hubEnv, isProduction };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? sessions.get(hashToken(token)) : null;
  if (!session) {
    if (req.path.startsWith("/api/")) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    res.redirect("/login");
    return;
  }
  req.session = session;
  next();
}

function requireAgency(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session?.role !== "agency") {
      if (req.path.startsWith("/api/")) {
        res.status(403).json({ ok: false, error: "agency only" });
        return;
      }
      res.redirect("/agent.html");
      return;
    }
    next();
  });
}

function requireAgent(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? sessions.get(hashToken(token)) : null;
  if (!session || session.role !== "agent") {
    if (req.path.startsWith("/api/")) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    res.redirect("/agent-login");
    return;
  }
  req.session = session;
  next();
}

function createSession(res, payload, { secure = false } = {}) {
  const token = randomBytes(24).toString("hex");
  sessions.set(hashToken(token), { ...payload, at: Date.now() });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: Boolean(secure),
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

/** Secure cookies only when Hub is actually served over HTTPS. */
function resolveSecureCookies(req) {
  const forced = String(process.env.JAB_HUB_SECURE_COOKIE || "").trim();
  if (forced === "1") return true;
  if (forced === "0") return false;
  const publicUrl = String(process.env.JAB_HUB_PUBLIC_URL || HUB_PUBLIC_URL || "").trim();
  if (publicUrl.startsWith("https://")) return true;
  const proto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  if (proto === "https") return true;
  if (req?.secure) return true;
  return false;
}

async function sendAgentLeadAlert({ instanceName, agent, lead, contact }) {
  const { evoApiUrl, globalKey } = await getBootstrap();
  const apiKey = await resolveInstanceToken(instanceName, evoApiUrl, globalKey);
  const hubLink = `${HUB_PUBLIC_URL}/agent.html`;
  const briefing = String(lead.summary || "").trim();
  const shortBrief =
    briefing.length > 900 ? `${briefing.slice(0, 880).trim()}…\n(Full briefing in Hub)` : briefing;
  const text = [
    `New lead assigned to you (${agent.name}).`,
    `Customer: ${contact?.push_name || "Unknown"} (${contact?.phone || lead.contact_phone || "—"})`,
    shortBrief ? `\nChat summary:\n${shortBrief}` : null,
    lead.last_customer_message ? `\nLast customer message: ${lead.last_customer_message}` : null,
    `\nContinue in Hub: ${hubLink}`
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`${evoApiUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ number: agent.phone, text, linkPreview: false })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`agent alert failed ${response.status}: ${body}`);
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchInstances(evoApiUrl, globalKey) {
  const response = await fetch(`${evoApiUrl}/instance/fetchInstances`, {
    headers: { apikey: globalKey }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`fetchInstances failed ${response.status}: ${body}`);
  const parsed = JSON.parse(body || "[]");
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.value)) return parsed.value;
  return [];
}

async function resolveInstanceToken(instanceName, evoApiUrl, globalKey) {
  const instances = await fetchInstances(evoApiUrl, globalKey);
  const match = instances.find((item) => item?.name === instanceName);
  if (!match?.token) throw new Error(`No token for instance ${instanceName}`);
  return match.token;
}

async function syncClientsFromEvolution() {
  const { evoApiUrl, globalKey } = await getBootstrap();
  const instances = await fetchInstances(evoApiUrl, globalKey);
  for (const item of instances) {
    if (!item?.name) continue;
    upsertClient(db, {
      instanceName: item.name,
      displayName: item.name,
      status: item.connectionStatus || item.status || null
    });
    const ownerPhone =
      item?.ownerJid ||
      item?.number ||
      item?.phone ||
      item?.profileName ||
      null;
    const digits = String(ownerPhone || "").replace(/@.*$/, "").replace(/\D/g, "");
    ensureClientBillingEmail(db, item.name, { phone: digits || null });
  }
  return listClients(db);
}

async function sendEvolutionPart({ evoApiUrl, apiKey, instance, number, part }) {
  if (part.type === "text") {
    const response = await fetch(`${evoApiUrl}/message/sendText/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number, text: part.body || "", linkPreview: false })
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`sendText failed ${response.status}: ${body}`);
    return body;
  }

  if (part.type === "image" || part.type === "pdf") {
    const filePath = part.filePath;
    if (!filePath) throw new Error(`Missing file for ${part.type}`);
    const bytes = await readFile(filePath);
    const media = bytes.toString("base64");
    const fileName = path.basename(filePath);
    const mediatype = part.type === "image" ? "image" : "document";
    const mimetype =
      part.mimetype ||
      (part.type === "image" ? "image/jpeg" : "application/pdf");

    const response = await fetch(`${evoApiUrl}/message/sendMedia/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        number,
        mediatype,
        mimetype,
        caption: part.caption || "",
        media,
        fileName
      })
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`sendMedia failed ${response.status}: ${body}`);
    return body;
  }

  throw new Error(`Unsupported part type: ${part.type}`);
}

async function processCampaignWorker() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const campaignRow = nextRunningCampaign(db);
    if (!campaignRow) return;

    const campaign = getCampaign(db, campaignRow.id);
    const recipient = claimNextRecipient(db, campaign.id);
    if (!recipient) {
      updateCampaignStatus(db, campaign.id, "done");
      return;
    }

    const contact = getContact(db, recipient.contact_id);
    if (!contact || contact.opted_out) {
      markRecipient(db, recipient.id, { status: "skipped", error: "opted_out_or_missing" });
      return;
    }

    try {
      const { evoApiUrl, globalKey } = await getBootstrap();
      const apiKey = await resolveInstanceToken(campaign.instance_name, evoApiUrl, globalKey);

      // Pre-check campaign point cost for this recipient (sum of parts)
      let campaignCost = 0;
      for (const part of campaign.parts) {
        campaignCost += pointsForRate(db, rateKeyForCampaignPart(part.type));
      }
      const wallet = ensureWallet(db, campaign.instance_name);
      if (campaignCost > 0 && (wallet.balance_points || 0) < campaignCost) {
        markRecipient(db, recipient.id, { status: "failed", error: "insufficient_points" });
        updateCampaignStatus(db, campaign.id, "paused");
        maybeNotifyLowBalance(db, {
          instanceName: campaign.instance_name,
          evoApiUrl,
          resolveToken: (name) => resolveInstanceToken(name, evoApiUrl, globalKey),
          publicBase: HUB_PUBLIC_URL,
          force: true
        }).catch(() => {});
        return;
      }

      for (const part of campaign.parts) {
        const rateKey = rateKeyForCampaignPart(part.type);
        const cost = pointsForRate(db, rateKey);
        if (cost > 0) {
          try {
            applyWalletDelta(db, {
              instanceName: campaign.instance_name,
              direction: "debit",
              amount: cost,
              reason: rateKey,
              ref: `campaign:${campaign.id}:recipient:${recipient.id}`,
              note: `Campaign send to ${contact.phone}`
            });
          } catch (error) {
            if (error.code === "insufficient_points") {
              markRecipient(db, recipient.id, { status: "failed", error: "insufficient_points" });
              updateCampaignStatus(db, campaign.id, "paused");
              return;
            }
            throw error;
          }
        }
        await sendEvolutionPart({
          evoApiUrl,
          apiKey,
          instance: campaign.instance_name,
          number: contact.phone,
          part
        });
        await sleep(800);
      }
      markRecipient(db, recipient.id, { status: "sent" });
      maybeNotifyLowBalance(db, {
        instanceName: campaign.instance_name,
        evoApiUrl,
        resolveToken: (name) => resolveInstanceToken(name, evoApiUrl, globalKey),
        publicBase: HUB_PUBLIC_URL
      }).catch(() => {});
    } catch (error) {
      markRecipient(db, recipient.id, { status: "failed", error: error.message });
    }

    const refreshed = getCampaign(db, campaign.id);
    if (refreshed.status === "paused") return;
    if (refreshed.stats.pending === 0) {
      updateCampaignStatus(db, campaign.id, "done");
      return;
    }

    await sleep(Number(campaign.delay_ms) || 4000);
  } finally {
    workerBusy = false;
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const dir = path.join(paths.uploadsDir, "tmp");
      await mkdir(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 }
});

async function saveUploadedProductImages(instanceName, files = []) {
  if (!files?.length) return [];
  const dir = path.join(paths.uploadsDir, "products", instanceName);
  await mkdir(dir, { recursive: true });
  const saved = [];
  for (const file of files) {
    const dest = path.join(dir, file.filename);
    await writeFile(dest, await readFile(file.path));
    saved.push(path.join("products", instanceName, file.filename).replace(/\\/g, "/"));
  }
  return saved;
}

const app = express();
app.set("trust proxy", 1);
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ ok: false, error: "invalid JSON body" });
    return;
  }
  next(err);
});
app.use(cookieParser());

/** PWA routes must beat express.static so Chrome gets SW-Allowed + correct manifest MIME. */
app.get("/manifest.webmanifest", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.type("application/manifest+json");
  res.sendFile(path.join(__dirname, "public", "manifest.webmanifest"));
});

app.get(["/rent-sw.js", "/sw.js"], (req, res) => {
  res.set("Service-Worker-Allowed", "/");
  res.set("Cache-Control", "no-cache");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "public", "rent-sw.js"));
});

app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use("/uploads", express.static(paths.uploadsDir));

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/agent-login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "agent-login.html"));
});

app.get(["/rent", "/gh"], (req, res) => {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = String(req.headers.host || "").split(":")[0];
  const httpsHost = RENT_HTTPS_ORIGIN.replace(/^https?:\/\//i, "").split("/")[0];
  const skipRedirect =
    !RENT_HTTPS_ORIGIN ||
    /^(off|0|false)$/i.test(RENT_HTTPS_ORIGIN) ||
    proto === "https" ||
    /^(localhost|127\.0\.0\.1)$/i.test(host) ||
    host === httpsHost;
  if (!skipRedirect) {
    const dest = new URL(req.path === "/gh" ? "/gh" : "/rent", RENT_HTTPS_ORIGIN);
    const q = req.originalUrl.indexOf("?");
    if (q >= 0) dest.search = req.originalUrl.slice(q);
    res.redirect(302, dest.toString());
    return;
  }
  res.sendFile(path.join(__dirname, "public", "rent.html"));
});

/** Simple rate limit for public rent API (per IP). */
const rentRate = new Map();
const RENT_RATE_WINDOW_MS = 60_000;
const RENT_RATE_MAX = Number(process.env.JAB_RE_RATE_MAX || 40);

function rentRateLimit(req, res, next) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
  const now = Date.now();
  const row = rentRate.get(ip) || { count: 0, reset: now + RENT_RATE_WINDOW_MS };
  if (now > row.reset) {
    row.count = 0;
    row.reset = now + RENT_RATE_WINDOW_MS;
  }
  row.count++;
  rentRate.set(ip, row);
  if (row.count > RENT_RATE_MAX) {
    res.status(429).json({ ok: false, error: "Too many requests — try again in a minute." });
    return;
  }
  next();
}

/** Rate limit Hub admin login (per IP). */
const loginRate = new Map();
const LOGIN_RATE_WINDOW_MS = 60_000;
const LOGIN_RATE_MAX = Number(process.env.JAB_HUB_LOGIN_RATE_MAX || 12);

function loginRateLimit(req, res, next) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
  const now = Date.now();
  const row = loginRate.get(ip) || { count: 0, reset: now + LOGIN_RATE_WINDOW_MS };
  if (now > row.reset) {
    row.count = 0;
    row.reset = now + LOGIN_RATE_WINDOW_MS;
  }
  row.count++;
  loginRate.set(ip, row);
  if (row.count > LOGIN_RATE_MAX) {
    res.status(429).json({ ok: false, error: "Too many login attempts — try again in a minute." });
    return;
  }
  next();
}

/** UAE Real Estate concierge — public PWA API (no agency auth). */
/** UAE Real Estate concierge — public PWA API (no agency auth). */
app.get("/api/rent/config", (req, res) => {
  res.json({ ok: true, market: publicMarketConfig() });
});

app.get("/gh/thanks", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>KeyFinder Ghana</title></head>
<body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">
<h1>Payment received</h1>
<p>If GH₵100 went through, your viewing PIN is being sent to WhatsApp. Give that PIN to the listing agent only when you see the room.</p>
<p><a href="/gh">Back to KeyFinder Ghana</a></p>
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

app.post("/api/rent/viewing/confirm", rentRateLimit, async (req, res) => {
  try {
    if (!isGhanaMarket()) {
      res.status(400).json({ ok: false, error: "Ghana market only" });
      return;
    }
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

app.post("/api/rent/viewing/redeem-pin", async (req, res) => {
  try {
    if (!isGhanaMarket()) {
      res.status(400).json({ ok: false, error: "Ghana market only" });
      return;
    }
    const token = String(req.headers["x-ingest-token"] || req.body?.token || "");
    const ingestOk = Boolean(process.env.JAB_RE_INGEST_TOKEN && token === process.env.JAB_RE_INGEST_TOKEN);
    if (!ingestOk && !req.session) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const parsed = parseAgentPinMessage(String(req.body?.text || ""));
    const pin = req.body?.pin || parsed.pin;
    const momo = req.body?.momo || parsed.momo;
    const viewing = redeemViewingPin(db, { pin, momo, fromPhone: req.body?.fromPhone || "" });
    res.json({ ok: true, viewing });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/re/viewings", requireAgency, (req, res) => {
  res.json({ ok: true, viewings: listViewings(db, { status: req.query.status, limit: 80 }) });
});

app.get("/api/admin/re/viewings/:id", requireAgency, (req, res) => {
  const viewing = getViewing(db, req.params.id);
  if (!viewing) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true, viewing, ledger: listViewingLedger(db, viewing.id) });
});

app.post("/api/admin/re/deals", requireAgency, (req, res) => {
  try {
    const deal = createDeal(db, {
      viewingId: req.body?.viewingId,
      agreedAmountGhs: req.body?.agreedAmountGhs
    });
    res.json({ ok: true, deal });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/re/deals", requireAgency, (req, res) => {
  res.json({ ok: true, deals: listDeals(db, { limit: 80 }) });
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
    const audioBase64 = String(req.body?.audioBase64 || "").trim();
    const mimeType = String(req.body?.mimeType || "audio/webm").trim();
    if (!audioBase64) {
      res.status(400).json({ ok: false, error: "audioBase64 required" });
      return;
    }
    if (audioBase64.length > 4_500_000) {
      res.status(400).json({ ok: false, error: "Audio too large (max ~3MB)" });
      return;
    }
    const result = await handleRentTranscribe({ audioBase64, mimeType });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

function rentIngestAuth(req, res, next) {
  const token = req.headers["x-ingest-token"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!verifyIngestToken(token)) {
    res.status(401).json({ ok: false, error: "Invalid or missing ingest token (X-Ingest-Token)" });
    return;
  }
  next();
}

app.post("/api/rent/ingest", rentIngestAuth, async (req, res) => {
  try {
    const listings = Array.isArray(req.body?.listings) ? req.body.listings : [];
    const source = String(req.body?.source || "n8n").trim();
    if (!listings.length) {
      res.status(400).json({ ok: false, error: "listings array required" });
      return;
    }
    const result = await ingestListingBatch(listings, { source });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/ingest/scrape", rentIngestAuth, async (req, res) => {
  try {
    const source = String(req.body?.source || req.query?.source || "").trim();
    if (!source) {
      res.status(400).json({ ok: false, error: "source required", allowed: INGEST_SOURCES });
      return;
    }
    if (!INGEST_SOURCES.includes(source)) {
      res.status(400).json({ ok: false, error: `Unknown source: ${source}`, allowed: INGEST_SOURCES });
      return;
    }
    const result = await runIngestScrape(source, {
      emirates: req.body?.emirates,
      types: req.body?.types,
      maxPages: req.body?.maxPages
    });
    res.json({ ok: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Opt-in Puppeteer bulk scrape → Supabase (does not replace HTML/Algolia cron). */
app.post("/api/rent/ingest/puppeteer", rentIngestAuth, async (req, res) => {
  try {
    if (!isPuppeteerScrapeEnabled()) {
      res.status(503).json({
        ok: false,
        error: "Puppeteer scrape disabled — set JAB_RE_PUPPETEER_SCRAPE=1",
        allowed: PUPPETEER_INGEST_SOURCES
      });
      return;
    }
    const all = req.body?.all === true || req.query?.all === "1";
    const maxPages = req.body?.maxPages != null ? Number(req.body.maxPages) : undefined;
    if (all) {
      const sources = Array.isArray(req.body?.sources)
        ? req.body.sources.filter((s) => PUPPETEER_INGEST_SOURCES.includes(s))
        : getPuppeteerCronSources();
      const result = await runPuppeteerIngestAll(sources, { maxPages, emirates: req.body?.emirates, types: req.body?.types });
      res.json({ ok: result.ok, ...result });
      return;
    }
    const source = String(req.body?.source || req.query?.source || "").trim();
    if (!source) {
      res.status(400).json({ ok: false, error: "source required", allowed: PUPPETEER_INGEST_SOURCES });
      return;
    }
    if (!PUPPETEER_INGEST_SOURCES.includes(source)) {
      res.status(400).json({ ok: false, error: `Unknown puppeteer source: ${source}`, allowed: PUPPETEER_INGEST_SOURCES });
      return;
    }
    const result = await runPuppeteerIngestScrape(source, {
      emirates: req.body?.emirates,
      types: req.body?.types,
      maxPages
    });
    res.json({ ok: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/ingest/apify", rentIngestAuth, async (req, res) => {
  try {
    const source = String(req.body?.source || "").trim();
    const normalized = source.replace(/_apify$/, "");
    const apifyPortal = isApifyPrimaryPortal(normalized);
    if (isZeroCostMode() && !apifyPortal) {
      res.status(503).json({
        ok: false,
        error: "$0 mode — Apify portals: bayut, propertyfinder, dubizzle (set APIFY_API_TOKEN)",
        mode: "zero_cost"
      });
      return;
    }
    if (!source) {
      res.status(400).json({ ok: false, error: "source required (bayut, propertyfinder, or dubizzle)" });
      return;
    }
    if (!["bayut", "propertyfinder", "dubizzle", "bayut_apify", "propertyfinder_apify", "dubizzle_apify"].includes(source)) {
      res.status(400).json({
        ok: false,
        error: "Apify ingest supports bayut, propertyfinder, dubizzle",
        source
      });
      return;
    }
    if (!isApifyConfigured()) {
      res.status(503).json({ ok: false, error: "APIFY_API_TOKEN not configured on Hub" });
      return;
    }
    const result = await runApifyIngest(source, {
      emirates: req.body?.emirates,
      purposes: req.body?.purposes,
      types: req.body?.types || req.body?.purposes,
      maxPages: req.body?.maxPages,
      maxResults: req.body?.maxResults,
      actorId: req.body?.actorId
    });
    res.json({ ok: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/ingest/apify-items", rentIngestAuth, async (req, res) => {
  try {
    const source = String(req.body?.source || "").trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!source || !items.length) {
      res.status(400).json({ ok: false, error: "source and items[] required" });
      return;
    }
    const result = await ingestApifyItems(source, items);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/ingest/scrape-all", rentIngestAuth, async (req, res) => {
  try {
    const sources = Array.isArray(req.body?.sources)
      ? req.body.sources.filter((s) => INGEST_SOURCES.includes(s))
      : DEFAULT_N8N_SOURCES;
    const result = await runIngestScrapeAll(sources, {
      emirates: req.body?.emirates,
      types: req.body?.types,
      maxPages: req.body?.maxPages
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

app.get("/api/rent/browse", async (req, res) => {
  try {
    const criteria = {};
    if (req.query.type) criteria.transaction_type = String(req.query.type);
    if (req.query.emirate) criteria.emirate = String(req.query.emirate);
    if (req.query.beds) criteria.beds = Number(req.query.beds);
    if (req.query.max_price) criteria.max_price = Number(req.query.max_price);
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 20));
    const listings = (await searchListingsStore(db, criteria, limit)).map((l) => formatListingCard(l));
    res.json({ ok: true, listings, store: isSupabaseEnabled() ? "supabase" : "sqlite" });
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

app.post("/api/rent/saved-search", rentRateLimit, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    const userPhone = String(req.body?.userPhone || "").trim();
    const label = String(req.body?.label || "").trim();
    if (!userPhone && !sessionId) {
      res.status(400).json({ ok: false, error: "userPhone or sessionId required" });
      return;
    }
    let criteria = req.body?.criteria || {};
    if (sessionId) {
      const session = getReSession(db, sessionId);
      if (!session) {
        res.status(404).json({ ok: false, error: "Session not found" });
        return;
      }
      criteria = { ...session.criteria, ...criteria };
    }
    const phone = userPhone || getReSession(db, sessionId)?.user_phone || "";
    const result = createSavedSearchFromSession(db, { userPhone: phone, criteria, label });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/rent/saved-search", rentRateLimit, async (req, res) => {
  try {
    const userPhone = String(req.query.phone || req.query.userPhone || "").trim();
    if (!userPhone) {
      res.status(400).json({ ok: false, error: "phone query required" });
      return;
    }
    const searches = listSavedSearches(db, userPhone, { activeOnly: true });
    res.json({ ok: true, searches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/rent/saved-search/:id", rentRateLimit, async (req, res) => {
  try {
    const userPhone = String(req.query.phone || "").trim();
    deactivateSavedSearch(db, req.params.id, userPhone);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/calculator/move-in", rentRateLimit, (req, res) => {
  try {
    const parsed = parseMoveInCalculatorInput(String(req.body?.message || ""));
    const annualRent = Number(req.body?.annualRent) || parsed.annualRent || 0;
    if (!annualRent) {
      res.status(400).json({ ok: false, error: "annualRent required (e.g. 120000)" });
      return;
    }
    const calc = computeMoveInCost({
      annualRent,
      agencyFeePercent: req.body?.agencyFeePercent,
      depositMonths: req.body?.depositMonths ?? parsed.depositMonths,
      includeChiller: req.body?.includeChiller ?? parsed.includeChiller
    });
    res.json({ ok: true, calculator: calc });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/compare", rentRateLimit, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    if (ids.length < 2) {
      res.status(400).json({ ok: false, error: "Provide 2–3 listing ids in ids[]" });
      return;
    }
    const result = await compareListingsByIds(db, ids, getListingStore);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({ ok: true, comparison: result.comparison });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/live-pull", rentRateLimit, async (req, res) => {
  try {
    const criteria = req.body?.criteria || {};
    const result = await pullLiveListingsForChat(db, criteria, {
      limit: Math.min(Number(req.body?.limit) || 8, 12),
      message: String(req.body?.message || ""),
      wantsPhotos: req.body?.wantsPhotos !== false,
      forcePortal: Boolean(req.body?.forcePortal)
    });
    res.json({
      ok: result.ok,
      listings: result.listings.map((l) => formatListingCard(l)),
      sources: result.sources,
      fetchedAt: result.fetchedAt
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Parse portal listing URL → full row with images (used by n8n live search). */
app.post("/api/rent/enrich-url", rentIngestAuth, async (req, res) => {
  try {
    const { runEnrichPortalUrl, runEnrichPortalUrls } = await import("../../packages/real-estate/enrich-url.mjs");
    const sync = req.body?.sync !== false;
    const urls = Array.isArray(req.body?.urls)
      ? req.body.urls.filter(Boolean)
      : req.body?.url
        ? [String(req.body.url).trim()]
        : [];

    if (!urls.length) {
      res.status(400).json({ ok: false, error: "url or urls[] required" });
      return;
    }

    if (urls.length === 1) {
      const result = await runEnrichPortalUrl(urls[0], {
        sync,
        partial: req.body?.partial || req.body?.listing || {}
      });
      res.status(result.ok ? 200 : 422).json(result);
      return;
    }

    const result = await runEnrichPortalUrls(
      urls.map((url) => ({ url, partial: req.body?.partials?.[url] })),
      { sync, concurrency: Math.min(Number(req.body?.concurrency) || 3, 5) }
    );
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/rent/ingest/matrix", rentIngestAuth, async (req, res) => {
  try {
    const { listMatrixJobs } = await import("../../packages/real-estate/scrape-matrix.mjs");
    const { fetchPortalLiveListings } = await import("../../packages/real-estate/portal-live.mjs");
    const { searchBayutAlgoliaRows } = await import("../../packages/real-estate/scrapers/bayut-algolia.mjs");
    const { enrichListingsWithImages } = await import("../../packages/real-estate/listing-images.mjs");

    const limit = Math.min(Math.max(Number(req.body?.limit) || 10, 1), 50);
    const emirate = req.body?.emirate || null;
    const types = req.body?.types || ["rent", "sale"];
    const emirates = emirate ? [emirate] : undefined;
    const jobs = listMatrixJobs({ emirates, types }).slice(0, limit);

    let found = 0;
    let upserted = 0;
    const errors = [];

    for (const job of jobs) {
      const criteria = {
        emirate: job.emirate,
        community: job.community,
        transaction_type: job.transaction_type
      };
      const rows = [];
      try {
        const bayut = await searchBayutAlgoliaRows(criteria, { maxPages: 1, maxHits: 15 });
        rows.push(...(bayut.rows || []));
      } catch (error) {
        errors.push(`${job.community}: ${error.message}`);
      }
      try {
        const portal = await fetchPortalLiveListings(criteria, { maxPages: 1, maxHits: 20 });
        rows.push(...(portal.rows || []));
      } catch (error) {
        errors.push(`${job.community} pf: ${error.message}`);
      }
      if (!rows.length) continue;
      let enriched = await enrichListingsWithImages(rows, { minImages: 1 });
      enriched = enriched.filter((r) => r.source_url && (r.images || []).length);
      found += enriched.length;
      const batch = await ingestListingBatch(enriched, { source: "matrix_ingest" });
      upserted += batch.upserted || 0;
    }

    res.json({ ok: true, jobs: jobs.length, found, upserted, errors: errors.slice(0, 10) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/rent/status", async (req, res) => {
  try {
    const status = await getListingsStatus(db);
    res.json({
      ok: true,
      listings: status.listings,
      sources: status.sources,
      store: status.store,
      platforms: getN8nIngestSources(),
      supabase: isSupabaseEnabled(),
      ingest: Boolean(process.env.JAB_RE_INGEST_TOKEN),
      market: publicMarketConfig(),
      apify: isApifyConfigured(),
      apifyFallback: isApifyConfigured() ? ["bayut", "dubizzle"] : [],
      mode: getModeSummary(),
      puppeteer: {
        enabled: isPuppeteerScrapeEnabled(),
        sources: PUPPETEER_INGEST_SOURCES,
        cronSources: getPuppeteerCronSources(),
        endpoint: "/api/rent/ingest/puppeteer"
      },
      livePull: {
        endpoint: "/api/rent/live-pull",
        enrichUrl: "/api/rent/enrich-url",
        matrixIngest: "/api/rent/ingest/matrix"
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/rent/lead/:id", (req, res) => {
  try {
    const lead = getReLead(db, req.params.id);
    if (!lead) {
      res.status(404).json({ ok: false, error: "Lead not found" });
      return;
    }
    res.json({ ok: true, lead });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Real Estate ERP — admin APIs (agency login required). */
app.get("/api/admin/re/dashboard", requireAgency, async (req, res) => {
  try {
    const dashboard = await getReAdminDashboard(db);
    res.json({ ok: true, ...dashboard });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/re/leads", requireAgency, async (req, res) => {
  try {
    const status = String(req.query.status || "").trim() || undefined;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const leads = await listReLeads(db, { status, limit, offset });
    res.json({ ok: true, leads });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/re/leads/:id", requireAgency, (req, res) => {
  try {
    const lead = getReLeadById(db, req.params.id);
    if (!lead) {
      res.status(404).json({ ok: false, error: "Lead not found" });
      return;
    }
    res.json({ ok: true, lead });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/admin/re/leads/:id", requireAgency, async (req, res) => {
  try {
    const lead = await patchReLead(db, req.params.id, {
      ops_status: req.body?.ops_status,
      notes: req.body?.notes,
      renter_name: req.body?.renter_name
    });
    if (!lead) {
      res.status(404).json({ ok: false, error: "Lead not found" });
      return;
    }
    res.json({ ok: true, lead });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/re/listings", requireAgency, async (req, res) => {
  try {
    const filters = {
      limit: req.query.limit,
      offset: req.query.offset,
      source: req.query.source,
      emirate: req.query.emirate,
      beds: req.query.beds,
      transaction_type: req.query.transaction_type,
      q: req.query.q
    };
    const [listings, total] = await Promise.all([
      listAdminListings(db, filters),
      countAdminListings(db, filters)
    ]);
    res.json({ ok: true, listings, total });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/re/listings/:id", requireAgency, async (req, res) => {
  try {
    const listing = await getAdminListingById(db, req.params.id);
    if (!listing) {
      res.status(404).json({ ok: false, error: "Listing not found" });
      return;
    }
    res.json({ ok: true, listing });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/admin/re/listings/:id", requireAgency, async (req, res) => {
  try {
    const listing = await patchAdminListing(db, req.params.id, {
      is_active: req.body?.is_active,
      listing_status: req.body?.listing_status
    });
    if (!listing) {
      res.status(404).json({ ok: false, error: "Listing not found" });
      return;
    }
    res.json({ ok: true, listing });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/re/scrape-runs", requireAgency, async (req, res) => {
  try {
    const runs = await listScrapeRuns({ limit: req.query.limit });
    res.json({ ok: true, runs });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/admin/re/scrape-url", requireAgency, async (req, res) => {
  try {
    if (!isPuppeteerScrapeEnabled()) {
      res.status(503).json({
        ok: false,
        error: "Set JAB_RE_PUPPETEER_SCRAPE=1 to enable portal URL pulls"
      });
      return;
    }
    const url = String(req.body?.url || "").trim();
    const maxListings = req.body?.maxListings;
    const maxPages = req.body?.maxPages;
    const dryRun = req.body?.dryRun === true;
    const result = await scrapeListingsFromUrl(url, { maxListings, maxPages, dryRun });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/admin/re/ingest/puppeteer", requireAgency, async (req, res) => {
  try {
    if (!isPuppeteerScrapeEnabled()) {
      res.status(503).json({ ok: false, error: "Puppeteer scrape disabled" });
      return;
    }
    const result = await triggerPuppeteerIngest({ maxPages: req.body?.maxPages });
    res.json({ ok: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/admin/re/ingest/stale", requireAgency, async (req, res) => {
  try {
    const result = await triggerStaleCleanup();
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/admin/re/ingest/apify", requireAgency, async (req, res) => {
  try {
    const source = String(req.body?.source || "propertyfinder").trim();
    if (!isApifyConfigured()) {
      res.status(503).json({ ok: false, error: "APIFY_API_TOKEN not configured" });
      return;
    }
    if (!["propertyfinder", "propertyfinder_apify", "bayut", "bayut_apify", "dubizzle", "dubizzle_apify"].includes(source)) {
      res.status(400).json({ ok: false, error: "source must be bayut, propertyfinder, or dubizzle" });
      return;
    }
    const result = await runApifyIngest(source, {
      emirates: req.body?.emirates,
      purposes: req.body?.purposes,
      types: req.body?.types || req.body?.purposes,
      maxPages: req.body?.maxPages,
      maxResults: req.body?.maxResults,
      actorId: req.body?.actorId
    });
    res.json({ ok: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/admin/re", requireAgency, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "re-admin.html"));
});

app.get("/admin/listings", requireAgency, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "re-admin.html"));
});

app.post("/api/login", loginRateLimit, async (req, res) => {
  try {
    const { adminPassword } = await getBootstrap();
    if (!safeEqual(req.body?.password || "", adminPassword)) {
      res.status(401).json({ ok: false, error: "invalid password" });
      return;
    }
    createSession(res, { role: "agency" }, { secure: resolveSecureCookies(req) });
    res.json({ ok: true, role: "agency" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/agent/login", (req, res) => {
  const login = String(req.body?.login || "").trim();
  const password = String(req.body?.password || "");
  const agent = getAgentByLogin(db, login);
  if (!agent || !agent.active || !safeEqual(hashAgentPassword(password), agent.password_hash)) {
    res.status(401).json({ ok: false, error: "invalid login" });
    return;
  }
  createSession(
    res,
    {
      role: "agent",
      agentId: agent.id,
      instanceName: agent.instance_name,
      name: agent.name
    },
    { secure: resolveSecureCookies(req) }
  );
  res.json({
    ok: true,
    role: "agent",
    agent: {
      id: agent.id,
      name: agent.name,
      instanceName: agent.instance_name,
      phone: agent.phone
    }
  });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) sessions.delete(hashToken(token));
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  if (req.session.role === "agent") {
    const agent = getAgent(db, req.session.agentId);
    res.json({
      ok: true,
      role: "agent",
      agent: agent
        ? {
            id: agent.id,
            name: agent.name,
            instanceName: agent.instance_name,
            phone: agent.phone
          }
        : null
    });
    return;
  }
  res.json({ ok: true, role: "agency" });
});

app.post("/api/settings/password", requireAgency, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (newPassword.length < 4) {
      res.status(400).json({ ok: false, error: "New password must be at least 4 characters" });
      return;
    }

    const { adminPassword } = await getBootstrap();
    if (!safeEqual(currentPassword, adminPassword)) {
      res.status(403).json({ ok: false, error: "Current password is incorrect" });
      return;
    }

    await setHubEnvValue("HUB_ADMIN_PASSWORD", newPassword);
    process.env.HUB_ADMIN_PASSWORD = newPassword;
    sessions.clear();
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/clients", requireAgency, async (req, res) => {
  try {
    const clients = await syncClientsFromEvolution();
    // Auto-create store links for any instance missing them
    for (const c of clients) {
      ensureClientStoreLinks(db, c.instance_name);
    }
    res.json({ ok: true, clients: listClients(db), publicBase: HUB_PUBLIC_URL });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message, clients: listClients(db), publicBase: HUB_PUBLIC_URL });
  }
});

app.post("/api/onboard", requireAgency, async (req, res) => {
  try {
    const instanceName = String(req.body?.instanceName || "").trim();
    const displayName = String(req.body?.displayName || "").trim();
    if (!instanceName || !displayName) {
      res.status(400).json({ ok: false, error: "instanceName and displayName required" });
      return;
    }
    const agentType = normalizeAgentType(req.body?.agentType || "store");
    const bookingUrl = String(req.body?.bookingUrl || "").trim();
    const customPrompt = String(req.body?.systemPrompt || "").trim();
    const systemPrompt = buildOnboardSystemPrompt({
      agentType,
      displayName,
      bookingUrl,
      customPrompt
    });

    let shopLat = req.body?.shopLat;
    let shopLng = req.body?.shopLng;
    const shopAddress = String(req.body?.shopAddress || "").trim();
    if (
      agentType === "store" &&
      shopAddress &&
      (shopLat == null || shopLng == null || shopLat === "" || shopLng === "")
    ) {
      try {
        const geo = await geocodeAddress(shopAddress);
        if (geo) {
          shopLat = geo.lat;
          shopLng = geo.lng;
        }
      } catch {
        /* optional geocode */
      }
    }
    const client = onboardClientStore(db, {
      instanceName,
      displayName,
      agentType,
      storeTagline: agentType === "store" ? req.body?.storeTagline || "" : "",
      whatsappOrderNumber: req.body?.whatsappOrderNumber || "",
      contactEmail: req.body?.contactEmail || "",
      contactPhone: req.body?.contactPhone || "",
      shopAddress: agentType === "store" ? shopAddress : "",
      shopLat: agentType === "store" ? shopLat : null,
      shopLng: agentType === "store" ? shopLng : null,
      bookingUrl: agentType === "booking" ? bookingUrl : bookingUrl || "",
      systemPrompt,
      leadDistribution: req.body?.leadDistribution || "auto",
      regenerateToken: Boolean(req.body?.regenerateToken)
    });

    const links = {};
    if (client.agent_type === "store" && client.store_slug && client.store_token) {
      links.storefront = `${HUB_PUBLIC_URL}/s/${client.store_slug}`;
      links.manage = `${HUB_PUBLIC_URL}/manage/${client.store_token}`;
    }
    res.json({
      ok: true,
      client,
      agentType: client.agent_type || agentType,
      links
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/clients/:instance/store-links", requireAgency, (req, res) => {
  try {
    const client = onboardClientStore(db, {
      instanceName: req.params.instance,
      displayName: req.body?.displayName,
      agentType: "store",
      storeTagline: req.body?.storeTagline,
      whatsappOrderNumber: req.body?.whatsappOrderNumber,
      regenerateToken: Boolean(req.body?.regenerateToken)
    });
    res.json({
      ok: true,
      client,
      links: {
        storefront: client.store_slug ? `${HUB_PUBLIC_URL}/s/${client.store_slug}` : null,
        manage: client.store_token ? `${HUB_PUBLIC_URL}/manage/${client.store_token}` : null
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ---- Public storefront + client manage (token) ----

app.get("/api/store/:slug", (req, res) => {
  const client = getClientByStoreSlug(db, req.params.slug);
  if (!client) {
    res.status(404).json({ ok: false, error: "store not found" });
    return;
  }
  const products = listProducts(db, client.instance_name, { activeOnly: true });
  res.json({
    ok: true,
    store: {
      name: client.display_name || client.instance_name,
      tagline: client.store_tagline || "",
      whatsapp: client.whatsapp_order_number || "",
      slug: client.store_slug
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      currency: p.currency,
      stock: p.stock,
      imageUrl: p.image_path ? `/uploads/${p.image_path}` : null,
      imageUrls: (p.images || []).map((img) => `/uploads/${img}`),
      inStock: p.stock === null || p.stock === undefined ? true : Number(p.stock) > 0
    }))
  });
});

app.get("/api/manage/:token", (req, res) => {
  const client = getClientByStoreToken(db, req.params.token);
  if (!client) {
    res.status(404).json({ ok: false, error: "invalid manage link" });
    return;
  }
  res.json({
    ok: true,
    store: {
      name: client.display_name || client.instance_name,
      tagline: client.store_tagline || "",
      whatsapp: client.whatsapp_order_number || "",
      slug: client.store_slug,
      storefront: `${HUB_PUBLIC_URL}/s/${client.store_slug}`,
      shopAddress: client.shop_address || "",
      shopLat: client.shop_lat ?? null,
      shopLng: client.shop_lng ?? null
    },
    products: listProducts(db, client.instance_name)
  });
});

app.patch("/api/manage/:token/shop", async (req, res) => {
  try {
    const client = getClientByStoreToken(db, req.params.token);
    if (!client) {
      res.status(404).json({ ok: false, error: "invalid manage link" });
      return;
    }
    let shopLat = req.body?.shopLat;
    let shopLng = req.body?.shopLng;
    const shopAddress = String(req.body?.shopAddress || "").trim();
    if (shopAddress && (shopLat == null || shopLng == null || shopLat === "" || shopLng === "")) {
      try {
        const geo = await geocodeAddress(shopAddress);
        if (geo) {
          shopLat = geo.lat;
          shopLng = geo.lng;
        }
      } catch {
        /* optional */
      }
    }
    const updated = updateShopLocation(db, client.instance_name, {
      shopAddress: shopAddress || null,
      shopLat: shopLat === "" || shopLat == null ? null : Number(shopLat),
      shopLng: shopLng === "" || shopLng == null ? null : Number(shopLng)
    });
    res.json({
      ok: true,
      store: {
        name: updated.display_name || updated.instance_name,
        shopAddress: updated.shop_address || "",
        shopLat: updated.shop_lat ?? null,
        shopLng: updated.shop_lng ?? null
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/manage/:token/products", upload.array("images", 8), async (req, res) => {
  try {
    const client = getClientByStoreToken(db, req.params.token);
    if (!client) {
      res.status(404).json({ ok: false, error: "invalid manage link" });
      return;
    }
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, error: "name required" });
      return;
    }
    const imagesPaths = await saveUploadedProductImages(client.instance_name, req.files || []);
    const product = createProduct(db, {
      instanceName: client.instance_name,
      name,
      sku: req.body?.sku || null,
      description: req.body?.description || "",
      price: req.body?.price,
      currency: req.body?.currency || "GHS",
      stock: req.body?.stock,
      imagesPaths,
      active: req.body?.active !== "0" && req.body?.active !== false
    });
    res.json({ ok: true, product });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/manage/:token/products/:id", upload.array("images", 8), async (req, res) => {
  try {
    const client = getClientByStoreToken(db, req.params.token);
    if (!client) {
      res.status(404).json({ ok: false, error: "invalid manage link" });
      return;
    }
    const existing = getProduct(db, Number(req.params.id));
    if (!existing || existing.instance_name !== client.instance_name) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }
    const uploaded = await saveUploadedProductImages(client.instance_name, req.files || []);
    const product = updateProduct(db, existing.id, {
      name: req.body?.name,
      sku: req.body?.sku,
      description: req.body?.description,
      price: req.body?.price !== undefined ? Number(req.body.price) : undefined,
      currency: req.body?.currency,
      stock: req.body?.stock !== undefined ? req.body.stock : undefined,
      imagesPaths: uploaded.length ? uploaded : undefined,
      appendImages: uploaded.length > 0,
      active:
        req.body?.active === undefined
          ? undefined
          : req.body.active === true || req.body.active === "1" || req.body.active === "true"
    });
    res.json({ ok: true, product });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/manage/:token/stock/:id", (req, res) => {
  const client = getClientByStoreToken(db, req.params.token);
  if (!client) {
    res.status(404).json({ ok: false, error: "invalid manage link" });
    return;
  }
  const existing = getProduct(db, Number(req.params.id));
  if (!existing || existing.instance_name !== client.instance_name) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  const product = updateProduct(db, existing.id, { stock: req.body?.stock });
  res.json({ ok: true, product });
});

app.delete("/api/manage/:token/products/:id", (req, res) => {
  const client = getClientByStoreToken(db, req.params.token);
  if (!client) {
    res.status(404).json({ ok: false, error: "invalid manage link" });
    return;
  }
  const existing = getProduct(db, Number(req.params.id));
  if (!existing || existing.instance_name !== client.instance_name) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  deleteProduct(db, existing.id);
  res.json({ ok: true });
});

app.get("/s/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "storefront.html"));
});

app.get("/manage/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "manage-store.html"));
});

app.patch("/api/clients/:instance", requireAgency, async (req, res) => {
  let shopLat = req.body?.shopLat;
  let shopLng = req.body?.shopLng;
  const shopAddress =
    req.body?.shopAddress === undefined ? undefined : String(req.body.shopAddress || "").trim();
  if (
    shopAddress &&
    (shopLat == null || shopLng == null || shopLat === "" || shopLng === "")
  ) {
    try {
      const geo = await geocodeAddress(shopAddress);
      if (geo) {
        shopLat = geo.lat;
        shopLng = geo.lng;
      }
    } catch {
      /* optional */
    }
  }
  const payload = {
    leadDistribution: req.body?.leadDistribution,
    handoffKeywords: req.body?.handoffKeywords,
    displayName: req.body?.displayName,
    storeTagline: req.body?.storeTagline,
    whatsappOrderNumber: req.body?.whatsappOrderNumber,
    contactEmail: req.body?.contactEmail,
    contactPhone: req.body?.contactPhone,
    shopAddress,
    shopLat,
    shopLng,
    systemPrompt: req.body?.systemPrompt,
    adminPhones: req.body?.adminPhones
  };
  // Digest / owner notify (stored via raw SQL if columns exist)
  let client = updateClientSettings(db, req.params.instance, payload);
  if (!client) {
    upsertClient(db, { instanceName: req.params.instance });
    client = updateClientSettings(db, req.params.instance, payload);
  }
  if (req.body?.platformWhatsappEnabled && isAgencyInstance(db, req.params.instance)) {
    res.status(400).json({ ok: false, error: "Agency instance cannot be a platform tenant." });
    return;
  }
  if (req.body?.platformSlug !== undefined && req.body.platformSlug !== "") {
    const slugCheck = validatePlatformSlug(req.body.platformSlug);
    if (!slugCheck.ok) {
      res.status(400).json({ ok: false, error: slugCheck.error });
      return;
    }
    req.body.platformSlug = slugCheck.slug;
  }
  const enablingPlatform =
    req.body?.platformWhatsappEnabled === true ||
    (req.body?.platformWhatsappEnabled === undefined &&
      Number(getClient(db, req.params.instance)?.platform_whatsapp_enabled));
  if (enablingPlatform) {
    const agencyPhone = resolveAgencyWaPhoneDigits(db);
    if (!agencyPhone) {
      res.status(400).json({
        ok: false,
        error: "Set JAB_AGENCY_WA_PHONE (or agency contact phone) before enabling platform WhatsApp."
      });
      return;
    }
    const existing = getClient(db, req.params.instance);
    const ownerDigits =
      req.body?.ownerNotifyPhone !== undefined
        ? String(req.body.ownerNotifyPhone || "").replace(/\D/g, "")
        : String(existing?.owner_notify_phone || existing?.contact_phone || "").replace(/\D/g, "");
    if (!ownerDigits) {
      res.status(400).json({
        ok: false,
        error: "Set owner notify phone before enabling platform WhatsApp."
      });
      return;
    }
  }
  if (
    req.body?.digestEnabled !== undefined ||
    req.body?.digestHour !== undefined ||
    req.body?.ownerNotifyPhone !== undefined ||
    req.body?.clientNotifyMode !== undefined ||
    req.body?.clientScoreNotifyThreshold !== undefined ||
    req.body?.clientOpsChannel !== undefined ||
    req.body?.platformWhatsappEnabled !== undefined ||
    req.body?.platformSlug !== undefined
  ) {
    try {
      db.prepare(
        `UPDATE clients SET
           digest_enabled = COALESCE(?, digest_enabled),
           digest_hour = COALESCE(?, digest_hour),
           owner_notify_phone = COALESCE(?, owner_notify_phone),
           client_notify_mode = COALESCE(?, client_notify_mode),
           client_score_notify_threshold = COALESCE(?, client_score_notify_threshold),
           client_ops_channel = COALESCE(?, client_ops_channel),
           platform_whatsapp_enabled = COALESCE(?, platform_whatsapp_enabled),
           platform_slug = COALESCE(?, platform_slug),
           updated_at = ?
         WHERE instance_name = ?`
      ).run(
        req.body?.digestEnabled === undefined ? null : req.body.digestEnabled ? 1 : 0,
        req.body?.digestHour === undefined || req.body?.digestHour === ""
          ? null
          : Math.min(23, Math.max(0, Number(req.body.digestHour))),
        req.body?.ownerNotifyPhone === undefined
          ? null
          : String(req.body.ownerNotifyPhone || "").replace(/\D/g, "") || null,
        req.body?.clientNotifyMode === undefined
          ? null
          : String(req.body.clientNotifyMode || "digest").slice(0, 32),
        req.body?.clientScoreNotifyThreshold === undefined || req.body?.clientScoreNotifyThreshold === ""
          ? null
          : Math.min(100, Math.max(0, Number(req.body.clientScoreNotifyThreshold))),
        req.body?.clientOpsChannel === undefined
          ? null
          : String(req.body.clientOpsChannel || "whatsapp").slice(0, 32),
        req.body?.platformWhatsappEnabled === undefined
          ? null
          : req.body.platformWhatsappEnabled ? 1 : 0,
        req.body?.platformSlug === undefined
          ? null
          : String(req.body.platformSlug || "").trim().toLowerCase().slice(0, 48) || null,
        Date.now(),
        req.params.instance
      );
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE")) {
        res.status(409).json({ ok: false, error: "Platform slug already in use by another tenant." });
        return;
      }
      throw error;
    }
    if (req.body?.platformWhatsappEnabled || req.body?.platformSlug !== undefined) {
      ensurePlatformSlug(db, req.params.instance);
    }
  }
  ensureClientStoreLinks(db, req.params.instance);
  res.json({ ok: true, client: getClient(db, req.params.instance) });
});

app.get("/api/clients/:instance/agents", requireAgency, (req, res) => {
  res.json({ ok: true, agents: listAgents(db, req.params.instance) });
});

app.post("/api/clients/:instance/agents", requireAgency, (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").replace(/\D/g, "");
    const login = String(req.body?.login || "").trim();
    const password = String(req.body?.password || "");
    if (!name || !phone || !login || password.length < 4) {
      res.status(400).json({ ok: false, error: "name, phone, login, password (min 4) required" });
      return;
    }
    upsertClient(db, { instanceName: req.params.instance });
    const agent = createAgent(db, {
      instanceName: req.params.instance,
      name,
      phone,
      login,
      password
    });
    const { password_hash, ...safe } = agent;
    res.json({ ok: true, agent: safe });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.patch("/api/agents/:id", requireAgency, (req, res) => {
  try {
    const agent = updateAgent(db, Number(req.params.id), {
      name: req.body?.name,
      phone: req.body?.phone,
      active: req.body?.active,
      password: req.body?.password
    });
    if (!agent) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }
    const { password_hash, ...safe } = agent;
    res.json({ ok: true, agent: safe });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/clients/:instance/leads", requireAgency, (req, res) => {
  const status = req.query.status || null;
  res.json({
    ok: true,
    leads: listLeads(db, { instanceName: req.params.instance, status })
  });
});

app.post("/api/leads/:id/assign", requireAgency, async (req, res) => {
  try {
    const agentId = Number(req.body?.agentId);
    const lead = assignLeadToAgent(db, Number(req.params.id), agentId);
    if (!lead) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }
    let alertError = null;
    try {
      await sendAgentLeadAlert({
        instanceName: lead.instance_name,
        agent: lead.agent,
        lead,
        contact: lead.contact
      });
    } catch (error) {
      alertError = error.message;
    }
    res.json({ ok: true, lead, alertError });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/leads/:id/status", requireAuth, (req, res) => {
  const lead = getLead(db, Number(req.params.id));
  if (!lead) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  if (req.session.role === "agent" && lead.agent_id !== req.session.agentId) {
    res.status(403).json({ ok: false, error: "not your lead" });
    return;
  }
  const status = String(req.body?.status || "");
  if (!["assigned", "active", "closed", "unassigned"].includes(status)) {
    res.status(400).json({ ok: false, error: "invalid status" });
    return;
  }
  res.json({ ok: true, lead: updateLeadStatus(db, lead.id, status) });
});

app.get("/api/agent/leads", requireAgent, (req, res) => {
  res.json({
    ok: true,
    leads: listLeads(db, { agentId: req.session.agentId })
  });
});

app.get("/api/agent/leads/:id", requireAgent, (req, res) => {
  const lead = getLead(db, Number(req.params.id));
  if (!lead || lead.agent_id !== req.session.agentId) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true, lead });
});

app.post("/api/agent/leads/:id/reply", requireAgent, async (req, res) => {
  try {
    const lead = getLead(db, Number(req.params.id));
    if (!lead || lead.agent_id !== req.session.agentId) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }
    const text = String(req.body?.text || "").trim();
    if (!text) {
      res.status(400).json({ ok: false, error: "text required" });
      return;
    }
    const { evoApiUrl, globalKey } = await getBootstrap();
    const apiKey = await resolveInstanceToken(lead.instance_name, evoApiUrl, globalKey);
    const number = lead.contact?.phone;
    const response = await fetch(`${evoApiUrl}/message/sendText/${encodeURIComponent(lead.instance_name)}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number, text, linkPreview: false })
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`sendText failed ${response.status}: ${body}`);

    if (lead.status === "assigned") updateLeadStatus(db, lead.id, "active");
    updateContact(db, lead.contact_id, { handoffStatus: "human_active" });
    if (lead.contact) {
      upsertContact(db, {
        instanceName: lead.instance_name,
        phone: lead.contact.phone,
        lastOutboundAt: Date.now()
      });
    }

    res.json({ ok: true, lead: getLead(db, lead.id) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/clients/:instance/contacts", requireAgency, (req, res) => {
  const contacts = listContacts(db, req.params.instance, { q: req.query.q || "" });
  res.json({ ok: true, instance: req.params.instance, contacts });
});

app.post("/api/clients/:instance/contacts", requireAgency, (req, res) => {
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  if (!phone) {
    res.status(400).json({ ok: false, error: "phone required" });
    return;
  }
  const contact = createContact(db, {
    instanceName: req.params.instance,
    phone,
    pushName: req.body?.pushName || null,
    notes: req.body?.notes || ""
  });
  res.json({ ok: true, contact });
});

app.patch("/api/contacts/:id", requireAgency, (req, res) => {
  const contact = updateContact(db, Number(req.params.id), {
    notes: req.body?.notes,
    optedOut: req.body?.optedOut,
    pushName: req.body?.pushName
  });
  if (!contact) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true, contact });
});

app.get("/api/clients/:instance/campaigns", requireAgency, (req, res) => {
  res.json({ ok: true, campaigns: listCampaigns(db, req.params.instance) });
});

app.get("/api/campaigns/:id", requireAgency, (req, res) => {
  const campaign = getCampaign(db, Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true, campaign });
});

app.get("/api/clients/:instance/products", requireAgency, (req, res) => {
  res.json({
    ok: true,
    products: listProducts(db, req.params.instance, { q: req.query.q || "" })
  });
});

app.post(
  "/api/clients/:instance/products",
  requireAgency,
  upload.array("images", 8),
  async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      if (!name) {
        res.status(400).json({ ok: false, error: "name required" });
        return;
      }
      upsertClient(db, { instanceName: req.params.instance });
      const imagesPaths = await saveUploadedProductImages(req.params.instance, req.files || []);
      const product = createProduct(db, {
        instanceName: req.params.instance,
        name,
        sku: req.body?.sku || null,
        description: req.body?.description || "",
        price: req.body?.price,
        currency: req.body?.currency || "GHS",
        stock: req.body?.stock,
        imagesPaths,
        active: req.body?.active !== "0" && req.body?.active !== false
      });
      res.json({ ok: true, product });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  }
);

app.patch(
  "/api/products/:id",
  requireAgency,
  upload.array("images", 8),
  async (req, res) => {
    try {
      const existing = getProduct(db, Number(req.params.id));
      if (!existing) {
        res.status(404).json({ ok: false, error: "not found" });
        return;
      }
      const uploaded = await saveUploadedProductImages(existing.instance_name, req.files || []);
      const product = updateProduct(db, existing.id, {
        name: req.body?.name,
        sku: req.body?.sku,
        description: req.body?.description,
        price: req.body?.price !== undefined ? Number(req.body.price) : undefined,
        currency: req.body?.currency,
        stock: req.body?.stock !== undefined ? req.body.stock : undefined,
        imagesPaths: uploaded.length ? uploaded : undefined,
        appendImages: uploaded.length > 0,
        active:
          req.body?.active === undefined
            ? undefined
            : req.body.active === true || req.body.active === "1" || req.body.active === "true"
      });
      res.json({ ok: true, product });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  }
);

app.delete("/api/products/:id", requireAgency, (req, res) => {
  const ok = deleteProduct(db, Number(req.params.id));
  if (!ok) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true });
});

app.post(
  "/api/clients/:instance/campaigns",
  requireAgency,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "pdf", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const instanceName = req.params.instance;
      if (isAgencyInstance(db, instanceName)) {
        res.status(400).json({
          ok: false,
          error:
            "Campaigns are disabled on the agency WhatsApp instance to reduce Meta ban risk. Use a client business number instead."
        });
        return;
      }
      const name = String(req.body?.name || "Campaign").trim() || "Campaign";
      const text = String(req.body?.text || "").trim();
      const delayMs = Number(req.body?.delayMs || 4000);
      let contactIds = [];
      try {
        contactIds = JSON.parse(req.body?.contactIds || "[]");
      } catch {
        contactIds = [];
      }
      if (!Array.isArray(contactIds)) contactIds = [];

      if (contactIds.length > MAX_RECIPIENTS_WARN) {
        // Still allow, but surface warning to UI.
      }

      const campaignDir = path.join(paths.uploadsDir, `draft-${Date.now()}`);
      await mkdir(campaignDir, { recursive: true });

      const parts = [];
      if (text) parts.push({ type: "text", body: text });

      const imageFile = req.files?.image?.[0];
      if (imageFile) {
        const dest = path.join(campaignDir, imageFile.filename);
        await writeFile(dest, await readFile(imageFile.path));
        parts.push({
          type: "image",
          filePath: dest,
          mimetype: imageFile.mimetype,
          caption: String(req.body?.imageCaption || "")
        });
      }

      const pdfFile = req.files?.pdf?.[0];
      if (pdfFile) {
        const dest = path.join(campaignDir, pdfFile.filename);
        await writeFile(dest, await readFile(pdfFile.path));
        parts.push({
          type: "pdf",
          filePath: dest,
          mimetype: pdfFile.mimetype || "application/pdf",
          caption: String(req.body?.pdfCaption || "")
        });
      }

      if (!parts.length) {
        res.status(400).json({ ok: false, error: "Add text, image, or PDF" });
        return;
      }
      if (!contactIds.length) {
        res.status(400).json({ ok: false, error: "Select at least one contact" });
        return;
      }

      const campaign = createCampaign(db, {
        instanceName,
        name,
        parts,
        delayMs,
        contactIds: contactIds.map(Number)
      });

      // Move upload folder under campaign id for clarity.
      const finalDir = path.join(paths.uploadsDir, String(campaign.id));
      await mkdir(finalDir, { recursive: true });
      const remapped = [];
      for (const part of campaign.parts) {
        if (!part.filePath) {
          remapped.push(part);
          continue;
        }
        const nextPath = path.join(finalDir, path.basename(part.filePath));
        await writeFile(nextPath, await readFile(part.filePath));
        remapped.push({ ...part, filePath: nextPath });
      }
      updateCampaignParts(db, campaign.id, remapped);

      res.json({
        ok: true,
        campaign: getCampaign(db, campaign.id),
        warning:
          contactIds.length >= MAX_RECIPIENTS_WARN
            ? `Large broadcast (${contactIds.length}). Baileys mass-send can get numbers banned — keep throttle high.`
            : null
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  }
);

app.post("/api/campaigns/:id/start", requireAgency, (req, res) => {
  const campaign = getCampaign(db, Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  if (isAgencyInstance(db, campaign.instance_name)) {
    res.status(400).json({
      ok: false,
      error: "Campaigns are disabled on the agency WhatsApp instance to reduce Meta ban risk."
    });
    return;
  }
  if (!campaign.parts?.length || !campaign.recipients?.length) {
    res.status(400).json({ ok: false, error: "Campaign needs parts and recipients" });
    return;
  }
  updateCampaignStatus(db, campaign.id, "running");
  res.json({ ok: true, campaign: getCampaign(db, campaign.id) });
});

app.post("/api/campaigns/:id/pause", requireAgency, (req, res) => {
  const campaign = getCampaign(db, Number(req.params.id));
  if (!campaign) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  updateCampaignStatus(db, campaign.id, "paused");
  res.json({ ok: true, campaign: getCampaign(db, campaign.id) });
});

// ---- Platform WhatsApp (multi-tenant on agency line) ----

function resolveAgencyWaPhoneDigits(db) {
  const fromEnv = String(process.env.JAB_AGENCY_WA_PHONE || process.env.JAB_HUB_ADMIN_PHONE || "").replace(/\D/g, "");
  if (fromEnv) return fromEnv;
  const agency = getClient(db, resolveAgencyInstanceName(db));
  const fromClient = String(agency?.contact_phone || agency?.whatsapp_order_number || "").replace(/\D/g, "");
  return fromClient || "";
}

app.get("/api/platform/overview", requireAgency, (req, res) => {
  const agencyInstance = resolveAgencyInstanceName(db);
  const agencyPhone = resolveAgencyWaPhoneDigits(db);
  const tenants = listPlatformTenants(db, { agencyInstanceName: agencyInstance }).map((t) => {
    const slug = t.platform_slug || resolvePlatformSlugForClient(t);
    return {
      instance_name: t.instance_name,
      display_name: t.display_name,
      platform_slug: slug,
      owner_notify_phone: t.owner_notify_phone || t.contact_phone || null,
      wa_link: buildPlatformWaLink({
        agencyPhoneDigits: agencyPhone,
        slug,
        displayName: t.display_name || t.instance_name
      })
    };
  });
  res.json({
    ok: true,
    agencyInstance,
    agencyPhone: agencyPhone ? `+${agencyPhone}` : null,
    agencyWaLink: agencyPhone
      ? `https://wa.me/${agencyPhone}?text=${encodeURIComponent("Hi JAB — I want WhatsApp AI for my business")}`
      : null,
    tenants,
    instructions: [
      "Enable Platform WhatsApp on each client in Team tab (no WABA needed).",
      "Share the client's wa.me link in ads — customers message the agency Meta line.",
      "Reply JAB on that line for agency sales / onboarding."
    ]
  });
});

// ---- Finance / Paystack ----

app.get("/api/billing/overview", requireAgency, (req, res) => {
  const settings = getAgencySettings(db);
  const publicBase = String(HUB_PUBLIC_URL).replace(/\/$/, "");
  res.json({
    ok: true,
    paystackConfigured: paystackConfigured(),
    paystackPublicKey: paystackPublicKey() ? `${paystackPublicKey().slice(0, 8)}…` : "",
    paystackWebhookUrl: `${publicBase}/api/billing/paystack/webhook`,
    paystackCallbackUrl: `${publicBase}/billing/thanks`,
    publicBase,
    settings,
    agencyInstance: resolveAgencyInstanceName(db),
    telegramOpsConfigured: telegramOpsConfigured(),
    metaCloudConfigured: metaDirectConfigured(),
    agencyAiUnlimited: true,
    rates: getPointRates(db),
    packages: listPointPackages(db),
    wallets: listWallets(db),
    payments: listPaystackPayments(db, { limit: 40 })
  });
});

app.patch("/api/billing/settings", requireAgency, (req, res) => {
  const settings = updateAgencySettings(db, {
    agencyInstanceName: req.body?.agencyInstanceName,
    lowBalanceThreshold: req.body?.lowBalanceThreshold,
    notifyLowBalance: req.body?.notifyLowBalance,
    notifyPayment: req.body?.notifyPayment,
    signupBonusPoints: req.body?.signupBonusPoints ?? req.body?.signup_bonus_points,
    agencyNotifyMode: req.body?.agencyNotifyMode ?? req.body?.agency_notify_mode,
    agencyScoreNotifyThreshold:
      req.body?.agencyScoreNotifyThreshold ?? req.body?.agency_score_notify_threshold,
    agencyOpsChannel: req.body?.agencyOpsChannel ?? req.body?.agency_ops_channel,
    agencyDigestIncludeHubUrl: req.body?.agencyDigestIncludeHubUrl ?? req.body?.agency_digest_include_hub_url
  });
  res.json({ ok: true, settings });
});

app.put("/api/billing/rates", requireAgency, (req, res) => {
  const rates = setPointRates(db, req.body?.rates || req.body || {});
  res.json({ ok: true, rates });
});

app.get("/api/billing/packages", requireAgency, (req, res) => {
  res.json({ ok: true, packages: listPointPackages(db) });
});

app.post("/api/billing/packages", requireAgency, (req, res) => {
  try {
    const pkg = createPointPackage(db, {
      name: req.body?.name,
      priceGhs: req.body?.priceGhs ?? req.body?.price_ghs,
      points: req.body?.points,
      bonusPoints: req.body?.bonusPoints ?? req.body?.bonus_points,
      active: req.body?.active !== false,
      sortOrder: req.body?.sortOrder ?? req.body?.sort_order,
      durationDays: req.body?.durationDays ?? req.body?.duration_days ?? 30,
      isTopup: req.body?.isTopup ?? req.body?.is_topup ?? false
    });
    res.json({ ok: true, package: pkg });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.patch("/api/billing/packages/:id", requireAgency, (req, res) => {
  const pkg = updatePointPackage(db, Number(req.params.id), {
    name: req.body?.name,
    priceGhs: req.body?.priceGhs ?? req.body?.price_ghs,
    points: req.body?.points,
    bonusPoints: req.body?.bonusPoints ?? req.body?.bonus_points,
    active: req.body?.active,
    sortOrder: req.body?.sortOrder ?? req.body?.sort_order,
    durationDays: req.body?.durationDays ?? req.body?.duration_days,
    isTopup: req.body?.isTopup ?? req.body?.is_topup
  });
  if (!pkg) {
    res.status(404).json({ ok: false, error: "package not found" });
    return;
  }
  res.json({ ok: true, package: pkg });
});

app.delete("/api/billing/packages/:id", requireAgency, (req, res) => {
  const ok = deletePointPackage(db, Number(req.params.id));
  res.json({ ok });
});

app.get("/api/billing/wallets/:instance", requireAgency, (req, res) => {
  const wallet = getWallet(db, req.params.instance);
  const ledger = listLedger(db, req.params.instance, { limit: 80 });
  res.json({ ok: true, wallet, ledger });
});

app.post("/api/billing/wallets/:instance/adjust", requireAgency, (req, res) => {
  try {
    const direction = req.body?.direction === "debit" ? "debit" : "credit";
    const amount = Math.abs(Number(req.body?.amount) || 0);
    if (!amount) {
      res.status(400).json({ ok: false, error: "amount required" });
      return;
    }
    const result = applyWalletDelta(db, {
      instanceName: req.params.instance,
      direction,
      amount,
      reason: "admin_adjust",
      note: String(req.body?.note || "").slice(0, 300) || "Manual adjust"
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.code === "insufficient_points" ? 400 : 500).json({
      ok: false,
      error: error.message,
      balance: error.balance,
      needed: error.needed
    });
  }
});

app.post("/api/billing/paystack/init", requireAgency, async (req, res) => {
  try {
    const instanceName = String(req.body?.instanceName || "").trim();
    if (!instanceName) {
      res.status(400).json({ ok: false, error: "instanceName required" });
      return;
    }
    const { evoApiUrl, globalKey } = await getBootstrap();
    const result = await initClientTopup(db, {
      instanceName,
      packageId: req.body?.packageId ? Number(req.body.packageId) : null,
      custom: req.body?.custom || null,
      email: req.body?.email || null,
      publicBase: HUB_PUBLIC_URL,
      evoApiUrl,
      resolveToken: (name) => resolveInstanceToken(name, evoApiUrl, globalKey),
      notifyWhatsApp: req.body?.notifyWhatsApp !== false
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/api/billing/paystack/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyPaystackSignature(raw, signature)) {
      res.status(401).json({ ok: false, error: "invalid signature" });
      return;
    }
    const event = req.body;
    if (event?.event === "charge.success") {
      const ghana = await handleGhanaPaystackWebhook(db, event);
      if (ghana.handled) {
        res.json({ ok: true, ghana: true });
        return;
      }
      const reference = event?.data?.reference;
      const cust = getCustomerPaymentByReference(db, reference);
      if (cust) {
        markCustomerPaymentPaid(db, reference);
        res.json({ ok: true });
        return;
      }
      const result = completePaystackPayment(db, reference, {
        paystackId: event?.data?.id != null ? String(event.data.id) : null
      });
      if (result.ok && (!result.already || result.pendingCredit)) {
        try {
          const { evoApiUrl, globalKey } = await getBootstrap();
          await notifyPaymentSuccess(db, {
            instanceName: result.payment.instance_name,
            points: result.payment.points,
            balance: result.wallet?.balance_points,
            evoApiUrl,
            resolveToken: (name) => resolveInstanceToken(name, evoApiUrl, globalKey),
            payment: result.payment,
            pendingCredit: Boolean(result.pendingCredit)
          });
        } catch (error) {
          console.error(
            JSON.stringify({ at: new Date().toISOString(), paymentNotifyError: error.message })
          );
        }
      }
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/billing/paystack/verify/:reference", requireAgency, async (req, res) => {
  try {
    const data = await paystackVerify(req.params.reference);
    if (data.status === "success") {
      const cust = getCustomerPaymentByReference(db, req.params.reference);
      if (cust) {
        markCustomerPaymentPaid(db, req.params.reference);
        res.json({ ok: true, paystack: data, customerPayment: true });
        return;
      }
      const result = completePaystackPayment(db, req.params.reference, {
        paystackId: data.id != null ? String(data.id) : null
      });
      res.json({ ok: true, paystack: data, ...result });
      return;
    }
    res.json({ ok: true, paystack: data, credited: false });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/billing/customer-pay/callback", (req, res) => {
  res.type("html").send(
    `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
     <h1>Payment received</h1><p>You can close this tab and return to WhatsApp.</p></body></html>`
  );
});

// ---- Inbox / Knowledge / Bookings ----

app.get("/api/clients/:instance/inbox", requireAgency, (req, res) => {
  res.json({ ok: true, threads: listInboxThreads(db, req.params.instance) });
});

app.get("/api/clients/:instance/inbox/:phone", requireAgency, (req, res) => {
  const phone = String(req.params.phone || "").replace(/\D/g, "");
  const contact = getContactByPhone(db, req.params.instance, phone);
  const messages = listConversationMessages(db, req.params.instance, phone);
  res.json({ ok: true, contact, messages });
});

app.post("/api/clients/:instance/inbox/:phone/reply", requireAgency, async (req, res) => {
  try {
    const phone = String(req.params.phone || "").replace(/\D/g, "");
    const text = String(req.body?.text || "").trim();
    if (!phone || !text) {
      res.status(400).json({ ok: false, error: "phone and text required" });
      return;
    }
    const { evoApiUrl, globalKey } = await getBootstrap();
    const apiKey = await resolveInstanceToken(req.params.instance, evoApiUrl, globalKey);
    const response = await fetch(
      `${evoApiUrl}/message/sendText/${encodeURIComponent(req.params.instance)}`,
      {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ number: phone, text })
      }
    );
    const body = await response.text();
    if (!response.ok) throw new Error(`sendText failed ${response.status}: ${body.slice(0, 200)}`);
    const contact = getContactByPhone(db, req.params.instance, phone);
    if (contact) {
      updateContact(db, contact.id, { handoffStatus: "human_active" });
    }
    addConversationMessage(db, {
      instanceName: req.params.instance,
      phone,
      contactId: contact?.id || null,
      direction: "out",
      role: "human",
      body: text
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/clients/:instance/inbox/:phone/release", requireAgency, (req, res) => {
  const phone = String(req.params.phone || "").replace(/\D/g, "");
  const contact = getContactByPhone(db, req.params.instance, phone);
  if (!contact) {
    res.status(404).json({ ok: false, error: "contact not found" });
    return;
  }
  updateContact(db, contact.id, { handoffStatus: "ai" });
  res.json({ ok: true, contact: getContact(db, contact.id) });
});

app.get("/api/clients/:instance/knowledge", requireAgency, (req, res) => {
  res.json({ ok: true, docs: listKnowledgeDocs(db, req.params.instance, { activeOnly: false }) });
});

app.post("/api/clients/:instance/knowledge", requireAgency, (req, res) => {
  const doc = upsertKnowledgeDoc(db, {
    instanceName: req.params.instance,
    id: req.body?.id || null,
    title: req.body?.title,
    content: req.body?.content,
    active: req.body?.active !== false
  });
  res.json({ ok: true, doc });
});

app.delete("/api/clients/:instance/knowledge/:id", requireAgency, (req, res) => {
  deleteKnowledgeDoc(db, Number(req.params.id), req.params.instance);
  res.json({ ok: true });
});

app.get("/api/clients/:instance/bookings", requireAgency, (req, res) => {
  res.json({ ok: true, bookings: listBookings(db, req.params.instance) });
});

app.post("/api/clients/:instance/bookings", requireAgency, (req, res) => {
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  const startsAt = Date.parse(req.body?.startsAt || "");
  if (!phone || !Number.isFinite(startsAt)) {
    res.status(400).json({ ok: false, error: "phone and startsAt required" });
    return;
  }
  const contact = getContactByPhone(db, req.params.instance, phone);
  const booking = createBooking(db, {
    instanceName: req.params.instance,
    phone,
    contactId: contact?.id || null,
    customerName: req.body?.customerName || "",
    serviceName: req.body?.serviceName || "Appointment",
    startsAt,
    notes: req.body?.notes || ""
  });
  res.json({ ok: true, booking });
});

// ---- Agency social media (not per-client) ----

app.get("/api/social/overview", requireAgency, async (req, res) => {
  try {
    await getBootstrap();
  } catch {
    /* env may already be loaded */
  }
  const accounts = listSocialAccounts(db);
  const oauth = oauthAppConfig();
  const platforms = SOCIAL_PLATFORMS.map((platform) => {
    const creds = resolveAccountCreds(db, platform);
    return {
      platform,
      handle: creds.handle,
      ready: isAccountReady(creds),
      status: creds.status,
      oauthReady: Boolean(oauth[platform]?.ready)
    };
  });
  res.json({
    ok: true,
    stats: getSocialStats(db),
    accounts,
    platforms,
    oauth,
    publicUrl: publicHubBase(),
    dryRun: String(process.env.JAB_SOCIAL_DRY_RUN || "1") !== "0",
    publicMediaBase:
      process.env.JAB_SOCIAL_PUBLIC_MEDIA_BASE || `${HUB_PUBLIC_URL.replace(/\/$/, "")}/media/social`
  });
});

app.post("/api/social/apps", requireAgency, async (req, res) => {
  try {
    const body = req.body || {};
    const map = [
      ["META_APP_ID", body.metaAppId],
      ["META_APP_SECRET", body.metaAppSecret],
      ["TIKTOK_CLIENT_KEY", body.tiktokClientKey],
      ["TIKTOK_CLIENT_SECRET", body.tiktokClientSecret],
      ["X_CLIENT_ID", body.xClientId],
      ["X_CLIENT_SECRET", body.xClientSecret],
      ["LINKEDIN_CLIENT_ID", body.linkedinClientId],
      ["LINKEDIN_CLIENT_SECRET", body.linkedinClientSecret],
      ["GOOGLE_CLIENT_ID", body.googleClientId],
      ["GOOGLE_CLIENT_SECRET", body.googleClientSecret],
      ["JAB_HUB_PUBLIC_URL", body.publicUrl]
    ];
    for (const [key, val] of map) {
      if (val !== undefined && String(val).trim() !== "") {
        await setHubEnvValue(key, String(val).trim());
        process.env[key] = String(val).trim();
      }
    }
    res.json({ ok: true, oauth: oauthAppConfig(), publicUrl: publicHubBase() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/social/oauth/:platform/start", requireAgency, async (req, res) => {
  try {
    await getBootstrap();
    let platform = String(req.params.platform || "").toLowerCase();
    if (platform === "instagram" || platform === "facebook") {
      // shared Meta login
    }
    const state = signOAuthState({
      ts: Date.now(),
      platform,
      role: "agency"
    });
    res.cookie("jab_social_oauth", state, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
      path: "/"
    });
    const url = buildOAuthAuthorizeUrl(platform, state);
    res.redirect(url);
  } catch (error) {
    res.redirect(`/?tab=social&social_error=${encodeURIComponent(error.message)}`);
  }
});

app.get("/api/social/oauth/:platform/callback", async (req, res) => {
  try {
    await getBootstrap();
    const platform = String(req.params.platform || "").toLowerCase();
    const err = req.query.error_description || req.query.error;
    if (err) throw new Error(String(err));
    const code = String(req.query.code || "");
    if (!code) throw new Error("Missing OAuth code");
    const stateRaw = String(req.query.state || req.cookies?.jab_social_oauth || "");
    const state = verifyOAuthState(stateRaw);
    if (!state) throw new Error("OAuth state expired — try Connect again");
    const connected = await completeOAuthForPlatform(db, platform, code);
    res.clearCookie("jab_social_oauth", { path: "/" });
    const names = connected.map((c) => `${c.platform}:${c.handle}`).join(", ");
    res.redirect(`/?tab=social&social_ok=${encodeURIComponent(names || "connected")}`);
  } catch (error) {
    res.redirect(`/?tab=social&social_error=${encodeURIComponent(error.message)}`);
  }
});

app.get("/api/social/posts", requireAgency, (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  res.json({ ok: true, posts: listSocialPosts(db, { status, limit: Number(req.query.limit) || 40 }) });
});

app.get("/api/social/posts/:id", requireAgency, (req, res) => {
  const post = getSocialPost(db, Number(req.params.id));
  if (!post) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true, post });
});

app.post("/api/social/accounts", requireAgency, (req, res) => {
  try {
    const platform = String(req.body?.platform || "").toLowerCase();
    if (!SOCIAL_PLATFORMS.includes(platform)) {
      res.status(400).json({ ok: false, error: "unsupported platform" });
      return;
    }
    const account = upsertSocialAccount(db, {
      platform,
      handle: req.body?.handle || "",
      externalId: req.body?.externalId || "",
      accessToken: req.body?.accessToken || "",
      status: req.body?.status || "connected",
      meta: {
        pageId: req.body?.pageId || "",
        igUserId: req.body?.igUserId || "",
        openId: req.body?.openId || "",
        accessSecret: req.body?.accessSecret || "",
        apiKey: req.body?.apiKey || "",
        apiSecret: req.body?.apiSecret || "",
        authorUrn: req.body?.authorUrn || "",
        refreshToken: req.body?.refreshToken || "",
        clientId: req.body?.clientId || "",
        clientSecret: req.body?.clientSecret || ""
      }
    });
    res.json({
      ok: true,
      account: {
        id: account.id,
        platform: account.platform,
        handle: account.handle,
        status: account.status,
        connected: account.status === "connected"
      }
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/social/accounts/:id", requireAgency, (req, res) => {
  disconnectSocialAccount(db, Number(req.params.id));
  res.json({ ok: true });
});

/** Public media for Instagram Graph (image_url / video_url). */
app.get("/media/social/:file", (req, res) => {
  const name = path.basename(String(req.params.file || ""));
  if (!name || name.includes("..")) {
    res.status(400).end();
    return;
  }
  const socialDir = paths.socialDir || getHubPaths().socialDir;
  const filePath = path.join(socialDir, name);
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).end();
  });
});

app.get("/billing/thanks", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Payment received</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1a1612;background:#f6f0e7}
h1{font-size:1.4rem}p{color:#6f6458;line-height:1.5}</style></head>
<body><h1>Payment received</h1>
<p>Thanks — Paystack confirmed your payment. Points will appear on your JAB Hub wallet shortly (usually within a few seconds).</p>
<p>You can close this window.</p></body></html>`);
});

app.get("/", requireAuth, (req, res) => {
  if (req.session?.role === "agent") {
    res.redirect("/agent.html");
    return;
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/agent.html", requireAgent, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "agent.html"));
});

setInterval(() => {
  processCampaignWorker().catch((error) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), campaignWorkerError: error.message }));
  });
}, 2000);

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`JAB Hub agency dashboard listening on http://127.0.0.1:${PORT}`);
  console.log(`SQLite: ${paths.dbPath}`);
  try {
    await getBootstrap();
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), bootstrapError: error.message }));
  }
  try {
    const agencyInstance = resolveAgencyInstanceName(db);
    const tenants = listPlatformTenants(db, { agencyInstanceName: agencyInstance });
    if (tenants.length) {
      const agencyPhone = resolveAgencyWaPhoneDigits(db);
      const warnings = [];
      if (!agencyPhone) warnings.push("JAB_AGENCY_WA_PHONE unset — wa.me links will be empty");
      if (!String(process.env.META_WABA_ACCESS_TOKEN || "").trim()) {
        warnings.push("META_WABA_ACCESS_TOKEN unset — agency line cannot reply");
      }
      if (!String(process.env.META_APP_SECRET || "").trim()) {
        warnings.push("META_APP_SECRET unset — Meta webhook POST signatures not verified");
      }
      if (warnings.length) {
        console.warn(
          JSON.stringify({
            at: new Date().toISOString(),
            platformProductionWarnings: warnings,
            tenantCount: tenants.length
          })
        );
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), platformStartupCheck: error.message }));
  }
  try {
    await syncClientsFromEvolution();
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), clientSyncError: error.message }));
  }
});
