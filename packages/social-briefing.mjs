/**
 * Conversational flyer briefing — collect phones & key fields before generation.
 */

const sessions = new Map(); // chatId -> brief state

export const FLYER_STYLES = [
  {
    id: "dark_recruit",
    label: "Dark recruitment",
    prompt:
      "black background, bold stacked white headlines LEFT, two circular photorealistic insets with thick white borders RIGHT, CONTACT US arrow bottom-left, PosterMyWall recruitment ad"
  },
  {
    id: "neon_night",
    label: "Neon night",
    prompt:
      "deep navy/purple gradient, neon accent lines, modern bold typography, circular photo frames with neon rim, nightlife premium poster"
  },
  {
    id: "clean_corporate",
    label: "Clean corporate",
    prompt:
      "white/light gray background, navy and teal accents, clean sans typography, soft photo circles, professional corporate hiring poster"
  },
  {
    id: "ghana_warm",
    label: "Ghana warm",
    prompt:
      "warm sand and deep green accents, gold highlight, African-contemporary poster, bold headlines, circular lifestyle photos"
  },
  {
    id: "cinematic",
    label: "Cinematic",
    prompt:
      "cinematic dark grade, dramatic lighting photos, large typography overlay, movie-poster energy, high contrast Instagram ad"
  },
  {
    id: "bold_blocks",
    label: "Bold color blocks",
    prompt:
      "geometric color blocks, oversized typography, two circular cutouts for photos, modern Canva/PosterMyWall marketing flyer"
  },
  {
    id: "luxury_gold",
    label: "Luxury gold",
    prompt:
      "matte black with gold foil typography feel, elegant spacing, circular portraits with gold rings, premium hiring flyer"
  },
  {
    id: "street_pop",
    label: "Street pop",
    prompt:
      "vibrant street-pop colors, sticker-like headlines, energetic photos in circles, youth-oriented social poster"
  }
];

export function getBriefSession(chatId) {
  return sessions.get(String(chatId)) || null;
}

export function clearBriefSession(chatId) {
  sessions.delete(String(chatId));
}

