/**
 * Shared helpers: init Paystack top-up + notify via agency WhatsApp.
 */
import {
  getAgencySettings,
  resolveAgencyInstanceName,
  isAgencyInstance,
  getClient,
  getPointPackage,
  listPointPackages,
  packageTotalPoints,
  createPaystackPayment,
  createPointPackage,
  getWallet,
  markLowBalanceNotified,
  ensureClientBillingEmail,
  resolvePaystackBillingEmail,
  getClientAdminPhones
} from "./hub-db/index.mjs";
import { formatContactAlertLines } from "./agency-qualification.mjs";
import { guardedEvolutionSend } from "./whatsapp-guard.mjs";
import { notifyAgencyPaymentOps } from "./agency-notify.mjs";
import {
  paystackConfigured,
  makePaystackReference,
  paystackInitialize
} from "./paystack.mjs";

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function findCreditInstance(db, prospectPhone) {
  const digits = normalizePhone(prospectPhone);
  if (!digits) return null;
  const match = db
    .prepare(
      `SELECT instance_name FROM clients
       WHERE REPLACE(REPLACE(IFNULL(contact_phone,''), '+', ''), ' ', '') LIKE ?
          OR REPLACE(REPLACE(IFNULL(whatsapp_order_number,''), '+', ''), ' ', '') LIKE ?
       LIMIT 1`
    )
    .get(`%${digits.slice(-9)}%`, `%${digits.slice(-9)}%`);
  return match?.instance_name || null;
}

export async function sendAgencyText({
  db,
  evoApiUrl,
  resolveToken,
  agencyInstance,
  toPhone,
  text,
  category = "ops"
}) {
  const instance = agencyInstance || resolveAgencyInstanceName(db);
  if (!instance) throw new Error("agency_instance_not_configured");
  const number = normalizePhone(toPhone);
  if (!number) throw new Error("missing_notify_phone");
  const apiKey = await resolveToken(instance);
  return guardedEvolutionSend({
    evoApiUrl,
    apiKey,
    instance,
    number,
    text,
    category,
    isAgency: true,
    linkPreview: false
  });
}

