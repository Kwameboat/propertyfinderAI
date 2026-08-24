import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

/** Load /opt/jab-hub/.env or repo .env into process.env (non-destructive). */
export function loadHubEnv() {
  const candidates = [
    process.env.JAB_HUB_ENV_PATH,
    path.join(REPO_ROOT, ".env"),
    "/opt/jab-hub/.env"
  ].filter(Boolean);
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    try {
      const raw = readFileSync(envPath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
        const i = line.indexOf("=");
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
        if (k && v && !process.env[k]) process.env[k] = v;
      }
      return envPath;
    } catch {
      // try next
    }
  }
  return null;
}
