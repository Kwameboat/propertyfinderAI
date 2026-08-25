/**
 * UAE Real Estate concierge — main chat orchestrator.
 */

import {
  getSession,
  updateSession,
  formatListingsForPrompt,
  createLead,
  upsertListing,
  getListing
} from "../hub-db/real-estate.mjs";
import { intentNeedsWeb, intentNeedsKnowledge, intentNeedsListings, intentNeedsDeveloperIntel, transactionTypeForIntent, intentNeedsChart } from "./intent.mjs";
import { extractCriteria, scoreLead, normalizeMarketPhone } from "./qualification.mjs";
import { retrieveKnowledge, formatKnowledgeBlockForPrompt } from "./rag.mjs";
import { searchUaeRealEstateWeb, formatWebBlockForPrompt } from "./web.mjs";
import { buildRealEstateSystemPrompt, buildLeadDraftMessage } from "./prompt.mjs";
import { runOpenClawRealEstate, stripHiddenTokens, transcribeVoiceNote } from "./gemini.mjs";
import { buildInsightChartLive, formatChartBlockForPrompt, buildLiveRagContext } from "./market-data.mjs";
import { getListingStore } from "./listings-store.mjs";
import { pullLiveListingsForChat } from "./live-pull.mjs";
import { mergeCriteriaFromSession } from "./live-search-query.mjs";
import { normalizeSearchCriteria, filterListingsByEmirate, resolveEmirateScope, extractEmiratesFromText } from "./emirate-scope.mjs";
import { enrichListingsWithImages, filterValidPortalImages, isValidListingImage, isLocalGhanaMedia, isChatListingImage } from "./listing-images.mjs";
import { userWantsPhotos } from "./intent.mjs";
import { syncSessionToSupabase, syncLeadToSupabase, syncListingToSupabase, isSupabaseEnabled } from "./supabase.mjs";
import { resolveSessionLanguage } from "./language.mjs";
import { buildDeveloperIntelContext, projectsToListingCards } from "./developer-rag.mjs";
import {
  computeMoveInCost,
  parseMoveInCalculatorInput,
  formatMoveInCostWhatsApp,
  userWantsMoveInCalculator
} from "./calculators.mjs";
import {
  userWantsListingCompare,
  resolveCompareListings,
  buildListingComparison,
  formatComparisonBlockForPrompt
} from "./listing-compare.mjs";
import { formatListingTitle, polishListingsForChat } from "./listing-polish.mjs";
import { getMarket, isGhanaMarket, formatMoney, ghanaSystemPromptPrefix } from "./market.mjs";
import { attachClusterMeta, groupListingsByCluster } from "./cluster.mjs";
import { startGhanaViewing } from "./ghana-viewing.mjs";
import { aiDisclaimerText } from "./disclaimer.mjs";
import { classifyChatTurn, loadRecentListings, sessionHasBooking } from "./chat-turn.mjs";
import { enrichListingsWithDetail } from "./listing-detail-enrich.mjs";

function filterListingsByAmenity(listings = [], amenity = "") {
  if (!amenity) return listings;
  const key = String(amenity).toLowerCase();
  return listings.filter((l) => {
    const text = `${(l.amenities || []).join(" ")} ${l.description || ""}`.toLowerCase();
    if (key === "pool") return /pool/.test(text);
    if (key === "pets") return /pet/.test(text);
    if (key === "view") return /sea view|marina view|view/.test(text);
    return true;
  });
}

function parseShortlistId(text) {
  const m = String(text || "").match(/\[SHORTLIST:([^\]]+)\]/i);
  return m ? m[1].trim() : null;
}

function parseLeadReady(text) {
  return /\[LEAD_READY\]/i.test(String(text || ""));
}

