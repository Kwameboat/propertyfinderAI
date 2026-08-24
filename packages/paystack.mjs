import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PAYSTACK_BASE = "https://api.paystack.co";

export function paystackConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

export function paystackPublicKey() {
  return process.env.PAYSTACK_PUBLIC_KEY || "";
}

function secret() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not set");
  return key;
}

export function makePaystackReference(prefix = "jab") {
  return `${prefix}_${Date.now()}_${randomBytes(6).toString("hex")}`;
}

/** amountGhs → kobo (Paystack expects smallest currency unit). */
export function ghsToKobo(amountGhs) {
  return Math.round(Number(amountGhs) * 100);
}

export async function paystackInitialize({
  email,
  amountGhs,
  reference,
  callbackUrl,
  metadata = {}
}) {
  const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      amount: ghsToKobo(amountGhs),
      currency: "GHS",
      reference,
      callback_url: callbackUrl,
      metadata
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status) {
    throw new Error(data.message || `Paystack init failed (${response.status})`);
  }
  return data.data;
}

export async function paystackVerify(reference) {
  const response = await fetch(
    `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${secret()}` }
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status) {
    throw new Error(data.message || `Paystack verify failed (${response.status})`);
  }
  return data.data;
}

export function verifyPaystackSignature(rawBody, signatureHeader) {
  const key = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
  if (!key || !signatureHeader) return false;
  const hash = createHmac("sha512", key).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(hash);
    const b = Buffer.from(String(signatureHeader));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
