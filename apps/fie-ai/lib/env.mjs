/**
 * Force PropertyFinder Gh Ghana market for the standalone Vercel app.
 * Call before importing real-estate modules that read JAB_RE_MARKET.
 */
export function applyFieStandaloneEnv() {
  process.env.JAB_RE_MARKET = "GH";
  process.env.JAB_FIE_STANDALONE = "1";
  if (!process.env.JAB_HUB_DATA_DIR) {
    process.env.JAB_HUB_DATA_DIR = process.env.VERCEL
      ? "/tmp/fie-ai"
      : pathJoinHome(".fie-ai-data");
  }
  if (!process.env.JAB_RE_GH_DEV_PAY && !process.env.PAYSTACK_SECRET_KEY) {
    process.env.JAB_RE_GH_DEV_PAY = "1";
  }
  // Faster ticks on serverless (still polite to portals).
  if (!process.env.JAB_RE_SCRAPE_DELAY_MS) {
    process.env.JAB_RE_SCRAPE_DELAY_MS = process.env.VERCEL ? "800" : "1500";
  }
  if (!process.env.JAB_RE_SCRAPE_EMIRATES) {
    process.env.JAB_RE_SCRAPE_EMIRATES = "Accra,Kumasi,Tema";
  }
  // Don't assume local FlareSolverr on Vercel; Jiji uses JIJI_CF_CLEARANCE instead.
  if (process.env.VERCEL && process.env.FLARESOLVERR_URL == null) {
    process.env.FLARESOLVERR_URL = "off";
  }
}

function pathJoinHome(subdir) {
  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  return `${home.replace(/\/$/, "")}/${subdir}`;
}