export async function handleRentChat(db, { sessionId, message, userPhone = "" } = {}) {
  const session = getSession(db, sessionId);
  if (!session) throw new Error("Session not found");

  const inbound = String(message || "").trim();
  if (!inbound) throw new Error("Message required");
  const wantsPhotos = userWantsPhotos(inbound);

  let criteria = extractCriteria(inbound, session.criteria || {});
  criteria = mergeCriteriaFromSession(criteria, session, { currentMessage: inbound });
  const language = resolveSessionLanguage(inbound, criteria.language || session.criteria?.language);
  criteria = { ...criteria, language };

  const turn = classifyChatTurn(inbound, criteria, session);
  const intent = turn.intent;
  const txType = transactionTypeForIntent(intent, criteria);
  if (txType && !criteria.transaction_type) criteria = { ...criteria, transaction_type: txType };

  let knowledgeBlock = "";
  let webBlock = "";
  let developerIntelBlock = "";
  let listings = [];
  let listingsBlock = "";

  const shouldSearch = turn.shouldSearch;
  const wantsCompare = turn.turn === "compare";

  const needsDeveloperIntel = intentNeedsDeveloperIntel(intent, inbound);
  if (needsDeveloperIntel) {
    try {
      const intel = await buildDeveloperIntelContext(inbound);
      developerIntelBlock = intel.block || "";
      if (intel.projects?.length) {
        const devCards = projectsToListingCards(intel.projects);
        if (devCards.length) {
          const enriched = await enrichListingsWithImages(devCards, { minImages: 0 });
          const byKey = new Map(listings.map((l) => [`${l.source}:${l.external_id}`, l]));
          for (const row of enriched) {
            byKey.set(`${row.source}:${row.external_id}`, row);
          }
          listings = [...byKey.values()].slice(0, 8);
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), developerIntelError: error.message }));
    }
  }

  if (intentNeedsKnowledge(intent) || shouldSearch) {
    const docs = retrieveKnowledge(db, {
      query: inbound,
      intent,
      limit: shouldSearch || intentNeedsListings(intent) ? 6 : 4
    });
    knowledgeBlock = formatKnowledgeBlockForPrompt(docs);
  }

  if (intentNeedsWeb(intent) && !intentNeedsChart(intent, inbound)) {
    try {
      const hits = await searchUaeRealEstateWeb(inbound, { limit: 5 });
      webBlock = formatWebBlockForPrompt(hits);
    } catch {
      webBlock = formatWebBlockForPrompt([]);
    }
  }

  const showChart = intentNeedsChart(intent, inbound) && !wantsCompare;
  let chart = null;
  let chartBlock = "";
  let comparison = null;
  let comparisonBlock = "";

  if (wantsCompare) {
    const resolved = await resolveCompareListings(db, {
      text: inbound,
      session,
      getListingStore,
      explicitIds: criteria.compare_ids || []
    });
    if (resolved.listings.length >= 2) {
      comparison = buildListingComparison(resolved.listings);
      comparisonBlock = formatComparisonBlockForPrompt(comparison);
      listings = resolved.listings;
      criteria = { ...criteria, compare_ids: resolved.ids };
    } else if (resolved.error) {
      comparisonBlock = resolved.error;
    }
  }

  if (showChart) {
    const rag = await buildLiveRagContext(db, criteria, inbound);
    chart = await buildInsightChartLive(db, intent, criteria, inbound, rag.snapshot);
    chartBlock = formatChartBlockForPrompt(chart, rag.liveSearchBlock);
  }

  let searchStatusMessage = "";

  if (turn.shouldReuseRecent && !shouldSearch && !wantsCompare) {
    listings = await loadRecentListings(db, session, {
      getListingStore,
      focusIndex: turn.focusIndex,
      limit: turn.answerMode === "listing_followup" && turn.focusIndex != null ? 3 : 8
    });
    listings = filterListingsByAmenity(listings, criteria.amenity);
    if (listings.length) {
      listings = await enrichListingsWithDetail(listings, { minImages: 4, max: listings.length });
      listingsBlock = formatListingsForPrompt(listings);
    }
  }

  if (shouldSearch && !wantsCompare) {
    const devListingsSnapshot = listings.slice();
    criteria = mergeCriteriaFromSession(criteria, session, { currentMessage: inbound });

    const searchCriteria = normalizeSearchCriteria(
      {
        transaction_type: criteria.transaction_type || "rent",
        emirates: criteria.emirates,
        emirate: criteria.emirate,
        beds: criteria.beds,
        max_price: criteria.max_price,
        min_price: criteria.min_price,
        community: criteria.community,
        furnished: criteria.furnished,
        developer: criteria.developer,
        property_type: criteria.property_type
      },
      { currentMessage: inbound, session }
    );
    const scope = resolveEmirateScope(searchCriteria, { currentMessage: inbound, session });
    const prevEmirate = session.criteria?.emirate;
    const emirateSwitched =
      Boolean(prevEmirate) &&
      searchCriteria.emirate &&
      prevEmirate !== searchCriteria.emirate &&
      extractEmiratesFromText(inbound).includes(searchCriteria.emirate);

    criteria = { ...criteria, emirate: searchCriteria.emirate };
    if (searchCriteria.emirates) criteria.emirates = searchCriteria.emirates;
    else delete criteria.emirates;
    if (searchCriteria.community) criteria.community = searchCriteria.community;
    else delete criteria.community;

    const livePull = await pullLiveListingsForChat(db, searchCriteria, {
      limit: 8,
      message: inbound,
      session,
      wantsPhotos,
      forcePortal: emirateSwitched
    });
    listings = filterListingsByEmirate(livePull.listings, scope);
    listings = filterListingsByAmenity(listings, searchCriteria.amenity || criteria.amenity);
    searchStatusMessage = livePull.searchMessage || "";

    listingsBlock = formatListingsForPrompt(listings);

    if (isGhanaMarket()) {
      const grouped = groupListingsByCluster(listings);
      listings = grouped.map((g) => attachClusterMeta(g.listing, g.offers));
      listingsBlock = formatListingsForPrompt(listings);
    } else if (devListingsSnapshot.length) {
      const byKey = new Map(listings.map((l) => [`${l.source}:${l.external_id}`, l]));
      for (const row of devListingsSnapshot) {
        byKey.set(`${row.source}:${row.external_id}`, row);
      }
      listings = polishListingsForChat(
        filterListingsByEmirate([...byKey.values()], scope),
        searchCriteria,
        { limit: 8 }
      );
      listingsBlock = formatListingsForPrompt(listings);
    }
  }

  const hasListings = listings.length > 0;

  const chatHistory = (session.messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    text: m.body
  }));

  const systemPrompt = buildRealEstateSystemPrompt({
    criteria,
    knowledgeBlock,
    webBlock,
    developerIntelBlock,
    chartBlock,
    comparisonBlock,
    listingsBlock:
      turn.answerMode === "post_booking"
        ? ""
        : shouldSearch && !wantsCompare
          ? listingsBlock
          : listings.length
            ? formatListingsForPrompt(listings)
            : "",
    intent,
    answerMode: turn.answerMode,
    focusListingIndex: turn.focusIndex,
    userMessage: inbound,
    showListings: hasListings && !wantsCompare && turn.answerMode !== "faq" && turn.answerMode !== "market" && turn.answerMode !== "post_booking",
    showPhotos: hasListings && !wantsCompare && (shouldSearch || turn.answerMode === "listing_followup") && turn.answerMode !== "post_booking",
    showChart: Boolean(chart),
    showComparison: Boolean(comparison),
    showDeveloperIntel: Boolean(developerIntelBlock),
    language
  });

  const sessionKey = `hook:rent:${sessionId}`;
  const rawReply = await runOpenClawRealEstate({
    systemPrompt,
    userMessage: inbound,
    sessionKey,
    history: chatHistory
  });

  const shortlistId = parseShortlistId(rawReply);
  const leadReady = parseLeadReady(rawReply);
  let displayText =
    stripHiddenTokens(rawReply) ||
    (hasListings
      ? wantsPhotos
        ? "Here you go — swipe through the photos below."
        : "Here are a few that caught my eye — photos below."
      : developerIntelBlock
        ? "Here's the latest from official developer and government sources."
        : sessionHasBooking({ ...session, criteria })
          ? "Your viewing request is already in — we'll call you to confirm, then contact the agent."
          : "I don't have a live match yet — try another area or bed count.");

  if (userWantsMoveInCalculator(inbound) || (intent === "move_in" && /cost|calculator|upfront|cheque|deposit/.test(inbound.toLowerCase()))) {
    const parsed = parseMoveInCalculatorInput(inbound);
    const annualRent = parsed.annualRent || criteria.max_price || criteria.min_price || 0;
    if (annualRent > 0) {
      const calc = computeMoveInCost({
        annualRent,
        includeChiller: parsed.includeChiller,
        depositMonths: parsed.depositMonths
      });
      displayText = `${displayText}\n\n${formatMoveInCostWhatsApp(calc)}`.trim();
    }
  }

  if (shortlistId) {
    try {
      const picked = await getListingStore(db, shortlistId);
      if (picked) {
        listings = [picked, ...listings.filter((l) => l.id !== picked.id)].slice(0, 8);
      }
    } catch {
      /* keep search results */
    }
    criteria = { ...criteria, last_shortlist_id: shortlistId };
  }

  const showListingCards =
    listings.length > 0 &&
    !wantsCompare &&
    turn.answerMode !== "faq" &&
    turn.answerMode !== "market" &&
    turn.answerMode !== "post_booking" &&
    turn.answerMode !== "greeting" &&
    (shouldSearch || turn.answerMode === "listing_followup" || turn.answerMode === "search");

  if (listings.length && !wantsCompare) {
    const snapshots = listings.slice(0, 8).map((l) => listingSnapshot(l, criteria));
    criteria = {
      ...criteria,
      recent_listing_ids: snapshots.map((l) => l.id).filter(Boolean),
      recent_listings: snapshots
    };
  }

  updateSession(db, sessionId, {
    criteria,
    userPhone: userPhone || undefined,
    appendMessage: { role: "user", body: inbound, at: Date.now() },
    status: leadReady && session.status !== "lead_submitted" ? "lead_pending" : session.status
  });
  updateSession(db, sessionId, {
    appendMessage: { role: "assistant", body: displayText, at: Date.now() }
  });

  return {
    text: displayText,
    intent,
    criteria,
    showListings: showListingCards,
    showPhotos: showListingCards,
    showChart: Boolean(chart),
    showComparison: Boolean(comparison),
    comparison,
    chart,
    dataSource: chart?.dataSource || null,
    developerIntel: Boolean(developerIntelBlock),
    listings: showListingCards ? listings.slice(0, 8).map((l) => formatListingCard(l, criteria)) : [],
    keepListings: !shouldSearch && !wantsCompare && turn.answerMode !== "post_booking" && turn.answerMode !== "greeting",
    searchStatus: searchStatusMessage,
    shortlistId,
    leadReady,
    language: criteria.language,
    aiDisclaimer: aiDisclaimerText(criteria.language),
    supabase: isSupabaseEnabled()
  };
}