export function startBriefSession(chatId, seed = {}) {
  const state = {
    stage: "collecting",
    topic: seed.topic || "",
    location: seed.location || "",
    phones: seed.phones || [],
    headline: seed.headline || "",
    roles: seed.roles || "",
    cta: seed.cta || "",
    styleId: seed.styleId || "",
    extra: seed.extra || "",
    platforms: seed.platforms || [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  sessions.set(String(chatId), state);
  return state;
}

export function updateBriefSession(chatId, patch) {
  const cur = getBriefSession(chatId) || startBriefSession(chatId);
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  sessions.set(String(chatId), next);
  return next;
}

export function extractPhones(text) {
  const matches = String(text || "").match(/(?:\+?\d[\d\s\-()]{7,}\d)/g) || [];
  return [...new Set(matches.map((m) => m.replace(/[^\d+]/g, "")).filter((p) => p.replace(/\D/g, "").length >= 9))];
}

export function extractBriefHints(text) {
  const t = String(text || "");
  const phones = extractPhones(t);
  const location =
    (t.match(/\b(?:in|at)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/) || [])[1] ||
    (/\bdubai\b/i.test(t) ? "Dubai" : "") ||
    (/\bghana|accra|kumasi\b/i.test(t) ? "Ghana" : "");
  let roles = "";
  if (/security/i.test(t) && /clean/i.test(t)) roles = "Security guards & cleaners";
  else if (/security/i.test(t)) roles = "Security guards";
  else if (/clean/i.test(t)) roles = "Cleaners";
  else if (/driver/i.test(t)) roles = "Drivers";
  else if (/salon|beauty/i.test(t)) roles = "Salon / beauty";
  else if (/whatsapp|ai agent/i.test(t)) roles = "WhatsApp AI agents";

  const styleHit = FLYER_STYLES.find((s) => t.toLowerCase().includes(s.id.replace(/_/g, " ")) || t.toLowerCase().includes(s.label.toLowerCase()));

  return {
    phones,
    location,
    roles,
    topic: t.slice(0, 240),
    styleId: styleHit?.id || "",
    headline: ""
  };
}

export function missingBriefFields(state) {
  const missing = [];
  if (!String(state.roles || state.headline || state.topic || "").trim()) missing.push("topic");
  if (!String(state.location || "").trim()) missing.push("location");
  if (!(state.phones || []).length) missing.push("phones");
  if (!String(state.styleId || "").trim()) missing.push("style");
  return missing;
}

export function briefReady(state) {
  return missingBriefFields(state).length === 0;
}

export function nextBriefQuestion(state) {
  const missing = missingBriefFields(state);
  if (!missing.length) {
    return {
      done: true,
      text: [
        "Got it — ready to design.",
        `Topic: ${state.roles || state.topic}`,
        `Location: ${state.location}`,
        `WhatsApp: ${(state.phones || []).join(" / ")}`,
        `Style: ${FLYER_STYLES.find((s) => s.id === state.styleId)?.label || state.styleId}`,
        "",
        "Reply YES to generate the flyer + Reel, or tell me what to change."
      ].join("\n")
    };
  }
  const ask = missing[0];
  if (ask === "topic") {
    return {
      done: false,
      field: "topic",
      text: "What should this flyer promote? (e.g. Security guards & cleaners wanted, salon promo, WhatsApp AI offer)"
    };
  }
  if (ask === "location") {
    return {
      done: false,
      field: "location",
      text: "Which location should appear on the flyer? (e.g. Dubai, Accra, Kumasi)"
    };
  }
  if (ask === "phones") {
    return {
      done: false,
      field: "phones",
      text: "What WhatsApp number(s) should I put on the flyer? Send one or two numbers."
    };
  }
  if (ask === "style") {
    const list = FLYER_STYLES.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return {
      done: false,
      field: "style",
      text: [
        "Pick a unique flyer style (reply with the number or name):",
        list,
        "",
        "Or say “surprise me” and I’ll choose a fresh style."
      ].join("\n")
    };
  }
  return { done: false, field: ask, text: `Please provide: ${ask}` };
}

export function applyBriefAnswer(state, text) {
  const t = String(text || "").trim();
  const lower = t.toLowerCase();
  const phones = extractPhones(t);
  const patch = {};

  if (phones.length) patch.phones = [...new Set([...(state.phones || []), ...phones])];

  const missing = missingBriefFields(state);
  const field = missing[0];

  if (field === "topic" || (!state.roles && !state.topic)) {
    patch.topic = t;
    const hints = extractBriefHints(t);
    if (hints.roles) patch.roles = hints.roles;
    if (hints.location && !state.location) patch.location = hints.location;
  } else if (field === "location") {
    patch.location = t.replace(/^(in|at)\s+/i, "").trim();
  } else if (field === "phones") {
    if (!phones.length) {
      return { ok: false, error: "I need at least one WhatsApp number (digits)." };
    }
  } else if (field === "style") {
    if (/surprise|any|random|you choose/i.test(lower)) {
      const pick = FLYER_STYLES[Math.floor(Math.random() * FLYER_STYLES.length)];
      patch.styleId = pick.id;
    } else {
      const byNum = Number(t.match(/\d+/)?.[0] || 0);
      if (byNum >= 1 && byNum <= FLYER_STYLES.length) patch.styleId = FLYER_STYLES[byNum - 1].id;
      else {
        const hit = FLYER_STYLES.find(
          (s) => lower.includes(s.label.toLowerCase()) || lower.includes(s.id.replace(/_/g, " "))
        );
        if (hit) patch.styleId = hit.id;
        else return { ok: false, error: "Pick a style number from the list, or say surprise me." };
      }
    }
  }

  if (/yes|generate|go ahead|create it|do it|looks good/i.test(lower) && briefReady({ ...state, ...patch })) {
    patch.stage = "confirmed";
  }

  return { ok: true, patch };
}

export function buildBriefSummaryText(state) {
  const style = FLYER_STYLES.find((s) => s.id === state.styleId);
  return [
    `Create a stunning social flyer + Reel.`,
    `Roles/topic: ${state.roles || state.headline || state.topic}`,
    `Location: ${state.location || "—"}`,
    `WhatsApp: ${(state.phones || []).join(" / ") || "—"}`,
    state.cta ? `CTA: ${state.cta}` : null,
    `Style: ${style?.label || state.styleId}`,
    state.extra ? `Notes: ${state.extra}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export function stylePromptFor(styleId) {
  return FLYER_STYLES.find((s) => s.id === styleId)?.prompt || FLYER_STYLES[0].prompt;
}
