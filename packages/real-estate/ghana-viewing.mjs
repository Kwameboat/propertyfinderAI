/**
 * Ghana pay-to-view + PIN + WhatsApp notify.
 */

import {
  createViewing,
  getViewing,
  getViewingByReference,
  markViewingPaid,
  redeemViewingPin,
  setViewingReference,
  createDeal,
  listViewings,
  listViewingLedger,
  listDeals,
  generateViewingPin
} from "../hub-db/ghana-viewing.mjs";
import { getMarket, isGhanaMarket } from "./market.mjs";
import { makePaystackReference, paystackConfigured, paystackInitialize, paystackVerify } from "../paystack.mjs";
import { getEvolutionConfig, resolveEvolutionInstanceToken, sendEvolutionText } from "../evolution-client.mjs";

export {
  listViewings,
  listViewingLedger,
  listDeals,
  createDeal,
  redeemViewingPin,
  getViewing
};

function publicBase() {
  return String(process.env.JAB_HUB_PUBLIC_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
}

export async function startGhanaViewing(db, { lead, listing, sessionId, renterName, renterPhone, renterEmail, notes }) {
  const market = getMarket();
  if (!isGhanaMarket()) throw new Error("Ghana viewing flow is only for JAB_RE_MARKET=GH");
  const viewing = createViewing(db, {
    lead_id: lead?.id,
    listing_id: listing?.id,
    cluster_id: listing?.cluster_id,
    session_id: sessionId,
    renter_name: renterName,
    renter_phone: renterPhone,
    renter_email: renterEmail,
    agent_phone: listing?.agent_phone,
    notes
  });

  const reference = makePaystackReference("ghview");
  setViewingReference(db, viewing.id, reference);

  const email = renterEmail || `${String(renterPhone).replace(/\D/g, "")}@pay.keyfinder.gh`;
  const callbackUrl = `${publicBase()}/gh/thanks?viewing=${encodeURIComponent(viewing.id)}`;

  let authorizationUrl = "";
  let accessCode = "";
  if (paystackConfigured()) {
    const init = await paystackInitialize({
      email,
      amountGhs: market.viewingFeeGhs,
      reference,
      callbackUrl,
      metadata: {
        type: "ghana_viewing",
        viewing_id: viewing.id,
        listing_id: listing?.id || "",
        phone: renterPhone
      }
    });
    authorizationUrl = init.authorization_url || "";
    accessCode = init.access_code || "";
  }

  return {
    viewing: getViewing(db, viewing.id),
    reference,
    authorizationUrl,
    accessCode,
    amountGhs: market.viewingFeeGhs,
    paystackConfigured: paystackConfigured(),
    devPay: Boolean(process.env.JAB_RE_GH_DEV_PAY)
  };
}

export async function confirmGhanaViewingPayment(db, { viewingId, reference } = {}) {
  let viewing = viewingId ? getViewing(db, viewingId) : null;
  if (!viewing && reference) viewing = getViewingByReference(db, reference);
  if (!viewing) throw new Error("Viewing not found");

  if (paystackConfigured() && viewing.paystack_reference && !process.env.JAB_RE_GH_DEV_PAY) {
    const data = await paystackVerify(viewing.paystack_reference);
    if (data.status !== "success") throw new Error("Payment not successful yet");
  } else if (!process.env.JAB_RE_GH_DEV_PAY && !paystackConfigured()) {
    throw new Error("Paystack is not configured. Set PAYSTACK_SECRET_KEY or JAB_RE_GH_DEV_PAY=1 for local tests.");
  }

  const market = getMarket();
  const pin = generateViewingPin();
  const result = markViewingPaid(db, {
    viewingId: viewing.id,
    pin,
    platformShareGhs: market.platformShareGhs,
    agentShareGhs: market.agentShareGhs
  });

  let whatsappSent = false;
  if (!result.already) {
    try {
      await sendViewingPinWhatsApp(viewing.renter_phone, pin, viewing);
      whatsappSent = true;
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), ghanaPinWaError: error.message }));
    }
  }

  return {
    viewing: result.viewing,
    pin: result.already ? null : pin,
    already: result.already,
    whatsappSent
  };
}

export async function handleGhanaPaystackWebhook(db, event) {
  const meta = event?.data?.metadata || {};
  if (meta.type !== "ghana_viewing") return { handled: false };
  const reference = event?.data?.reference;
  const viewing = getViewingByReference(db, reference) || getViewing(db, meta.viewing_id);
  if (!viewing) return { handled: true, error: "viewing not found" };
  if (event?.event !== "charge.success") return { handled: true };
  const paid = await confirmGhanaViewingPayment(db, { viewingId: viewing.id, reference });
  return { handled: true, viewingId: viewing.id, already: paid.already };
}

async function sendViewingPinWhatsApp(phone, pin, viewing) {
  const instance = process.env.JAB_RE_WA_INSTANCE || process.env.JAB_RE_LEADS_INSTANCE || "";
  if (!instance) throw new Error("JAB_RE_WA_INSTANCE not set");
  const env = getEvolutionConfig();
  const { token } = await resolveEvolutionInstanceToken(env.evoApiUrl, env.globalKey, instance);
  const text = [
    `KeyFinder Ghana — viewing PIN`,
    ``,
    `Your PIN is ${pin}.`,
    `Give this PIN only to the listing agent when you see the room.`,
    `Do not share it before you arrive.`,
    `The agent then sends this PIN (and their MoMo number) to our WhatsApp. After that we pay them GH₵50.`
  ].join("\n");
  await sendEvolutionText({
    evoApiUrl: env.evoApiUrl,
    apiKey: token,
    instance,
    number: String(phone).replace(/\D/g, ""),
    text,
    category: "reply"
  });
}

export function parseAgentPinMessage(text = "") {
  const raw = String(text || "");
  const pin = (raw.match(/\b(\d{6})\b/) || [])[1] || "";
  const momo = (raw.match(/\b(0\d{9})\b/) || raw.match(/\b(233\d{9})\b/) || [])[1] || "";
  return { pin, momo };
}
