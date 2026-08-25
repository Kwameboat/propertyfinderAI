import test from "node:test";
import assert from "node:assert/strict";
import {
  formatListingWhatsAppCaption,
  isGhanaReWhatsAppInstance,
  isLoopbackAddress,
  isReWhatsAppInstance
} from "../packages/real-estate/re-wa.mjs";
import { ghanaWaPhoneDigits, publicMarketConfig } from "../packages/real-estate/market.mjs";

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test("Ghana WhatsApp captions use GH₵ per month, not AED /yr", () =>
  withEnv({ JAB_RE_MARKET: "GH" }, () => {
    const caption = formatListingWhatsAppCaption(
      {
        title: "Self-contain East Legon",
        transaction_type: "rent",
        price_aed: 1800,
        community: "East Legon"
      },
      1
    );
    assert.match(caption, /GH₵/);
    assert.match(caption, /\/mo/);
    assert.equal(caption.includes("AED"), false);
    assert.equal(caption.includes("/yr"), false);
  }));

test("UAE WhatsApp captions stay AED /yr", () =>
  withEnv({ JAB_RE_MARKET: "AE" }, () => {
    const caption = formatListingWhatsAppCaption({
      title: "Marina 2BR",
      transaction_type: "rent",
      price_aed: 120000,
      community: "Dubai Marina"
    });
    assert.match(caption, /AED/);
    assert.match(caption, /\/yr/);
  }));

test("Ghana WA instance is distinct from UAE concierge instance", () =>
  withEnv(
    {
      JAB_RE_WA_INSTANCE: "dar-concierge-wa",
      JAB_RE_GH_WA_INSTANCE: "fie-ghana-wa"
    },
    () => {
      assert.equal(isReWhatsAppInstance("dar-concierge-wa"), true);
      assert.equal(isReWhatsAppInstance("fie-ghana-wa"), false);
      assert.equal(isGhanaReWhatsAppInstance("fie-ghana-wa"), true);
      assert.equal(isGhanaReWhatsAppInstance("dar-concierge-wa"), false);
    }
  ));

test("Ghana wa.me digits normalize 024 and +233", () => {
  assert.equal(ghanaWaPhoneDigits("0244111222"), "233244111222");
  assert.equal(ghanaWaPhoneDigits("+233 24 411 1222"), "233244111222");
  assert.equal(ghanaWaPhoneDigits(""), "");
});

test("public market config exposes WhatsApp only in Ghana", () =>
  withEnv({ JAB_RE_MARKET: "GH", JAB_RE_WA_PHONE: "0244111222" }, () => {
    const cfg = publicMarketConfig();
    assert.equal(cfg.whatsappPhone, "233244111222");
  }));

test("loopback check for Ghana inbound proxy", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("169.58.81.179"), false);
});
