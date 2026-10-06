/**
 * Real Estate WhatsApp channel — inbound routing + listing cards outbound.
 */

import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getOrCreateSessionByPhone, normalizeRePhone } from "../hub-db/real-estate.mjs";
import { handleRentChat, submitRentLead } from "./chat.mjs";
import {
  createSavedSearchFromSession,
  listSavedSearches,
  deactivateAllSavedSearches,
  userWantsSavedSearch,
  userWantsListAlerts,
  userWantsStopAlerts,
  formatSavedSearchListWhatsApp
} from "./saved-search.mjs";
import {
  computeMoveInCost,
  parseMoveInCalculatorInput,
  formatMoveInCostWhatsApp,
  userWantsMoveInCalculator
} from "./calculators.mjs";
import { formatComparisonWhatsApp } from "./listing-compare.mjs";
import { sendMetaCloudText } from "../meta-cloud.mjs";
import { aiDisclaimerText } from "./disclaimer.mjs";
import { formatMoney, getMarket, isGhanaMarket } from "./market.mjs";

const JAB_SALES_RE =
  /\b(jab|digital hub|digitalhub|waba|paystack|onboard|onboarding|setup fee|agency pricing|become a client|sign up|signup|top[\s-]?up)\b/i;

const RE_PROPERTY_RE =
  /\b(rent|rental|lease|buy|purchase|property|properties|apartment|flat|villa|studio|bedroom|bed|br\b|bhk|aed|dubai|abu dhabi|sharjah|marina|jvc|business bay|downtown|off[\s-]?plan|real estate|listing|viewing|move in|ejari|dewa|emaar|damac|bayut|propertyfinder)\b/i;

export function isReWhatsAppInstance(instance = "") {
  const target = String(process.env.JAB_RE_WA_INSTANCE || "").trim();
  return Boolean(target && instance === target);
}

/** Dedicated PropertyFinder Gh Evolution instance — routed by the UAE bridge to Hub :3001. */
export function ghanaReWhatsAppInstanceName() {
  return String(process.env.JAB_RE_GH_WA_INSTANCE || "").trim();
}

export function isGhanaReWhatsAppInstance(instance = "") {
  const target = ghanaReWhatsAppInstanceName();
  return Boolean(target && instance === target);
}

