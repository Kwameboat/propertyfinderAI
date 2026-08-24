/**
 * Yango delivery fee estimates: shop → buyer.
 * Prefers official Yango taxi_info API when YANGO_CLID + YANGO_APIKEY are set.
 * Otherwise geocodes + routes (Nominatim/OSRM) and applies a configurable Ghana-style estimate.
 */

const YANGO_TAXI_INFO = "https://taxi-routeinfo.taxi.yandex.net/taxi_info";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function parseLatLng(text) {
  const m = String(text || "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function geocodeAddress(query, { countrycodes = "gh" } = {}) {
  const q = String(query || "").trim();
  if (!q) return null;
  const coords = parseLatLng(q);
  if (coords) return { ...coords, display: q, source: "coords" };

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  if (countrycodes) url.searchParams.set("countrycodes", countrycodes);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "JAB-Hub-Delivery/1.0 (local agency lab)"
    }
  });
  if (!response.ok) {
    throw new Error(`Geocode failed ${response.status}`);
  }
  const rows = await response.json();
  const hit = Array.isArray(rows) ? rows[0] : null;
  if (!hit) return null;
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    display: hit.display_name || q,
    source: "nominatim"
  };
}

async function routeDistanceKm(from, to) {
  const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    return { km: haversineKm(from, to) * 1.35, source: "haversine" };
  }
  const data = await response.json();
  const meters = data?.routes?.[0]?.distance;
  if (!Number.isFinite(meters)) {
    return { km: haversineKm(from, to) * 1.35, source: "haversine" };
  }
  return { km: meters / 1000, source: "osrm" };
}

async function yangoTaxiInfoPrice(from, to) {
  const clid = process.env.YANGO_CLID || "";
  const apikey = process.env.YANGO_APIKEY || "";
  if (!clid || !apikey) return null;

  const className = process.env.YANGO_CLASS || "express";
  const rll = `${from.lng},${from.lat}~${to.lng},${to.lat}`;
  const url = new URL(YANGO_TAXI_INFO);
  url.searchParams.set("clid", clid);
  url.searchParams.set("apikey", apikey);
  url.searchParams.set("rll", rll);
  url.searchParams.set("class", className);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Yango taxi_info ${response.status}: ${body.slice(0, 200)}`);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Yango taxi_info returned non-JSON");
  }

  const options = Array.isArray(data?.options) ? data.options : [];
  const preferred =
    options.find((o) => String(o.class_name || "").toLowerCase().includes(className)) ||
    options[0];
  const price = preferred?.price ?? data?.price;
  if (!Number.isFinite(Number(price))) {
    throw new Error("Yango taxi_info missing price");
  }
  const currency = data?.currency || preferred?.currency || "GHS";
  const distanceM = Number(data?.distance);
  return {
    price: Number(price),
    currency,
    distanceKm: Number.isFinite(distanceM) ? distanceM / 1000 : null,
    priceText: preferred?.price_text || `${currency} ${Number(price).toFixed(2)}`,
    className: preferred?.class_name || className,
    source: "yango-api"
  };
}

function fallbackPrice(distanceKm) {
  const base = numEnv("YANGO_FALLBACK_BASE_GHS", 10);
  const perKm = numEnv("YANGO_FALLBACK_PER_KM_GHS", 2.5);
  const minFee = numEnv("YANGO_FALLBACK_MIN_GHS", 12);
  const raw = base + distanceKm * perKm;
  const price = Math.max(minFee, Math.round(raw));
  return {
    price,
    currency: "GHS",
    distanceKm,
    priceText: `GHS ${price.toFixed(2)}`,
    className: "express-estimate",
    source: "distance-estimate"
  };
}

/**
 * @param {{ shopLat?: number|null, shopLng?: number|null, shopAddress?: string|null, buyerQuery: string }} input
 */
export async function estimateYangoDeliveryFee(input) {
  const buyerQuery = String(input?.buyerQuery || "").trim();
  if (!buyerQuery) {
    return { ok: false, error: "missing-buyer-location" };
  }

  let shop = null;
  if (
    input?.shopLat != null &&
    input?.shopLng != null &&
    Number.isFinite(Number(input.shopLat)) &&
    Number.isFinite(Number(input.shopLng))
  ) {
    shop = {
      lat: Number(input.shopLat),
      lng: Number(input.shopLng),
      display: input.shopAddress || "shop",
      source: "shop-coords"
    };
  } else if (input?.shopAddress) {
    shop = await geocodeAddress(input.shopAddress);
  }

  if (!shop) {
    return { ok: false, error: "shop-location-missing" };
  }

  const buyer = await geocodeAddress(buyerQuery);
  if (!buyer) {
    return { ok: false, error: "buyer-location-not-found", buyerQuery };
  }

  try {
    const apiQuote = await yangoTaxiInfoPrice(shop, buyer);
    if (apiQuote) {
      return {
        ok: true,
        ...apiQuote,
        shop,
        buyer,
        approx: false
      };
    }
  } catch (error) {
    // Fall through to distance estimate; callers can log error.
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        yangoApiError: error.message
      })
    );
  }

  const route = await routeDistanceKm(shop, buyer);
  const quote = fallbackPrice(route.km);
  return {
    ok: true,
    ...quote,
    distanceKm: route.km,
    routeSource: route.source,
    shop,
    buyer,
    approx: true
  };
}

export function formatDeliveryFeeForChat(quote) {
  if (!quote?.ok) {
    if (quote?.error === "shop-location-missing") {
      return "I can't quote Yango delivery yet — the shop location isn't set. Share your area and a delivery agent will confirm the fee.";
    }
    if (quote?.error === "buyer-location-not-found") {
      return "I couldn't pin that delivery location. Please share a clearer landmark/area or your WhatsApp location pin.";
    }
    return "I couldn't calculate the delivery fee right now. Please share your area again or ask for a human.";
  }

  const km =
    quote.distanceKm != null && Number.isFinite(quote.distanceKm)
      ? ` (~${quote.distanceKm.toFixed(1)} km)`
      : "";
  if (quote.approx) {
    return `about ${quote.priceText}${km} via Yango Delivery (estimate — final fee may vary with traffic/demand)`;
  }
  return `${quote.priceText}${km} via Yango${quote.className ? ` ${quote.className}` : ""} (approx; may vary with demand)`;
}
