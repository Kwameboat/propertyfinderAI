/**
 * Opt-in live-pull result cache — reduces duplicate portal fetches under load.
 * Enable: JAB_RE_LIVE_CACHE_TTL_SEC=600 (default 0 = disabled, existing behavior).
 */

import { createHash } from "node:crypto";

const store = new Map();
let hits = 0;
let misses = 0;

export function liveCacheTtlSec() {
  return Math.max(0, Number(process.env.JAB_RE_LIVE_CACHE_TTL_SEC || 0));
}

export function isLiveCacheEnabled() {
  return liveCacheTtlSec() > 0;
}

function cacheKey(criteria = {}, options = {}) {
  const payload = {
    emirate: criteria.emirate || criteria.emirates?.[0] || "",
    emirates: (criteria.emirates || []).slice().sort(),
    beds: criteria.beds ?? null,
    transaction_type: criteria.transaction_type || "rent",
    community: criteria.community || "",
    max_price: criteria.max_price ?? null,
    min_price: criteria.min_price ?? null,
    property_type: criteria.property_type || "",
    limit: options.limit || 8
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

export function getLivePullFromCache(criteria = {}, options = {}) {
  if (!isLiveCacheEnabled()) return null;
  const key = cacheKey(criteria, options);
  const row = store.get(key);
  if (!row) {
    misses++;
    return null;
  }
  if (Date.now() > row.expires) {
    store.delete(key);
    misses++;
    return null;
  }
  hits++;
  return { ...row.value, cacheHit: true };
}

export function setLivePullCache(criteria = {}, options = {}, value = {}) {
  if (!isLiveCacheEnabled() || !value?.listings?.length) return;
  const ttlMs = liveCacheTtlSec() * 1000;
  const key = cacheKey(criteria, options);
  store.set(key, { expires: Date.now() + ttlMs, value });
  if (store.size > 500) {
    const oldest = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires).slice(0, 100);
    for (const [k] of oldest) store.delete(k);
  }
}

export function liveCacheStats() {
  return { enabled: isLiveCacheEnabled(), ttlSec: liveCacheTtlSec(), size: store.size, hits, misses };
}
