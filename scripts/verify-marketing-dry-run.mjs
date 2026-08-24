/**
 * Dry-run verification for proactive marketing (no Telegram / no WhatsApp send).
 * Run: node scripts/verify-marketing-dry-run.mjs
 */
import {
  openHubDb,
  upsertMarketingLead,
  updateMarketingLead,
  approveMarketingLead,
  markMarketingLeadSent,
  getMarketingLead,
  scheduleFollowUpJob,
  claimDueFollowUpJobs,
  completeFollowUpJob,
  getMarketingStats
} from "../packages/hub-db/index.mjs";
import { researchMarketingLead } from "../packages/company-research.mjs";
import {
  buildAgencyColdOutreachFallback,
  buildAgencyColdOutreachDraftPrompt
} from "../packages/agency-growth-prompt.mjs";
import { normalizeDiscoveryHit } from "../packages/marketing-discovery.mjs";

const INSTANCE = "jab-whatsapp";
const { db } = openHubDb();

const hit = normalizeDiscoveryHit({
  source: "verify",
  url: "https://example.com/ghana-shop",
  title: "Ada Provisions Accra",
  description: "Order groceries on WhatsApp https://wa.me/233200000001 Accra delivery"
});

const { lead } = upsertMarketingLead(db, {
  instanceName: INSTANCE,
  ...hit,
  draftMessage: ""
});

const research = await researchMarketingLead(lead);
const draft =
  buildAgencyColdOutreachFallback({
    businessName: research.businessName || lead.business_name,
    industry: research.industry,
    opportunityHint: research.researchJson?.opportunityHint,
    adText: research.adText || lead.ad_text
  }) || "Hi there";

updateMarketingLead(db, lead.id, {
  businessName: research.businessName || lead.business_name,
  industry: research.industry,
  researchSummary: research.researchSummary,
  researchJson: research.researchJson,
  draftMessage: draft,
  status: "queued"
});

const approved = approveMarketingLead(db, lead.id, { approvedBy: "dry-run-verify" });
const sent = markMarketingLeadSent(db, approved.id);
scheduleFollowUpJob(db, {
  leadId: sent.id,
  instanceName: INSTANCE,
  phone: sent.whatsapp_phone,
  dueAt: Date.now() - 1000,
  idempotencyKey: `verify-fu-${sent.id}-${Date.now()}`
});
const claimed = claimDueFollowUpJobs(db, { limit: 1 });
if (claimed[0]) completeFollowUpJob(db, claimed[0].id, { status: "done" });

const finalLead = getMarketingLead(db, lead.id);
const promptSample = buildAgencyColdOutreachDraftPrompt({
  businessName: finalLead.business_name,
  industry: finalLead.industry,
  adText: finalLead.ad_text,
  researchSummary: finalLead.research_summary
}).slice(0, 120);

console.log(
  JSON.stringify(
    {
      ok: true,
      leadId: finalLead.id,
      phone: finalLead.whatsapp_phone,
      status: finalLead.status,
      score: finalLead.score,
      draftPreview: String(finalLead.draft_message).slice(0, 160),
      stats: getMarketingStats(db, INSTANCE),
      promptSample
    },
    null,
    2
  )
);
