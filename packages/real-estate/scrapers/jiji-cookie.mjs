/**
 * Free Jiji Cloudflare access via browser cookies.
 *
 * Jiji blocks datacenter IPs with a Managed Challenge. A free way to scrape
 * from Vercel is to paste a fresh browser cookie string:
 *
 *   1. Open https://jiji.com.gh in Chrome (your home network)
 *   2. DevTools → Application → Cookies → jiji.com.gh
 *   3. Copy cf_clearance (+ optional __cf_bm)
 *   4. Set env:
 *        JIJI_CF_CLEARANCE=...
 *        JIJI_USER_AGENT=<same UA as that Chrome>
 *      or a full header:
 *        JIJI_COOKIE=cf_clearance=...; __cf_bm=...
 *
 * Cookies usually last hours–days. GitHub Actions + FlareSolverr refreshes
 * inventory without cookies (see .github/workflows/fie-ghana-scrape.yml).
 */

export function jijiUserAgent() {
  return (
    String(process.env.JIJI_USER_AGENT || "").trim() ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );
}

/** Build Cookie header from JIJI_COOKIE or JIJI_CF_CLEARANCE. */
export function jijiCookieHeader() {
  const full = String(process.env.JIJI_COOKIE || "").trim();
  if (full) return full;
  const clearance = String(process.env.JIJI_CF_CLEARANCE || process.env.CF_CLEARANCE || "").trim();
  if (!clearance) return "";
  const parts = [`cf_clearance=${clearance}`];
  const bm = String(process.env.JIJI_CF_BM || "").trim();
  if (bm) parts.push(`__cf_bm=${bm}`);
  return parts.join("; ");
}

export function isJijiCookieConfigured() {
  return Boolean(jijiCookieHeader());
}

export function jijiFreeAccessAvailable() {
  const flare = String(process.env.FLARESOLVERR_URL || "").trim();
  const flareOn = flare && !/^(0|off|false)$/i.test(flare);
  return isJijiCookieConfigured() || flareOn;
}