export async function handleRentTranscribe({ audioBase64, mimeType = "audio/webm" } = {}) {
  const transcript = await transcribeVoiceNote({ base64: audioBase64, mimetype: mimeType });
  const language = resolveSessionLanguage(transcript);
  return { transcript, language };
}

function listingKey(l = {}) {
  if (l.source && l.external_id) return `${l.source}:${l.external_id}`;
  return l.id || null;
}

function listingSnapshot(l, criteria = {}) {
  const card = formatListingCard(l, criteria);
  return {
    ...card,
    images: (card.images || []).slice(0, 8),
    description: String(card.description || "").slice(0, 800)
  };
}

export function formatListingCard(l, criteria = {}) {
  const title = l.title || formatListingTitle(l, criteria);
  const rawImages = [...(l.images || []), l.image].filter(Boolean).map(String);
  const local = rawImages.filter(isLocalGhanaMedia);
  const portal = filterValidPortalImages(rawImages);
  const loose = [...new Set(rawImages)].filter(isChatListingImage);
  const images = local.length ? local : portal.length ? portal : loose;
  return {
    id: (l.id && !isCompositeListingId(l.id) ? l.id : null) || listingKey(l) || l.id,
    title,
    transaction_type: l.transaction_type,
    property_type: l.property_type,
    emirate: l.emirate,
    community: l.community,
    sub_community: l.sub_community,
    building: l.building,
    beds: l.beds,
    baths: l.baths,
    size_sqft: l.size_sqft,
    price_aed: l.price_aed,
    price_period: l.price_period,
    currency: getMarket().currency,
    cluster_id: l.cluster_id || null,
    other_agent_count: l.other_agent_count || 0,
    other_agents: l.other_agents || [],
    furnished: l.furnished,
    developer: l.developer,
    handover_date: l.handover_date,
    payment_plan: l.payment_plan,
    image: images[0] || l.image || null,
    images,
    agent_name: l.agent_name,
    agent_phone: l.agent_phone,
    agency_name: l.agency_name,
    source: l.source,
    external_id: l.external_id || null,
    source_url: l.source_url,
    description: String(l.description || "").slice(0, 1200),
    amenities: l.amenities || []
  };
}