export async function initClientTopup(
  db,
  {
    instanceName,
    packageId = null,
    /** One-off or custom top-up: { priceGhs, points, name?, saveAsPackage? } */
    custom = null,
    email = null,
    publicBase,
    evoApiUrl = null,
    resolveToken = null,
    notifyWhatsApp = true,
    /** Agency sales: prospect paying via agency WhatsApp */
    prospectPhone = null,
    prospectName = null,
    saleChannel = null,
    creditInstanceName = null
  }
) {
  if (!paystackConfigured()) throw new Error("paystack_not_configured");

  const client = getClient(db, instanceName);
  if (!client) throw new Error("client_not_found");
  ensureClientBillingEmail(db, instanceName, { client });

  const isAgencySale = saleChannel === "agency" || isAgencyInstance(db, instanceName);
  const prospectDigits = normalizePhone(prospectPhone);
  const creditTarget =
    creditInstanceName ||
    (prospectDigits ? findCreditInstance(db, prospectDigits) : null) ||
    (isAgencySale ? null : instanceName);

  let pkg = null;
  let points = 0;
  let amountGhs = 0;
  let isTopup = true;
  let durationDays = 30;
  let label = "Custom top-up";

  if (custom && (custom.priceGhs != null || custom.points != null)) {
    amountGhs = Number(custom.priceGhs);
    points = Math.max(1, Math.floor(Number(custom.points) || 0));
    if (!(amountGhs > 0) || !points) throw new Error("custom_topup_requires_price_and_points");
    isTopup = custom.isTopup !== false;
    durationDays = Math.max(1, Math.floor(Number(custom.durationDays) || 30));
    label = String(custom.name || "").trim() || `Custom ${points} pts`;

    if (custom.saveAsPackage) {
      pkg = createPointPackage(db, {
        name: label,
        priceGhs: amountGhs,
        points,
        bonusPoints: 0,
        active: true,
        sortOrder: 20,
        durationDays,
        isTopup: true
      });
      points = packageTotalPoints(pkg);
      amountGhs = Number(pkg.price_ghs);
      isTopup = true;
      label = pkg.name;
    }
  } else {
    pkg = packageId ? getPointPackage(db, packageId) : null;
    if (!pkg) {
      const active = listPointPackages(db, { activeOnly: true });
      const wallet = getWallet(db, instanceName);
      const periodActive = wallet?.period_ends_at && Number(wallet.period_ends_at) > Date.now();
      if (periodActive) {
        pkg = active.find((p) => Number(p.is_topup)) || active[0] || null;
      } else {
        pkg = active.find((p) => !Number(p.is_topup)) || active.find((p) => /setup/i.test(String(p.name))) || active[0] || null;
      }
    }
    if (!pkg || !pkg.active) throw new Error("no_active_package");
    points = packageTotalPoints(pkg);
    amountGhs = Number(pkg.price_ghs);
    isTopup = Boolean(Number(pkg.is_topup));
    durationDays = Number(pkg.duration_days) || 30;
    label = pkg.name;
  }

  const billingClient = creditTarget ? getClient(db, creditTarget) : client;
  const reference = makePaystackReference("jab");
  const customerEmail = resolvePaystackBillingEmail(db, {
    instanceName: billingClient?.instance_name || instanceName,
    client: billingClient || client,
    phone: prospectDigits || billingClient?.contact_phone || client?.contact_phone,
    explicitEmail: email,
    reference
  });
  ensureClientBillingEmail(db, billingClient?.instance_name || instanceName, {
    client: billingClient,
    phone: prospectDigits || null
  });
  const callbackUrl = `${String(publicBase).replace(/\/$/, "")}/billing/thanks`;

  const data = await paystackInitialize({
    email: customerEmail,
    amountGhs,
    reference,
    callbackUrl,
    metadata: {
      instance_name: instanceName,
      credit_instance_name: creditTarget,
      package_id: pkg?.id || null,
      points,
      is_topup: isTopup,
      custom: !pkg,
      prospect_phone: prospectDigits || null,
      prospect_name: prospectName || null,
      sale_channel: isAgencySale && prospectDigits ? "agency" : saleChannel || "hub"
    }
  });

  const payment = createPaystackPayment(db, {
    reference,
    instanceName,
    packageId: pkg?.id || null,
    amountGhs,
    points,
    authorizationUrl: data.authorization_url,
    customerEmail,
    prospectPhone: prospectDigits || null,
    prospectName: prospectName || null,
    saleChannel: isAgencySale && prospectDigits ? "agency" : saleChannel || null,
    creditInstanceName: creditTarget
  });

  const skipOwnerNotify = isAgencySale && prospectDigits;
  if (notifyWhatsApp && !skipOwnerNotify && evoApiUrl && resolveToken && client.contact_phone) {
    try {
      const agencyInstance = resolveAgencyInstanceName(db);
      const kind = isTopup ? "top-up" : "plan";
      await sendAgencyText({
        db,
        evoApiUrl,
        resolveToken,
        agencyInstance,
        toPhone: client.contact_phone,
        text: [
          `Hi ${client.display_name || instanceName},`,
          `Buy ${kind} ${points} points (GHS ${Number(amountGhs).toFixed(2)}) — ${label}.`,
          isTopup
            ? `Top-ups add points when you run out before your ${durationDays}-day window ends.`
            : `Plan points are valid for ${durationDays} days.`,
          `Pay here: ${data.authorization_url}`
        ].join("\n")
      });
    } catch (error) {
      console.error(
        JSON.stringify({ at: new Date().toISOString(), agencyNotifyError: error.message })
      );
    }
  }

  return {
    payment,
    authorizationUrl: data.authorization_url,
    package: pkg,
    points,
    amountGhs,
    isTopup,
    label,
    reference,
    creditInstanceName: creditTarget
  };
}

