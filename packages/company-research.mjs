/**
 * Lightweight public-page research for marketing leads.
 * Fetches only publicly reachable HTML and extracts evidence — no invented facts.
 */

import { extractWhatsappPhoneFromText, normalizeGhanaPhone } from "./hub-db/marketing.mjs";

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    "i"
  );
  return html.match(re)?.[1] || html.match(re2)?.[1] || "";
}

function guessIndustry(text) {
  const t = String(text || "").toLowerCase();
  const rules = [
    [/salon|beauty|barber|nails|spa/, "beauty"],
    [/restaurant|food|catering|kitchen|chop/, "food"],
    [/clinic|hospital|dental|pharmacy|health/, "health"],
    [/real\s*estate|property|rent|apartment/, "real_estate"],
    [/fashion|boutique|clothing|apparel/, "fashion"],
    [/travel|tour|visa|ticket/, "travel"],
    [/school|tuition|education|training/, "education"],
    [/auto|mechanic|car\s*wash|spare\s*parts/, "auto"],
    [/electronics|phone|gadget|laptop/, "electronics"],
    [/gym|fitness|workout/, "fitness"]
  ];
  for (const [re, industry] of rules) {
    if (re.test(t)) return industry;
  }
  return null;
}

function jabOpportunityHint(industry) {
  const map = {
    beauty: "WhatsApp booking + reminder automation so walk-ins stop clogging your DMs",
    food: "WhatsApp order-taking that confirms menu items and delivery details automatically",
    health: "appointment qualification + calendar booking for patient enquiries",
    real_estate: "lead qualification that asks budget/location before a human agent replies",
    fashion: "catalog replies + order confirmation over WhatsApp",
    travel: "enquiry qualification + document checklist follow-ups",
    education: "enrolment enquiry qualification and appointment booking",
    auto: "service-booking and quote follow-ups on WhatsApp",
    electronics: "product enquiry replies and order confirmation",
    fitness: "class booking and membership enquiry automation"
  };
  return map[industry] || "WhatsApp lead replies and follow-ups that stay on-brand for your business";
}

export async function fetchPublicPage(url, { timeoutMs = 12000 } = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "JABHubMarketingBot/1.0 (+local research; public pages only)",
      Accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const html = await response.text();
  return { ok: response.ok, status: response.status, html, finalUrl: response.url || url };
}

export function extractResearchFromHtml(html, { sourceUrl = "", fallback = {} } = {}) {
  const title =
    html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ||
    extractMeta(html, "og:title") ||
    fallback.businessName ||
    "";
  const description =
    extractMeta(html, "og:description") ||
    extractMeta(html, "description") ||
    fallback.adText ||
    "";
  const text = stripHtml(html).slice(0, 6000);
  const combined = `${title}\n${description}\n${text}`;
  const phone =
    normalizeGhanaPhone(fallback.whatsappPhone) ||
    extractWhatsappPhoneFromText(combined) ||
    null;
  const industry = fallback.industry || guessIndustry(combined);
  const snippets = [];
  if (description) snippets.push(description.slice(0, 280));
  const waIdx = combined.toLowerCase().indexOf("whatsapp");
  if (waIdx >= 0) {
    snippets.push(combined.slice(Math.max(0, waIdx - 40), waIdx + 120).trim());
  }
  const summaryParts = [
    title ? `Business/page: ${title.trim()}` : null,
    industry ? `Likely industry: ${industry}` : null,
    phone ? `Public WhatsApp: +${phone}` : "No clear WhatsApp number extracted from page text",
    snippets[0] ? `Evidence: ${snippets[0]}` : null,
    sourceUrl ? `Source: ${sourceUrl}` : null
  ].filter(Boolean);

  return {
    businessName: (fallback.businessName || title || "").trim().slice(0, 120) || null,
    whatsappPhone: phone,
    website: fallback.website || sourceUrl || null,
    industry,
    adText: (fallback.adText || description || "").slice(0, 2000),
    researchSummary: summaryParts.join("\n"),
    researchJson: {
      title: title || null,
      description: description || null,
      snippets: snippets.slice(0, 3),
      opportunityHint: jabOpportunityHint(industry),
      sourceUrl: sourceUrl || null,
      extractedAt: Date.now()
    }
  };
}

export async function researchMarketingLead(lead = {}) {
  const sourceUrl = lead.sourceUrl || lead.source_url || lead.website || "";
  let html = "";
  let fetchError = null;
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
    try {
      const page = await fetchPublicPage(sourceUrl);
      html = page.html || "";
      if (!page.ok && !html) fetchError = `HTTP ${page.status}`;
    } catch (error) {
      fetchError = error.message;
    }
  }

  if (!html) {
    const industry = lead.industry || guessIndustry(`${lead.businessName || ""} ${lead.adText || ""}`);
    const phone = normalizeGhanaPhone(lead.whatsappPhone || lead.whatsapp_phone) || null;
    return {
      businessName: lead.businessName || lead.business_name || null,
      whatsappPhone: phone,
      website: lead.website || sourceUrl || null,
      industry,
      adText: lead.adText || lead.ad_text || "",
      researchSummary: [
        lead.businessName || lead.business_name
          ? `Business: ${lead.businessName || lead.business_name}`
          : null,
        industry ? `Likely industry: ${industry}` : null,
        phone ? `Public WhatsApp: +${phone}` : "WhatsApp number missing",
        lead.adText || lead.ad_text ? `Evidence: ${String(lead.adText || lead.ad_text).slice(0, 280)}` : null,
        sourceUrl ? `Source: ${sourceUrl}` : null,
        fetchError ? `Note: could not fetch page (${fetchError}); using submitted evidence only` : null
      ]
        .filter(Boolean)
        .join("\n"),
      researchJson: {
        opportunityHint: jabOpportunityHint(industry),
        sourceUrl: sourceUrl || null,
        fetchError,
        extractedAt: Date.now()
      }
    };
  }

  return extractResearchFromHtml(html, {
    sourceUrl,
    fallback: {
      businessName: lead.businessName || lead.business_name,
      adText: lead.adText || lead.ad_text,
      whatsappPhone: lead.whatsappPhone || lead.whatsapp_phone,
      website: lead.website,
      industry: lead.industry
    }
  });
}