export function formatListingDetail(l) {
  return {
    ...formatListingCard(l),
    property_type: l.property_type,
    sub_community: l.sub_community,
    building: l.building,
    amenities: l.amenities || [],
    agency_name: l.agency_name,
    description: String(l.description || "").trim()
  };
}

function parseCompositeListingId(id = "") {
  const key = String(id || "").trim();
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  return { source: key.slice(0, idx), external_id: key.slice(idx + 1) };
}

function isCompositeListingId(id = "") {
  return String(id || "").includes(":");
}

function findListingSnapshot(session = {}, listingId = "") {
  const key = String(listingId || "").trim();
  if (!key) return null;
  const snapshots = session.criteria?.recent_listings || [];
  return (
    snapshots.find((s) => String(s.id) === key) ||
    snapshots.find((s) => s.source && s.external_id && `${s.source}:${s.external_id}` === key) ||
    null
  );
}

function prepareListingForLeadUpsert(listing = {}, listingId = "") {
  const ref = parseCompositeListingId(listingId);
  const next = { ...listing };
  if (ref) {
    next.source = next.source || ref.source;
    next.external_id = next.external_id || ref.external_id;
  }
  if (isCompositeListingId(next.id)) delete next.id;
  if (!next.source || !next.external_id) return null;
  if (!next.transaction_type) next.transaction_type = "rent";
  if (!next.emirate) next.emirate = "Dubai";
  return next;
}

