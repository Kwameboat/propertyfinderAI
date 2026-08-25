/**
 * FlareSolverr — solve Cloudflare so Jiji (and similar) APIs can be read from a datacenter IP.
 * Default: http://127.0.0.1:8191 (localhost-only Docker publish).
 */

export function flareSolverrUrl() {
  return String(process.env.FLARESOLVERR_URL || "http://127.0.0.1:8191").trim().replace(/\/$/, "");
}

export function isFlareSolverrEnabled() {
  const raw = String(process.env.FLARESOLVERR_URL ?? "http://127.0.0.1:8191").trim();
  if (!raw || raw === "0" || raw === "off" || raw === "false") return false;
  return true;
}

export function cookieHeader(cookies = []) {
  return (Array.isArray(cookies) ? cookies : [])
    .map((c) => `${c.name}=${c.value}`)
    .filter(Boolean)
    .join("; ");
}

export function jsonFromFlareHtml(html = "") {
  const text = String(html || "");
  const pre = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const raw = pre ? pre[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("FlareSolverr response had no JSON body");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

export async function flareSolverrGet(url, { timeoutMs = 60000 } = {}) {
  if (!isFlareSolverrEnabled()) {
    throw new Error("FlareSolverr is off");
  }
  const response = await fetch(`${flareSolverrUrl()}/v1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cmd: "request.get",
      url: String(url),
      maxTimeout: timeoutMs
    }),
    signal: AbortSignal.timeout(timeoutMs + 20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status !== "ok" || !data.solution) {
    throw new Error(data.message || `FlareSolverr HTTP ${response.status}`);
  }
  return data.solution;
}
