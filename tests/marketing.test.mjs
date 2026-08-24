/**
 * Unit tests for proactive marketing helpers (no network).
 * Run: node --test tests/marketing.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGhanaPhone,
  extractWhatsappPhoneFromText,
  makeLeadFingerprint,
  openHubDb,
  upsertMarketingLead,
  approveMarketingLead,
  markMarketingLeadSent,
  claimDueFollowUpJobs,
  scheduleFollowUpJob,
  completeFollowUpJob,
  cancelFollowUpsForLead,
  countMarketingSendsToday,
  wasPhoneContactedRecently
} from "../packages/hub-db/index.mjs";
import {
  normalizeDiscoveryHit,
  scoreMarketingLead,
  looksLikeBusinessAd,
  detectPlatform
} from "../packages/marketing-discovery.mjs";
import {
  buildAgencyColdOutreachFallback,
  buildAgencyColdOutreachDraftPrompt
} from "../packages/agency-growth-prompt.mjs";
import { extractResearchFromHtml } from "../packages/company-research.mjs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

test("normalizeGhanaPhone handles local and international forms", () => {
  assert.equal(normalizeGhanaPhone("0244123456"), "233244123456");
  assert.equal(normalizeGhanaPhone("+233 24 412 3456"), "233244123456");
  assert.equal(normalizeGhanaPhone("233244123456"), "233244123456");
});

test("extractWhatsappPhoneFromText finds wa.me links", () => {
  assert.equal(
    extractWhatsappPhoneFromText("Order now https://wa.me/233244123456 thanks"),
    "233244123456"
  );
  assert.equal(
    extractWhatsappPhoneFromText("Chat https://api.whatsapp.com/send?phone=233201112233"),
    "233201112233"
  );
});

test("fingerprint prefers phone then url", () => {
  assert.equal(
    makeLeadFingerprint({ whatsappPhone: "0244123456", sourceUrl: "https://x.com" }),
    "phone:233244123456"
  );
  assert.match(
    makeLeadFingerprint({ sourceUrl: "https://www.Example.com/shop/" }),
    /^url:example.com\/shop$/
  );
});

test("discovery scoring rewards WhatsApp CTA + Ghana business signals", () => {
  const hit = normalizeDiscoveryHit({
    url: "https://facebook.com/mysalon",
    title: "Glow Salon Accra",
    description: "Book now on WhatsApp https://wa.me/233244998877 beauty salon Accra"
  });
  assert.equal(hit.whatsappPhone, "233244998877");
  assert.equal(hit.platform, "facebook");
  assert.ok(hit.score >= 60);
  assert.equal(hit.eligible, true);
  assert.equal(looksLikeBusinessAd("random poem about clouds"), false);
  assert.equal(detectPlatform("https://instagram.com/p/abc"), "instagram");
});

test("research extraction pulls title and phone from html", () => {
  const html = `
    <html><head><title>Kofi Provisions</title>
    <meta name="description" content="Grocery delivery Accra. WhatsApp us."/>
    </head><body>Call https://wa.me/233551234567 for orders</body></html>
  `;
  const r = extractResearchFromHtml(html, { sourceUrl: "https://example.com" });
  assert.equal(r.businessName, "Kofi Provisions");
  assert.equal(r.whatsappPhone, "233551234567");
  assert.match(r.researchSummary, /Kofi Provisions/);
});

test("cold outreach fallback is short and human", () => {
  const text = buildAgencyColdOutreachFallback({
    businessName: "Glow Salon",
    industry: "beauty",
    opportunityHint: "WhatsApp booking automation",
    adText: "Chat on WhatsApp to book"
  });
  assert.match(text, /Glow Salon/);
  assert.ok(text.split("\n").length <= 5);
  assert.ok(!text.includes("[HANDOFF]"));
  assert.match(buildAgencyColdOutreachDraftPrompt({ businessName: "X" }), /Output ONLY/);
});

test("marketing lead approve/send and follow-up claim are transactional", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jab-mkt-"));
  const { db } = openHubDb(dir);
  const { lead } = upsertMarketingLead(db, {
    instanceName: "jab-whatsapp",
    source: "test",
    sourceUrl: "https://example.com/a",
    businessName: "Test Biz",
    whatsappPhone: "0551112233",
    adText: "WhatsApp shop Accra",
    score: 80,
    draftMessage: "Hi Test Biz"
  });
  assert.ok(lead.id);
  const approved = approveMarketingLead(db, lead.id, { approvedBy: "1" });
  assert.equal(approved.status, "approved");
  const sent = markMarketingLeadSent(db, lead.id);
  assert.equal(sent.status, "sent");
  assert.equal(countMarketingSendsToday(db, "jab-whatsapp"), 1);
  assert.equal(wasPhoneContactedRecently(db, "jab-whatsapp", "0551112233", 86400000), true);

  const job = scheduleFollowUpJob(db, {
    leadId: lead.id,
    instanceName: "jab-whatsapp",
    phone: lead.whatsapp_phone,
    dueAt: Date.now() - 1000,
    idempotencyKey: `test-fu-${lead.id}`
  });
  assert.ok(job.id);
  const claimed = claimDueFollowUpJobs(db, { limit: 5 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "claimed");
  // second claim should get nothing
  assert.equal(claimDueFollowUpJobs(db, { limit: 5 }).length, 0);
  completeFollowUpJob(db, claimed[0].id, { status: "done" });
  cancelFollowUpsForLead(db, lead.id, "test");
});