export async function maybeNotifyLowBalance(
  db,
  { instanceName, evoApiUrl, resolveToken, publicBase, force = false }
) {
  const settings = getAgencySettings(db);
  if (!settings?.notify_low_balance && !force) return null;
  const wallet = getWallet(db, instanceName);
  const threshold = Number(settings?.low_balance_threshold ?? 50);
  if ((wallet.balance_points || 0) > threshold) return null;

  const last = wallet.last_low_balance_notified_at || 0;
  if (!force && Date.now() - last < 6 * 60 * 60 * 1000) return null;

  const client = getClient(db, instanceName);
  const agencyInstance = resolveAgencyInstanceName(db);
  if (!client?.contact_phone || !agencyInstance) {
    markLowBalanceNotified(db, instanceName);
    return null;
  }

  let linkHint = `${String(publicBase).replace(/\/$/, "")}`;
  try {
    const topup = await initClientTopup(db, {
      instanceName,
      publicBase,
      notifyWhatsApp: false
    });
    linkHint = topup.authorizationUrl;
  } catch {
    /* paystack may be unset */
  }

  await sendAgencyText({
    db,
    evoApiUrl,
    resolveToken,
    agencyInstance,
    toPhone: client.contact_phone,
    text: [
      `JAB Hub: points running low for ${client.display_name || instanceName}.`,
      `Balance: ${wallet.balance_points} (threshold ${threshold}).`,
      `Top up: ${linkHint}`
    ].join("\n")
  });
  markLowBalanceNotified(db, instanceName);
  return true;
}

export async function notifyPaymentSuccess(
  db,
  {
    instanceName,
    points,
    balance,
    evoApiUrl,
    resolveToken,
    payment = null,
    pendingCredit = false
  }
) {
  const settings = getAgencySettings(db);
  if (!settings?.notify_payment) return null;
  const agencyInstance = resolveAgencyInstanceName(db);
  if (!agencyInstance || !evoApiUrl || !resolveToken) return null;

  const paymentRow = payment || null;
  const prospectPhone = paymentRow?.prospect_phone || null;
  const prospectName = paymentRow?.prospect_name || "there";
  const amountGhs = paymentRow?.amount_ghs;
  const reference = paymentRow?.reference;
  const creditInstance = paymentRow?.credit_instance_name || instanceName;
  const creditClient = getClient(db, creditInstance);

  if (prospectPhone && paymentRow?.sale_channel === "agency") {
    const prospectMsg = pendingCredit
      ? [
          `Hi ${prospectName} — payment received ✅`,
          `GHS ${Number(amountGhs || 0).toFixed(2)} for ${points} credits.`,
          `We're setting up your WhatsApp agent next — your credits will activate once onboarding is complete.`,
          reference ? `Ref: ${reference}` : null
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `Hi ${prospectName} — payment confirmed ✅`,
          `GHS ${Number(amountGhs || 0).toFixed(2)} · +${points} credits.`,
          creditClient
            ? `Active on ${creditClient.display_name || creditInstance}. Balance: ${balance} credits.`
            : `Balance: ${balance} credits.`,
          reference ? `Ref: ${reference}` : null
        ]
          .filter(Boolean)
          .join("\n");
    try {
      await sendAgencyText({
        db,
        evoApiUrl,
        resolveToken,
        agencyInstance,
        toPhone: prospectPhone,
        text: prospectMsg,
        category: "reply"
      });
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), prospectPayNotify: error.message }));
    }

    const opsMsg = [
      `Agency sale payment ${pendingCredit ? "received (pending onboarding)" : "reconciled ✅"}`,
      ...formatContactAlertLines({ name: prospectName, phone: prospectPhone, label: "Client" }),
      `GHS ${Number(amountGhs || 0).toFixed(2)} · ${points} credits`,
      pendingCredit
        ? "Credits will apply automatically when this phone is onboarded as a client."
        : `Credited to: ${creditClient?.display_name || creditInstance} · balance ${balance}`,
      reference ? `Ref: ${reference}` : null
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await notifyAgencyPaymentOps({
        db,
        evoApiUrl,
        resolveToken,
        text: opsMsg
      });
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), agencyPayOpsNotify: error.message }));
    }
    return true;
  }

  const client = getClient(db, instanceName);
  if (!client?.contact_phone) return null;
  await sendAgencyText({
    db,
    evoApiUrl,
    resolveToken,
    agencyInstance,
    toPhone: client.contact_phone,
    text: [
      `Payment confirmed for ${client.display_name || instanceName}.`,
      `+${points} points added.`,
      `New balance: ${balance}.`
    ].join("\n")
  });
  return true;
}