export function ghanaHubWhatsAppUrl() {
  return String(process.env.JAB_RE_GH_HUB_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
}

export function ghanaWhatsAppInboundToken() {
  return String(process.env.JAB_RE_WA_INBOUND_TOKEN || process.env.AUTHENTICATION_API_KEY || "").trim();
}

export function isLoopbackAddress(addr = "") {
  const raw = String(addr || "").replace(/^::ffff:/i, "");
  return raw === "127.0.0.1" || raw === "::1" || raw === "localhost";
}

export function isReWhatsAppOnAgencyEnabled() {
  return String(process.env.JAB_RE_WA_ON_AGENCY || "").trim() === "1";
}

const GHANA_RE_PROPERTY_RE =
  /\b(rent|rental|self-?contain|chamber|compound|accra|kumasi|tema|east legon|osu|spintex|cedi|gh₵|nras|ofie|ɔdan|aƒe|mepɛ|hwehwɛ|viewing|listing|property|apartment|house)\b/i;

export function shouldRouteInboundToRealEstate(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^re[\s:/]/i.test(t)) return true;
  if (JAB_SALES_RE.test(t)) return false;
  if (userWantsSavedSearch(t) || userWantsListAlerts(t) || userWantsStopAlerts(t)) return true;
  if (userWantsMoveInCalculator(t)) return true;
  if (/^(yes|confirm|book viewing|i'?m interested)$/i.test(t)) return true;
  if (isGhanaMarket() && GHANA_RE_PROPERTY_RE.test(t)) return true;
  return RE_PROPERTY_RE.test(t);
}

export function resolveReWhatsAppSendInstance(instance) {
  return (
    String(process.env.JAB_RE_WA_INSTANCE || "").trim() ||
    String(process.env.JAB_RE_LEADS_INSTANCE || "").trim() ||
    instance
  );
}

function stripMarkdown(text = "") {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

export function formatListingWhatsAppCaption(card, index = 0) {
  const market = getMarket();
  const amount = Number(card.price_aed || 0);
  const price =
    market.code === "GH"
      ? card.transaction_type === "rent"
        ? `${formatMoney(amount, market)}/mo`
        : formatMoney(amount, market)
      : card.transaction_type === "rent"
        ? `AED ${amount.toLocaleString()}/yr`
        : `AED ${amount.toLocaleString()}`;
  const area = card.community || card.emirate || "";
  const parts = [
    index ? `${index}. ` : "",
    card.title || "Property",
    ` — ${price}`,
    area ? ` · ${area}` : "",
    card.furnished === true ? " · Furnished" : card.furnished === false ? " · Unfurnished" : "",
    card.source_url ? `\n${card.source_url}` : ""
  ];
  return stripMarkdown(parts.join("")).slice(0, 900);
}

async function fetchImageToTemp(url) {
  const res = await fetch(String(url), {
    headers: { "User-Agent": "JAB-Hub-RE/1.0", Accept: "image/*" },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`image_fetch_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error("image_too_small");
  const dir = path.join(tmpdir(), "jab-re-wa");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${randomUUID()}.jpg`);
  await writeFile(filePath, buf);
  return filePath;
}

export async function sendEvolutionMediaFromUrl({
  evoApiUrl,
  apiKey,
  instance,
  number,
  imageUrl,
  caption = ""
}) {
  const filePath = await fetchImageToTemp(imageUrl);
  try {
    const bytes = await readFile(filePath);
    const media = bytes.toString("base64");
    const url = `${evoApiUrl}/message/sendMedia/${encodeURIComponent(instance)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        number,
        mediatype: "image",
        mimetype: "image/jpeg",
        caption: stripMarkdown(caption).slice(0, 900),
        media,
        fileName: "listing.jpg"
      })
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`sendMedia ${response.status}: ${body.slice(0, 200)}`);
    return body;
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

export async function sendListingCardsWhatsApp({
  evoApiUrl,
  apiKey,
  instance,
  number,
  listings = [],
  maxImages = 3,
  sendTextFallback
}) {
  const sent = [];
  const cards = listings.slice(0, maxImages);
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const caption = formatListingWhatsAppCaption(card, i + 1);
    if (card.image) {
      try {
        await sendEvolutionMediaFromUrl({
          evoApiUrl,
          apiKey,
          instance,
          number,
          imageUrl: card.image,
          caption
        });
        sent.push({ id: card.id, ok: true, image: true });
        continue;
      } catch {
        /* fall through */
      }
    }
    if (sendTextFallback) {
      await sendTextFallback(caption);
      sent.push({ id: card.id, ok: true, image: false });
    } else {
      try {
        await sendMetaCloudText({ to: number, text: caption });
        sent.push({ id: card.id, ok: true, image: false });
      } catch {
        sent.push({ id: card.id, ok: false, error: "send_failed" });
      }
    }
  }
  return sent;
}

async function handleWaCommands(db, { userPhone, inboundText, session, pushName, reOnAgency = false }) {
  const phone = normalizeRePhone(userPhone);

  if (userWantsStopAlerts(inboundText)) {
    const n = deactivateAllSavedSearches(db, phone);
    return { handled: true, text: n ? `Turned off ${n} alert(s).` : "No active alerts to stop." };
  }

  if (userWantsListAlerts(inboundText)) {
    const rows = listSavedSearches(db, phone, { activeOnly: true });
    return { handled: true, text: formatSavedSearchListWhatsApp(rows) };
  }

  if (userWantsMoveInCalculator(inboundText)) {
    const parsed = parseMoveInCalculatorInput(inboundText);
    const criteria = session?.criteria || {};
    const annualRent = parsed.annualRent || criteria.max_price || criteria.min_price || 0;
    const calc = computeMoveInCost({
      annualRent,
      includeChiller: parsed.includeChiller,
      depositMonths: parsed.depositMonths
    });
    return { handled: true, text: formatMoveInCostWhatsApp(calc) };
  }

  if (userWantsSavedSearch(inboundText)) {
    const criteria = session?.criteria || {};
    if (!criteria.max_price && !criteria.community && !criteria.emirates?.length && criteria.beds == null) {
      return {
        handled: true,
        text: isGhanaMarket()
          ? 'Search first (e.g. "self-contain East Legon under 2000"), then reply "alert me".'
          : 'Search first (e.g. "2 bed Marina under 120k"), then reply "alert me".'
      };
    }
    const { saved, duplicate } = createSavedSearchFromSession(db, {
      userPhone: phone,
      criteria,
      label: ""
    });
    return {
      handled: true,
      text: duplicate
        ? `You already have an alert for "${saved.label}".`
        : `Alert saved: "${saved.label}". I'll WhatsApp you when new listings match.`
    };
  }

  if (/^(yes|confirm|book viewing|i'?m interested)$/i.test(String(inboundText || "").trim())) {
    if (reOnAgency) {
      return {
        handled: true,
        text:
          "For viewings on properties, use our Dar Concierge app at /rent or message our property line directly — agency sales leads stay in the agency console."
      };
    }
    const name = pushName || "WhatsApp user";
    try {
      const listingId = session?.criteria?.last_shortlist_id || session?.criteria?.shortlist_id || null;
      await submitRentLead(db, {
        sessionId: session.id,
        listingId,
        renterName: name,
        renterPhone: phone,
        consent: true,
        notes: "Via WhatsApp RE channel",
        channel: "whatsapp"
      });
      if (isGhanaMarket()) {
        return {
          handled: true,
          text: `To book a viewing, pay GH₵100 in the PropertyFinder Gh app (https://wa.jabdigitalhub.com/gh). After payment your PIN comes on this WhatsApp. Give that PIN to the listing agent only when you see the room.`
        };
      }
      return {
        handled: true,
        text: `Thanks ${name.split(" ")[0]} — we have your number (+${phone}). Our team will call before contacting the listing agent.`
      };
    } catch (error) {
      return { handled: true, text: `Almost there — ${error.message}` };
    }
  }

  return { handled: false };
}

/**
 * Full RE WhatsApp inbound turn — call from evolution-openclaw-bridge.mjs
 */
export async function handleReWhatsAppInbound({
  db,
  instance,
  number,
  replyJid,
  inboundText,
  pushName = "",
  evoApiUrl,
  apiKey,
  sendText,
  reOnAgency = false
}) {
  const phone = normalizeRePhone(number);
  const session = getOrCreateSessionByPhone(db, phone);
  const sendInstance = resolveReWhatsAppSendInstance(instance);
  const target = replyJid || number;

  const cmd = await handleWaCommands(db, {
    userPhone: phone,
    inboundText,
    session,
    pushName,
    reOnAgency
  });
  if (cmd.handled) {
    await sendText({
      evoApiUrl,
      apiKey,
      instance: sendInstance,
      number: target,
      text: cmd.text,
      isAgency: true
    });
    return { sent: true, reChat: true, command: true, sessionId: session.id };
  }

  const result = await handleRentChat(db, {
    sessionId: session.id,
    message: String(inboundText || "").replace(/^re[\s:/]+/i, "").trim(),
    userPhone: phone
  });

  let replyText = stripMarkdown(result.text || "");
  if (result.leadReady) {
    replyText += isGhanaMarket()
      ? "\n\nReply YES to start a viewing. You will pay GH₵100 in the PropertyFinder Gh app, then get a PIN here."
      : "\n\nReply YES to book a viewing — we'll call you before contacting the agent.";
  }
  if (result.showListings && (result.listings || []).length) {
    replyText += "\n\nSending photos below…";
  }
  replyText += `\n\n_${aiDisclaimerText(result.language || "en")}_`;

  await sendText({
    evoApiUrl,
    apiKey,
    instance: sendInstance,
    number: target,
    text: replyText.slice(0, 4000),
    isAgency: true
  });

  if (result.comparison) {
    const compareText = formatComparisonWhatsApp(result.comparison);
    if (compareText) {
      await sendText({
        evoApiUrl,
        apiKey,
        instance: sendInstance,
        number: target,
        text: compareText,
        isAgency: true
      });
    }
  }

  if (result.listings?.length) {
    await sendListingCardsWhatsApp({
      evoApiUrl,
      apiKey,
      instance: sendInstance,
      number: target,
      listings: result.listings,
      maxImages: 3,
      sendTextFallback: (caption) =>
        sendText({
          evoApiUrl,
          apiKey,
          instance: sendInstance,
          number: target,
          text: caption,
          isAgency: true
        })
    });
  }

  return {
    sent: true,
    reChat: true,
    sessionId: session.id,
    intent: result.intent,
    listings: result.listings?.length || 0,
    leadReady: result.leadReady
  };
}