async function resolveListingForLead(db, session = {}, listingId = "") {
  const key = String(listingId || "").trim();
  if (!key) return { listing: null, resolvedId: null };

  let listing = await getListingStore(db, key);
  if (!listing) {
    const snap = findListingSnapshot(session, key);
    if (snap) listing = { ...snap };
  }

  const payload = prepareListingForLeadUpsert(listing || {}, key);
  if (!payload) {
    return { listing: listing || null, resolvedId: null };
  }

  const local = upsertListing(db, payload);
  return { listing: local || listing, resolvedId: local?.id || null };
}

export async function submitRentLead(db, { sessionId, listingId, renterName, renterPhone, consent, notes = "", channel = "pwa" }) {
  if (!consent) throw new Error("Consent required to share details with listing agent");
  const session = getSession(db, sessionId);
  if (!session) throw new Error("Session not found");

  const phone = normalizeMarketPhone(renterPhone);
  if (!phone) throw new Error(isGhanaMarket() ? "Valid Ghana phone number required" : "Valid UAE phone number required");

  const { listing, resolvedId } = await resolveListingForLead(db, session, listingId);

  const criteria = session.criteria || {};
  const score = scoreLead(criteria, session.messages || []);

  const draft = buildLeadDraftMessage({
    lead: { renter_name: renterName, renter_phone: phone, notes },
    listing,
    criteria
  });

  const lead = createLead(db, {
    session_id: sessionId,
    listing_id: resolvedId,
    renter_name: renterName,
    renter_phone: phone,
    criteria,
    qualification_score: score,
    consent_at: Date.now(),
    notes: String(notes || "").trim(),
    draft_message: draft,
    channel
  });

  const listingTitle = listing ? formatListingTitle(listing, criteria) : "";
  if (isGhanaMarket()) {
    const pay = await startGhanaViewing(db, {
      lead,
      listing,
      sessionId,
      renterName,
      renterPhone: phone,
      notes
    });
    const confirmText = listingTitle
      ? `Pay GH₵100 to confirm your viewing for ${listingTitle}. GH₵50 stays with KeyFinder; GH₵50 is paid to the listing agent after you visit and they send your PIN.`
      : `Pay GH₵100 to confirm this viewing. You will get a PIN on WhatsApp after payment.`;
    updateSession(db, sessionId, {
      status: "awaiting_payment",
      userPhone: phone,
      criteria: {
        ...criteria,
        booked_listing_id: resolvedId || listingId || null,
        booked_listing_title: listingTitle || "",
        viewing_id: pay.viewing.id
      },
      appendMessage: {
        role: "assistant",
        body: confirmText,
        at: Date.now()
      }
    });
    return {
      ok: true,
      payToView: true,
      text: confirmText,
      lead,
      listing: listing ? formatListingCard(listing) : null,
      viewing: pay.viewing,
      authorizationUrl: pay.authorizationUrl,
      reference: pay.reference,
      amountGhs: pay.amountGhs,
      paystackConfigured: pay.paystackConfigured,
      devPay: pay.devPay,
      draft_message: draft
    };
  }
  const confirmText = listingTitle
    ? `Viewing booked for ${listingTitle} — we'll call ${phone} to confirm, then reach out to the agent. I won't keep sending more homes unless you ask to keep looking.`
    : `Viewing booked — we'll call ${phone} to confirm, then reach out to the agent. I won't keep sending more homes unless you ask to keep looking.`;

  updateSession(db, sessionId, {
    status: "lead_submitted",
    userPhone: phone,
    criteria: {
      ...criteria,
      booked_listing_id: resolvedId || listingId || null,
      booked_listing_title: listingTitle || "",
      booked_community: listing?.community || criteria.community || "",
      booked_at: Date.now()
    },
    appendMessage: {
      role: "user",
      body: `I booked a viewing${listingTitle ? ` for ${listingTitle}` : ""}${notes ? ` (${notes})` : ""}. Name: ${renterName}. Phone: ${phone}.`,
      at: Date.now()
    }
  });
  updateSession(db, sessionId, {
    appendMessage: { role: "assistant", body: confirmText, at: Date.now() }
  });

  if (isSupabaseEnabled()) {
    try {
      await syncSessionToSupabase(getSession(db, sessionId));
      await syncLeadToSupabase(lead, listing);
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), supabaseLeadSyncError: error.message }));
    }
  }

  return {
    ok: true,
    text: confirmText,
    lead,
    listing: listing ? formatListingCard(listing) : null,
    draft_message: draft
  };
}

export async function syncAllListingsToSupabase(db) {
  if (!isSupabaseEnabled()) return { synced: 0 };
  const rows = db.prepare(`SELECT id FROM re_listings WHERE is_active = 1`).all();
  let synced = 0;
  for (const row of rows) {
    const listing = getListing(db, row.id);
    if (listing) {
      await syncListingToSupabase(listing);
      synced++;
    }
  }
  return { synced };
}
