/**
 * Saved-search alerts — match new listings to user criteria.
 */

import {
  createSavedSearch,
  listSavedSearches,
  listActiveSavedSearches,
  deactivateSavedSearch,
  deactivateAllSavedSearches,
  touchSavedSearchNotification,
  normalizeRePhone
} from "../hub-db/real-estate.mjs";
import { searchListingsStore } from "./listings-store.mjs";
import { formatListingCard } from "./chat.mjs";

export { createSavedSearch, listSavedSearches, deactivateSavedSearch, deactivateAllSavedSearches };

export function userWantsSavedSearch(text = "") {
  const lower = String(text || "").toLowerCase();
  return /\b(alert me|save search|notify me|watch this|set alert|new matches|keep me posted)\b/.test(lower);
}

export function userWantsListAlerts(text = "") {
  return /\b(my alerts|list alerts|show alerts)\b/i.test(String(text || ""));
}

export function userWantsStopAlerts(text = "") {
  return /\b(stop alerts|cancel alerts|turn off alerts|unsubscribe alerts)\b/i.test(String(text || ""));
}

export function createSavedSearchFromSession(db, { userPhone, criteria = {}, label = "" } = {}) {
  const phone = normalizeRePhone(userPhone);
  if (!phone) throw new Error("Phone required");
  const existing = listSavedSearches(db, phone, { activeOnly: true });
  const key = JSON.stringify(normalizeCriteria(criteria));
  const dup = existing.find((s) => JSON.stringify(normalizeCriteria(s.criteria)) === key);
  if (dup) return { saved: dup, duplicate: true };
  const saved = createSavedSearch(db, { userPhone: phone, criteria, label });
  return { saved, duplicate: false };
}

function normalizeCriteria(c = {}) {
  return {
    transaction_type: c.transaction_type || null,
    emirates: (c.emirates || []).slice().sort(),
    community: c.community || null,
    beds: c.beds != null ? Number(c.beds) : null,
    max_price: c.max_price != null ? Number(c.max_price) : null,
    min_price: c.min_price != null ? Number(c.min_price) : null,
    furnished: c.furnished ?? null,
    property_type: c.property_type || null
  };
}

export async function matchListingsForCriteria(db, criteria = {}, { limit = 10, sinceMs = 0 } = {}) {
  const rows = await searchListingsStore(db, criteria, Math.min(limit, 20));
  if (!sinceMs) return rows;
  return rows.filter((l) => {
    const scraped = l.scraped_at ? new Date(l.scraped_at).getTime() : 0;
    return scraped >= sinceMs;
  });
}

export async function runSavedSearchAlerts(db, { sinceHours = 24, maxPerUser = 5 } = {}) {
  const sinceMs = Date.now() - Math.max(Number(sinceHours) || 24, 1) * 3600 * 1000;
  const searches = listActiveSavedSearches(db);
  const alerts = [];

  for (const search of searches) {
    const lastNotify = search.last_notified_at || search.created_at || 0;
    const windowStart = Math.max(sinceMs, lastNotify - 3600 * 1000);
    const matches = await matchListingsForCriteria(db, search.criteria, {
      limit: maxPerUser,
      sinceMs: windowStart
    });
    if (!matches.length) continue;
    alerts.push({
      searchId: search.id,
      userPhone: search.user_phone,
      label: search.label,
      criteria: search.criteria,
      listings: matches.slice(0, maxPerUser).map(formatListingCard),
      count: matches.length
    });
    touchSavedSearchNotification(db, search.id, matches.length);
  }

  return alerts;
}

export function formatAlertWhatsApp(alert) {
  const lines = (alert.listings || []).slice(0, 3).map((l, i) => {
    const price =
      l.transaction_type === "rent"
        ? `AED ${Number(l.price_aed).toLocaleString()}/yr`
        : `AED ${Number(l.price_aed).toLocaleString()}`;
    return `${i + 1}. ${l.title} — ${price}${l.source_url ? `\n   ${l.source_url}` : ""}`;
  });
  return [
    `New matches for "${alert.label}" (${alert.count} found):`,
    "",
    ...lines,
    alert.count > 3 ? `\n+ ${alert.count - 3} more — reply "show more" or open /rent` : "",
    "",
    'Reply "stop alerts" to unsubscribe.'
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatSavedSearchListWhatsApp(searches = []) {
  if (!searches.length) {
    return 'No active alerts. After searching, reply "alert me" to get WhatsApp notifications when new listings match.';
  }
  const lines = searches.map((s, i) => `${i + 1}. ${s.label}`);
  return ["Your active property alerts:", "", ...lines, "", 'Reply "stop alerts" to turn them all off.'].join("\n");
}
