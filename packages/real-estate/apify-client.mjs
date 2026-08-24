/**
 * Minimal Apify REST client (no npm dependency).
 * Docs: https://docs.apify.com/api/v2
 */

const API_BASE = "https://api.apify.com/v2";

export function isApifyConfigured() {
  return Boolean(String(process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN || "").trim());
}

/** All seven UAE emirates for portal scrapes. */
export const ALL_UAE_EMIRATES = [
  "Dubai",
  "Abu Dhabi",
  "Sharjah",
  "Ajman",
  "Ras Al Khaimah",
  "Fujairah",
  "Umm Al Quwain"
];

export function defaultApifyEmirates() {
  const raw = String(process.env.JAB_RE_APIFY_EMIRATES || "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...ALL_UAE_EMIRATES];
}

/** Normalize rent/sale (or buy) from API / n8n body. */
export function normalizeApifyTransactionTypes(input) {
  const raw = Array.isArray(input) ? input : input ? [input] : ["rent", "sale"];
  return [...new Set(raw.map((t) => {
    const s = String(t).toLowerCase();
    if (s === "buy" || s === "for-sale" || s === "sale") return "sale";
    return "rent";
  }))];
}

export function bayutPurposeFromType(type) {
  return type === "sale" ? "for-sale" : "for-rent";
}

export function propertyFinderPurposeFromType(type) {
  return type === "sale" ? "buy" : "rent";
}

/** Bayut, Property Finder, Dubizzle use Apify when token is set (Emaar/Damac stay HTML). */
export function isApifyPrimaryPortal(source = "") {
  if (!isApifyConfigured()) return false;
  const s = String(source).replace(/_apify$/, "").replace(/_puppeteer$/, "");
  return s === "bayut" || s === "propertyfinder" || s === "dubizzle";
}

export function isApifyFreeMode() {
  const v = String(process.env.JAB_RE_APIFY_FREE_MODE ?? "1").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function apifyMaxPages() {
  const cap = isApifyFreeMode() ? 1 : 20;
  return Math.min(Math.max(Number(process.env.JAB_RE_APIFY_MAX_PAGES || (isApifyFreeMode() ? 1 : 2)), 1), cap);
}

export function apifyMaxResults() {
  const cap = isApifyFreeMode() ? 30 : 500;
  return Math.min(Math.max(Number(process.env.JAB_RE_APIFY_MAX_RESULTS || (isApifyFreeMode() ? 30 : 80)), 5), cap);
}

export function apifyWaitForFinishSec() {
  return Math.min(Math.max(Number(process.env.JAB_RE_APIFY_WAIT_SEC || 600), 60), 900);
}

/** Free tier: datacenter proxy. Paid: residential AE. */
export function apifyProxyConfiguration() {
  if (isApifyFreeMode()) {
    return { useApifyProxy: true };
  }
  return { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "AE" };
}

function apifyToken() {
  const token = String(process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN || "").trim();
  if (!token) throw new Error("APIFY_API_TOKEN not set");
  return token;
}

function actorPath(actorId) {
  return String(actorId || "")
    .trim()
    .replace(/\//g, "~");
}

export async function runApifyActor(actorId, input = {}, options = {}) {
  const token = apifyToken();
  const waitForFinish = Math.min(Math.max(Number(options.waitForFinishSec || 600), 30), 3600);
  const path = actorPath(actorId);
  const url = `${API_BASE}/acts/${encodeURIComponent(path)}/runs?token=${encodeURIComponent(token)}&waitForFinish=${waitForFinish}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((waitForFinish + 30) * 1000)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apify run ${actorId}: ${response.status} ${text.slice(0, 300)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Apify run ${actorId}: invalid JSON response`);
  }

  const data = payload.data || payload;
  if (data.status && !["SUCCEEDED", "READY", "RUNNING"].includes(data.status) && data.status !== "SUCCEEDED") {
    if (data.status === "FAILED" || data.status === "TIMED-OUT" || data.status === "ABORTED") {
      throw new Error(`Apify run ${actorId} ${data.status}`);
    }
  }

  return data;
}

export async function fetchApifyDatasetItems(datasetId, { limit = 5000, offset = 0 } = {}) {
  const token = apifyToken();
  const params = new URLSearchParams({
    token,
    format: "json",
    clean: "true",
    limit: String(Math.min(limit, 10000)),
    offset: String(offset)
  });

  const response = await fetch(`${API_BASE}/datasets/${encodeURIComponent(datasetId)}/items?${params}`, {
    signal: AbortSignal.timeout(120000)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apify dataset ${datasetId}: ${response.status} ${text.slice(0, 200)}`);
  }

  try {
    const items = JSON.parse(text);
    return Array.isArray(items) ? items : [];
  } catch {
    throw new Error(`Apify dataset ${datasetId}: invalid JSON`);
  }
}

export async function runApifyActorAndGetItems(actorId, input = {}, options = {}) {
  const run = await runApifyActor(actorId, input, options);
  const datasetId = run.defaultDatasetId;
  if (!datasetId) return { run, items: [] };

  const items = await fetchApifyDatasetItems(datasetId, { limit: options.limit || 5000 });
  return { run, items };
}

export function apifyBayutActorId() {
  return String(process.env.JAB_RE_APIFY_BAYUT_ACTOR || "memo23/apify-bayut-scraper").trim();
}

/** memo23/sian actors use startUrls; rigelbytes uses purpose/location fields. */
export function apifyBayutUsesStartUrls(actorId = apifyBayutActorId()) {
  const id = String(actorId).toLowerCase();
  return (
    id.includes("memo23") ||
    id.includes("sian.agency") ||
    id.includes("parseforge") ||
    String(process.env.JAB_RE_APIFY_BAYUT_INPUT || "").toLowerCase() === "starturls"
  );
}

export function apifyPropertyFinderActorId() {
  return String(process.env.JAB_RE_APIFY_PF_ACTOR || "benthepythondev/propertyfinder-scraper").trim();
}

/** When true, Property Finder ingest uses Apify instead of HTML/Puppeteer. */
export function propertyFinderUsesApify() {
  if (!isApifyConfigured()) return false;
  const mode = String(process.env.JAB_RE_PF_SCRAPER || "apify").trim().toLowerCase();
  return mode !== "html" && mode !== "puppeteer";
}

export function buildPropertyFinderApifyInput({
  locations = ["Dubai"],
  purpose = "rent",
  maxResults,
  searchUrls = [],
  useResidentialProxy
} = {}) {
  const tx = String(purpose).toLowerCase();
  return {
    locations: Array.isArray(locations) ? locations.filter(Boolean) : [String(locations)],
    purpose: tx === "sale" || tx === "buy" ? "buy" : "rent",
    searchUrls: Array.isArray(searchUrls) ? searchUrls.filter(Boolean) : [],
    maxResults: maxResults || apifyMaxResults(),
    useResidentialProxy: useResidentialProxy ?? !isApifyFreeMode()
  };
}

export function apifyDubizzleActorId() {
  return String(process.env.JAB_RE_APIFY_DUBIZZLE_ACTOR || "benthepythondev/dubizzle-scraper").trim();
}
