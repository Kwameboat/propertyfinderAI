/**
 * Gemini live property discovery — finds real listings with photos, saves to Supabase.
 */

import { createHash } from "node:crypto";
import { resolveGeminiApiKey, GEMINI_API_BASE, GEMINI_MODEL } from "./gemini.mjs";
import { prepareListing } from "./ingest.mjs";
import { batchSyncListingsToSupabaseWithReturn, isSupabaseEnabled } from "./supabase.mjs";

function parseJsonFromText(text = "") {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : parsed?.listings || parsed?.items || [];
  } catch {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return [];
      }
    }
    return [];
  }
}

function idFromUrl(url = "") {
  const u = String(url);
  const bayut = u.match(/details-(\d+)/i);
  if (bayut?.[1]) return bayut[1];
  const pf = u.match(/propertyfinder\.ae\/[^/]+\/(\d+)/i);
  if (pf?.[1]) return pf[1];
  const dub = u.match(/(\d{6,})/);
  if (dub?.[1]) return dub[1];
  return createHash("sha256").update(u).digest("hex").slice(0, 16);
}

function inferSource(url = "", hint = "") {
  const u = String(url).toLowerCase();
  if (/bayut\.com/.test(u)) return "bayut";
  if (/propertyfinder\.ae/.test(u)) return "propertyfinder";
  if (/dubizzle\.com/.test(u)) return "dubizzle";
  const h = String(hint).toLowerCase();
  if (h.includes("bayut")) return "bayut";
  if (h.includes("propertyfinder") || h.includes("property finder")) return "propertyfinder";
  if (h.includes("dubizzle")) return "dubizzle";
  return "gemini_live";
}

function normalizeGeminiListingItem(item = {}, criteria = {}) {
  const url = String(item.source_url || item.url || item.link || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const source = inferSource(url, item.source);
  const externalId = String(item.external_id || item.externalId || item.id || idFromUrl(url)).trim();
  const images = [];
  if (item.image) images.push(String(item.image));
  if (item.cover_image) images.push(String(item.cover_image));
  if (Array.isArray(item.images)) images.push(...item.images.filter(Boolean).map(String));
  const uniqueImages = [...new Set(images.filter((u) => /^https?:\/\//i.test(u)))].slice(0, 12);

  const txRaw = String(item.transaction_type || item.purpose || criteria.transaction_type || "rent").toLowerCase();
  const transaction_type = txRaw.includes("sale") || txRaw.includes("buy") ? "sale" : "rent";

  return {
    source,
    external_id: externalId || `live-${idFromUrl(url)}`,
    source_url: url,
    transaction_type,
    property_type: String(item.property_type || item.type || "apartment").toLowerCase(),
    beds: item.beds != null ? Number(item.beds) : item.bedrooms != null ? Number(item.bedrooms) : null,
    baths: item.baths != null ? Number(item.baths) : item.bathrooms != null ? Number(item.bathrooms) : null,
    emirate: String(item.emirate || criteria.emirate || "Dubai").trim(),
    community: String(item.community || item.area || item.neighborhood || criteria.community || "").trim(),
    sub_community: String(item.sub_community || "").trim(),
    building: String(item.building || "").trim(),
    price_aed: Number(item.price_aed || item.price || 0),
    price_period: transaction_type === "rent" ? String(item.price_period || "yearly") : "total",
    furnished:
      item.furnished === true || /^yes|furnished/i.test(String(item.furnished || ""))
        ? true
        : item.furnished === false || /^no|unfurnished/i.test(String(item.furnished || ""))
          ? false
          : null,
    amenities: Array.isArray(item.amenities) ? item.amenities.map(String).slice(0, 20) : [],
    images: uniqueImages,
    description: String(item.title || item.description || "").trim().slice(0, 500),
    agent_name: String(item.agent_name || "").trim(),
    agent_phone: String(item.agent_phone || item.phone || "").trim(),
    agency_name: String(item.agency_name || "").trim()
  };
}

export async function fetchGeminiLiveListings(message = "", criteria = {}) {
  if (!isSupabaseEnabled()) return [];

  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) return [];

  const emirate = criteria.emirate || criteria.emirates?.[0] || "Dubai";
  const beds =
    criteria.beds === 0 ? "studio" : criteria.beds != null ? `${criteria.beds}-bedroom` : "any bedroom count";
  const tx = criteria.transaction_type === "sale" ? "for sale" : "for rent";
  const community = criteria.community ? ` in ${criteria.community}` : "";
  const budget = criteria.max_price ? ` under AED ${criteria.max_price}` : "";
  const today = new Date().toISOString().slice(0, 10);

  const prompt = [
    `Today is ${today}. Find real ${tx} property listings${community} in ${emirate} (${beds})${budget}.`,
    `User asked: ${message}`,
    "Search Bayut, Property Finder, and Dubizzle for CURRENT listings with real photos.",
    "Return ONLY a JSON array (max 6 objects, no markdown):",
    '[{"title":"","source_url":"https://...","source":"bayut","external_id":"","transaction_type":"rent","property_type":"apartment","beds":2,"baths":2,"emirate":"Dubai","community":"Marina","price_aed":120000,"price_period":"yearly","furnished":true,"amenities":["Pool","Gym"],"images":["https://real-image-url.jpg"],"description":""}]',
    "Rules: real HTTPS listing URLs; at least one HTTPS image URL per listing; real AED prices; amenities from listing."
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4000 }
      }),
      signal: controller.signal
    });

    const body = await response.text();
    if (!response.ok) {
      console.error(JSON.stringify({ at: new Date().toISOString(), geminiLiveListingsError: body.slice(0, 300) }));
      return [];
    }

    const parsed = JSON.parse(body);
    const candidate = parsed?.candidates?.[0];
    const text =
      candidate?.content?.parts?.map((p) => p.text || "").join("") || candidate?.output || "";
    const items = parseJsonFromText(text);
    const prepared = items
      .map((item) => normalizeGeminiListingItem(item, criteria))
      .map((row) => prepareListing(row))
      .filter(Boolean);

    if (!prepared.length) return [];

    return batchSyncListingsToSupabaseWithReturn(prepared);
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), geminiLiveListingsError: error.message }));
    return [];
  } finally {
    clearTimeout(timer);
  }
}
