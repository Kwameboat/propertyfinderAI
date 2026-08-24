/**
 * Platform tenant slug validation — shared by Hub API and router.
 */

export const RESERVED_PLATFORM_SLUGS = new Set([
  "jab",
  "menu",
  "ref",
  "agency",
  "admin",
  "help",
  "start",
  "stop",
  "shop",
  "tenant",
  "platform"
]);

/** Lowercase alphanumeric + hyphens; 2–48 chars; no leading/trailing hyphen. */
export const PLATFORM_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function slugifyPlatform(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function validatePlatformSlug(slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return { ok: false, error: "Platform slug is required." };
  if (s.length < 2 || s.length > 48) {
    return { ok: false, error: "Platform slug must be 2–48 characters." };
  }
  if (!PLATFORM_SLUG_RE.test(s)) {
    return { ok: false, error: "Use lowercase letters, numbers, and hyphens only." };
  }
  if (RESERVED_PLATFORM_SLUGS.has(s)) {
    return { ok: false, error: `Slug "${s}" is reserved.` };
  }
  return { ok: true, slug: s };
}

export function normalizePlatformSlug(value) {
  const direct = validatePlatformSlug(value);
  if (direct.ok) return direct.slug;
  const derived = slugifyPlatform(value);
  const fallback = validatePlatformSlug(derived);
  return fallback.ok ? fallback.slug : derived.slice(0, 48);
}
