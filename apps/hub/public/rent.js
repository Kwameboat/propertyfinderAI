import { initPwaInstall, registerRentServiceWorker } from "./rent-pwa.js";

const chatEl = document.getElementById("chat");
const chatListingsEl = document.getElementById("chat-listings");
const chatPanel = document.getElementById("panel-concierge");
const heroCard = document.getElementById("hero-card");
const quickActions = document.getElementById("quick-actions");
const heroGreeting = document.getElementById("hero-greeting");
const composerWrap = document.getElementById("composer-wrap");
const exploreGrid = document.getElementById("explore-grid");
const savedGrid = document.getElementById("saved-grid");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const micBtn = document.getElementById("mic-btn");
const recordingBar = document.getElementById("recording-bar");
const recordingLabel = document.getElementById("recording-label");
let marketConfig = {
  code: "AE",
  brand: "Dar Concierge AI",
  currency: "AED",
  payToView: false,
  viewingFeeGhs: 0,
  phoneLabel: "UAE phone",
  phonePlaceholder: "+971 50 xxx xxxx",
  consent: "I agree to share my details with the listing agent",
  logo: "/dar-concierge-logo.png"
};

async function loadMarketConfig() {
  try {
    const res = await fetch("/api/rent/config");
    const data = await res.json();
    if (data.ok && data.market) marketConfig = { ...marketConfig, ...data.market };
  } catch {
    /* keep defaults */
  }
  applyMarketBranding();
}

function applyMarketBranding() {
  const ghana = marketConfig.code === "GH";
  document.body?.classList.toggle("market-gh", ghana);
  document.title = marketConfig.brand || document.title;
  if (ghana) {
    BRAND.name = "FIE AI";
    BRAND.nameUpper = "FIE AI";
    BRAND.tagline = "Your AI real estate agent in Ghana";
    BRAND.poweredBy = "FIE AI";
    BRAND.poweredLine = "Your AI real estate agent in Ghana";
  }
  document.querySelector('meta[name="description"]')?.setAttribute(
    "content",
    ghana
      ? "FIE AI — your AI real estate agent in Ghana. Rent or buy rooms, self-contains, apartments, and houses. Landlords and agents can list directly. Pay GH₵100 to view."
      : "Dar Concierge AI — Your UAE AI Property Assistant. Powered by KeyFinder AI."
  );
  document.querySelectorAll(".logo-link").forEach((a) => {
    a.setAttribute("href", ghana ? "/gh" : "/rent");
    a.setAttribute("aria-label", `${marketConfig.brand || "Home"} home`);
  });
  if (ghana) {
    const logo = marketConfig.logo || "/fie-ai-logo.webp";
    document.querySelectorAll(".brand-logo").forEach((img) => {
      img.src = logo;
      img.alt = "FIE AI";
    });
  }
  if (heroGreeting) {
    heroGreeting.textContent = ghana
      ? "Welcome. Looking for a self-contain in East Legon or a chamber and hall in Osu?"
      : heroGreeting.textContent;
  }
  const powered = document.querySelector(".hero-powered");
  if (powered && ghana) powered.textContent = "Your AI real estate agent in Ghana";
  const pills = document.querySelectorAll(".hero-suggestions .pill");
  if (ghana && pills[0] && pills[1]) {
    pills[0].textContent = "East Legon self-contain";
    pills[0].dataset.msg = "Show me self-contain rooms for rent in East Legon";
    pills[1].textContent = "East Legon for sale";
    pills[1].dataset.msg = "Show me houses for sale in East Legon";
  }
  const actions = document.querySelectorAll("#quick-actions .action-card");
  if (ghana && actions.length >= 3) {
    actions[0].dataset.msg = "What does a self-contain in East Legon usually cost per month?";
    actions[0].querySelector("span:last-child").textContent = "Accra rents";
    actions[1].dataset.msg = "I can't pay 2 years rent advance. Who pays the landlord so I can pay monthly?";
    actions[1].querySelector("span:last-child").textContent = "Pay monthly";
    actions[2].dataset.msg = "How does the GH₵100 viewing fee and PIN work?";
    actions[2].querySelector("span:last-child").textContent = "Viewing fee";
  }
  const exploreDubai = document.querySelector('.explore-filters [data-filter="Dubai"]');
  if (ghana && exploreDubai) {
    exploreDubai.textContent = "Accra";
    exploreDubai.dataset.filter = "Accra";
  }
  if (input) input.placeholder = composerPlaceholder();
  if (!localStorage.getItem(PROFILE_KEY)) {
    const ini = defaultInitials();
    if (headerAvatar) headerAvatar.textContent = ini;
    if (profileAvatarLg) profileAvatarLg.textContent = ini;
  }
  const disclaimer = document.querySelector(".profile-card .disclaimer");
  if (disclaimer && ghana) {
    disclaimer.textContent =
      "FIE AI connects you with listing agents in Ghana. Pay GH₵100 to view. We are not a landlord.";
  }
  const pwaCopy = document.querySelector(".pwa-install-copy strong");
  if (pwaCopy && ghana) pwaCopy.textContent = "Install FIE AI";
  const pwaSpan = document.querySelector(".pwa-install-copy span");
  if (pwaSpan && ghana) pwaSpan.textContent = "Add FIE AI to your home screen.";
  const menuPowered = document.querySelectorAll(".side-menu-powered, .side-menu-foot-brand");
  menuPowered.forEach((el) => {
    if (ghana) el.textContent = "FIE AI · Ghana";
  });
  const phoneInput = leadForm?.querySelector('input[name="phone"]');
  const phoneLabel = phoneInput?.closest("label");
  if (phoneInput) phoneInput.placeholder = marketConfig.phonePlaceholder || phoneInput.placeholder;
  if (phoneLabel) {
    const text = phoneLabel.childNodes[0];
    if (text && text.nodeType === Node.TEXT_NODE) text.textContent = marketConfig.phoneLabel || "Phone";
  }
  const consentLabel = leadForm?.querySelector('input[name="consent"]')?.closest("label");
  if (consentLabel && marketConfig.consent) {
    const box = consentLabel.querySelector("input");
    consentLabel.textContent = "";
    if (box) consentLabel.append(box, " ", document.createTextNode(marketConfig.consent));
  }
  const muted = document.querySelector("#lead-form > p.muted");
  if (muted && marketConfig.payToView) {
    muted.textContent = `Pay GH₵${marketConfig.viewingFeeGhs || 100} to book. GH₵50 for FIE AI, GH₵50 held for the agent until you view.`;
  }
  if (marketConfig.payToView) {
    const btn = document.getElementById("lead-submit");
    if (btn) btn.textContent = `Pay GH₵${marketConfig.viewingFeeGhs || 100}`;
  }
  document.querySelectorAll(".gh-only").forEach((el) => {
    el.classList.toggle("hidden", !ghana);
    el.hidden = !ghana;
  });
  fillOwnerListingCities();
  const menuNav = document.querySelector(".side-menu-nav");
  if (ghana && menuNav && !document.getElementById("gh-agent-link")) {
    const a = document.createElement("a");
    a.id = "gh-agent-link";
    a.className = "side-menu-link";
    a.href = "/gh/agent";
    a.textContent = "Listing agent: enter PIN";
    menuNav.appendChild(a);
  }
}
const leadDialog = document.getElementById("lead-dialog");
const leadForm = document.getElementById("lead-form");
const leadCancel = document.getElementById("lead-cancel");
const leadTitle = document.getElementById("lead-title");
const leadListing = document.getElementById("lead-listing");
const listingDialog = document.getElementById("listing-dialog");
const listingDetailEl = document.getElementById("listing-detail");
const listingClose = document.getElementById("listing-close");
const ownerListingDialog = document.getElementById("owner-listing-dialog");
const ownerListingForm = document.getElementById("owner-listing-form");
const ownerListingCancel = document.getElementById("owner-listing-cancel");
const ownerListingError = document.getElementById("owner-listing-error");
const compareDialog = document.getElementById("compare-dialog");
const compareContent = document.getElementById("compare-content");
const compareClose = document.getElementById("compare-close");
const savedCompareBtn = document.getElementById("saved-compare-btn");
const photoLightbox = document.getElementById("photo-lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCounter = document.getElementById("lightbox-counter");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");
const profileNameInput = document.getElementById("profile-name");
const saveProfileBtn = document.getElementById("save-profile");
const headerAvatar = document.getElementById("header-avatar");
const profileAvatarLg = document.getElementById("profile-avatar-lg");
const profileShortcut = document.getElementById("profile-shortcut");
const menuBtn = document.getElementById("menu-btn");
const menuOverlay = document.getElementById("menu-overlay");
const sideMenu = document.getElementById("side-menu");
const menuClose = document.getElementById("menu-close");
const newChatBtn = document.getElementById("new-chat-btn");
const sessionListEl = document.getElementById("session-list");
const sessionCountEl = document.getElementById("session-count");
const clearSessionsBtn = document.getElementById("clear-sessions-btn");

const panels = {
  concierge: document.getElementById("panel-concierge"),
  explore: document.getElementById("panel-explore"),
  saved: document.getElementById("panel-saved"),
  profile: document.getElementById("panel-profile")
};

let sessionId = localStorage.getItem("uae_re_session_id") || "";
let pendingListingId = null;
let pendingListingTitle = "";
let busy = false;
let lightboxImages = [];
let lightboxIndex = 0;
let exploreFilter = "all";
let exploreLoaded = false;
let chatStarted = false;
let lastChatListings = [];
const compareSelection = new Set();

const SAVED_KEY = "uae_re_saved";
const PROFILE_KEY = "uae_re_profile_name";
const LANG_KEY = "uae_re_language";
const SESSIONS_KEY = "uae_re_sessions";
const MAX_SESSION_HISTORY = 20;

const BRAND = {
  name: "Dar Concierge AI",
  nameUpper: "DAR CONCIERGE AI",
  tagline: "Your UAE AI Property Assistant",
  poweredBy: "KeyFinder AI",
  poweredLine: "Powered by KeyFinder AI"
};

const RENT_UI = {
  en: {
    placeholder: "Ask Dar Concierge AI…",
    transcribing: "Transcribing voice…",
    recording: "Recording… tap mic to send",
    micDenied: "Microphone access denied — allow mic in browser settings.",
    voiceFailed: "Could not transcribe — try typing instead.",
    bookViewing: "Book Viewing",
    bookTitle: "Book a Viewing",
    errorGeneric: "Hmm, something went wrong — try again in a moment.",
    searching: "Searching Property Finder, Bayut & Dubizzle for live listings…",
    aiDisclaimer: "This is AI. AI can make mistakes."
  },
  ar: {
    placeholder: "اسأل Dar Concierge AI…",
    aiDisclaimer: "هذا ذكاء اصطناعي. قد يخطئ الذكاء الاصطناعي.",
    transcribing: "جاري تحويل الصوت إلى نص…",
    recording: "جاري التسجيل… اضغط الميكrophone للإرسال",
    micDenied: "تم رفض الميكrophone — فعّله من إعدادات المتصفح.",
    voiceFailed: "تعذّر تحويل الصوت — جرّب الكتابة.",
    bookViewing: "حجز معاينة",
    bookTitle: "حجز معاينة",
    errorGeneric: "حدث خطأ — حاول مرة أخرى."
  },
  hi: {
    placeholder: "Dar Concierge AI से पूछें…",
    aiDisclaimer: "यह AI है। AI गलती कर सकता है।",
    transcribing: "आवाज़ लिखी जा रही है…",
    recording: "रिकॉर्ड हो रहा है… भेजने के लिए माइक टैप करें",
    micDenied: "माइक्रोफ़ोन की अनुमति नहीं मिली।",
    voiceFailed: "ट्रांसक्रिप्शन नहीं हो सका — टाइप करें।",
    bookViewing: "देखने का समय बुक करें",
    bookTitle: "देखने का समय बुक करें",
    errorGeneric: "कुछ गलत हुआ — फिर कोशिश करें।"
  },
  ur: {
    placeholder: "Dar Concierge AI سے پوچھیں…",
    aiDisclaimer: "یہ AI ہے۔ AI غلطی کر سکتا ہے۔",
    transcribing: "آواز لکھی جا رہی ہے…",
    recording: "ریکارڈ ہو رہا ہے… بھیجنے کے لیے مائیک ٹیپ کریں",
    micDenied: "مائیکروفون کی اجازت نہیں ملی۔",
    voiceFailed: "آواز نہیں لکھی جا سکی — ٹائپ کریں۔",
    bookViewing: "ملاقات بک کریں",
    bookTitle: "ملاقات بک کریں",
    errorGeneric: "کچھ غلط ہوا — دوبارہ کوشش کریں۔"
  },
  ru: {
    placeholder: "Спросите Dar Concierge AI…",
    aiDisclaimer: "Это ИИ. ИИ может ошибаться.",
    transcribing: "Расшифровка голоса…",
    recording: "Запись… нажмите микрофон, чтобы отправить",
    micDenied: "Нет доступа к микрофону.",
    voiceFailed: "Не удалось расшифровать — напишите текстом.",
    bookViewing: "Записаться на просмотр",
    bookTitle: "Записаться на просмотр",
    errorGeneric: "Что-то пошло не так — попробуйте снова."
  },
  fr: {
    placeholder: "Demandez à Dar Concierge AI…",
    aiDisclaimer: "Ceci est une IA. L'IA peut se tromper.",
    transcribing: "Transcription en cours…",
    recording: "Enregistrement… appuyez sur le micro pour envoyer",
    micDenied: "Microphone refusé.",
    voiceFailed: "Transcription impossible — écrivez votre message.",
    bookViewing: "Réserver une visite",
    bookTitle: "Réserver une visite",
    errorGeneric: "Une erreur est survenue — réessayez."
  },
  es: {
    placeholder: "Pregunta a Dar Concierge AI…",
    aiDisclaimer: "Esto es IA. La IA puede equivocarse.",
    transcribing: "Transcribiendo voz…",
    recording: "Grabando… toca el micrófono para enviar",
    micDenied: "Micrófono denegado.",
    voiceFailed: "No se pudo transcribir — escribe tu mensaje.",
    bookViewing: "Reservar visita",
    bookTitle: "Reservar visita",
    errorGeneric: "Algo salió mal — inténtalo de nuevo."
  },
  zh: {
    placeholder: "咨询 Dar Concierge AI…",
    aiDisclaimer: "这是 AI。AI 可能会出错。",
    transcribing: "正在转写语音…",
    recording: "录音中… 点击麦克风发送",
    micDenied: "麦克风被拒绝。",
    voiceFailed: "无法转写 — 请改用文字。",
    bookViewing: "预约看房",
    bookTitle: "预约看房",
    errorGeneric: "出了点问题 — 请重试。"
  },
  tl: {
    placeholder: "Magtanong sa Dar Concierge AI…",
    aiDisclaimer: "Ito ay AI. Maaaring magkamali ang AI.",
    transcribing: "Tina-transcribe ang boses…",
    recording: "Nagre-record… tap ang mic para ipadala",
    micDenied: "Tinanggihan ang mikropono.",
    voiceFailed: "Hindi ma-transcribe — mag-type na lang.",
    bookViewing: "Mag-book ng viewing",
    bookTitle: "Mag-book ng viewing",
    errorGeneric: "May problema — subukan muli."
  }
};

let userLanguage = localStorage.getItem(LANG_KEY) || "en";
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recording = false;

function uiText(key) {
  return (RENT_UI[userLanguage] || RENT_UI.en)[key] || RENT_UI.en[key] || "";
}

function isGhanaMarket() {
  return marketConfig.code === "GH";
}

function composerPlaceholder() {
  return isGhanaMarket() ? "Ask FIE AI…" : uiText("placeholder");
}

function defaultInitials() {
  return isGhanaMarket() ? "FI" : "DC";
}

function fillOwnerListingCities() {
  const select = document.getElementById("owner-listing-city");
  if (!select || !Array.isArray(marketConfig.cities) || !marketConfig.cities.length) return;
  const current = select.value;
  select.innerHTML = marketConfig.cities
    .map((city) => `<option value="${escapeAttr(city)}">${escapeHtml(city)}</option>`)
    .join("");
  if (current && marketConfig.cities.includes(current)) select.value = current;
}

function setOwnerListingError(message) {
  if (!ownerListingError) return;
  if (!message) {
    ownerListingError.textContent = "";
    ownerListingError.classList.add("hidden");
    ownerListingError.hidden = true;
    return;
  }
  ownerListingError.textContent = message;
  ownerListingError.classList.remove("hidden");
  ownerListingError.hidden = false;
}

function openOwnerListingDialog() {
  if (!isGhanaMarket() || !ownerListingDialog) return;
  closeMenu?.();
  fillOwnerListingCities();
  setOwnerListingError("");
  ownerListingDialog.showModal();
}

async function submitOwnerListingForm(event) {
  event.preventDefault();
  if (!ownerListingForm) return;
  const submitBtn = document.getElementById("owner-listing-submit");
  const fd = new FormData(ownerListingForm);
  if (!fd.get("consent")) {
    setOwnerListingError("Please confirm you have the right to list this property.");
    return;
  }
  const files = ownerListingForm.querySelector('input[name="photos"]')?.files;
  if (files?.length) {
    const photos = fd.getAll("photos");
    fd.delete("photos");
    [...photos].slice(0, 5).forEach((file) => fd.append("photos", file));
  }
  if (submitBtn) submitBtn.disabled = true;
  setOwnerListingError("");
  try {
    const res = await fetch("/api/rent/owner-listing", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setOwnerListingError(data.error || "Could not publish listing.");
      return;
    }
    ownerListingDialog.close();
    ownerListingForm.reset();
    exploreLoaded = false;
    switchTab("explore");
    if (data.listing?.transaction_type === "sale") {
      document.querySelectorAll(".filter-pill").forEach((p) => p.classList.remove("active"));
      const buy = document.querySelector('.filter-pill[data-filter="sale"]');
      if (buy) buy.classList.add("active");
      exploreFilter = "sale";
    }
    await loadExplore();
  } catch {
    setOwnerListingError("Could not publish listing. Try again.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function aiDisclaimerHtml(text) {
  const line = String(text || uiText("aiDisclaimer") || RENT_UI.en.aiDisclaimer);
  return `<p class="ai-disclaimer" role="note">${escapeHtml(line)}</p>`;
}

function applyUiLanguage(lang) {
  userLanguage = String(lang || "en").toLowerCase();
  localStorage.setItem(LANG_KEY, userLanguage);
  if (input) input.placeholder = composerPlaceholder();
  if (recordingLabel) recordingLabel.textContent = uiText("recording");
  const leadSubmit = document.getElementById("lead-submit");
  if (leadSubmit && !marketConfig.payToView) leadSubmit.textContent = uiText("bookViewing");
  if (leadTitle && !pendingListingTitle) leadTitle.textContent = uiText("bookTitle");
  document.documentElement.lang = userLanguage === "ar" || userLanguage === "ur" ? userLanguage : "en";
  document.documentElement.dir = userLanguage === "ar" || userLanguage === "ur" ? "rtl" : "ltr";
  const composerNote = document.getElementById("composer-ai-note");
  if (composerNote) composerNote.textContent = uiText("aiDisclaimer");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function stopMediaTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

async function transcribeAndSend(blob, mimeType) {
  busy = true;
  sendBtn.disabled = true;
  micBtn.disabled = true;
  const typing = addTypingIndicator({ status: uiText("transcribing") });
  try {
    const audioBase64 = await blobToBase64(blob);
    const res = await fetch("/api/rent/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType })
    });
    const data = await res.json();
    typing.remove();
    if (!data.ok || !data.transcript) throw new Error(data.error || "Transcription failed");
    if (data.language) applyUiLanguage(data.language);
    await sendMessage(data.transcript, { fromVoice: true });
  } catch {
    typing.remove();
    addMessage(uiText("voiceFailed"), "bot");
  } finally {
    busy = false;
    sendBtn.disabled = false;
    micBtn.disabled = false;
  }
}

async function toggleVoiceRecording() {
  if (busy) return;

  if (!recording) {
    if (!navigator.mediaDevices?.getUserMedia) {
      addMessage(uiText("micDenied"), "bot");
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data?.size) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stopMediaTracks();
        recordingBar?.classList.add("hidden");
        micBtn?.classList.remove("recording");
        recording = false;
        const blob = new Blob(audioChunks, { type: mimeType.split(";")[0] });
        if (blob.size < 800) return;
        await transcribeAndSend(blob, mimeType.split(";")[0]);
      };
      mediaRecorder.start();
      recording = true;
      micBtn?.classList.add("recording");
      recordingBar?.classList.remove("hidden");
      recordingLabel.textContent = uiText("recording");
    } catch {
      stopMediaTracks();
      addMessage(uiText("micDenied"), "bot");
    }
    return;
  }

  recording = false;
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

function getSavedIds() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
  } catch {
    return [];
  }
}

function setSavedIds(ids) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(ids));
}

function toggleSaved(id) {
  const ids = getSavedIds();
  const idx = ids.indexOf(id);
  if (idx >= 0) ids.splice(idx, 1);
  else ids.push(id);
  setSavedIds(ids);
  return ids.includes(id);
}

function isSaved(id) {
  return getSavedIds().includes(id);
}

function initials(name) {
  const fallback = defaultInitials();
  const parts = String(name || fallback).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function applyProfileName(name) {
  const n = String(name || "").trim();
  const ini = n ? initials(n) : defaultInitials();
  headerAvatar.textContent = ini;
  profileAvatarLg.textContent = ini;
  if (n && heroGreeting) {
    const first = n.split(/\s+/)[0];
    heroGreeting.textContent = isGhanaMarket()
      ? `Welcome, ${first}. Looking for a self-contain in East Legon or a chamber and hall in Osu?`
      : `Welcome, ${first}. What property are you looking for across the UAE today?`;
  }
}

function updateCompareUi() {
  const n = compareSelection.size;
  if (savedCompareBtn) {
    savedCompareBtn.classList.toggle("hidden", n < 2);
    savedCompareBtn.disabled = n < 2 || n > 3;
    savedCompareBtn.textContent = n >= 2 ? `Compare selected (${n})` : "Compare selected";
  }
  const chatBtn = document.getElementById("chat-compare-btn");
  if (chatBtn) {
    chatBtn.disabled = n < 2 || n > 3;
    chatBtn.textContent = `Compare selected (${n})`;
  }
}

function toggleCompareId(id, checked) {
  if (!id) return;
  if (checked) {
    if (compareSelection.size >= 3) {
      alert("Compare up to 3 properties at a time.");
      return false;
    }
    compareSelection.add(id);
  } else {
    compareSelection.delete(id);
  }
  updateCompareUi();
  return true;
}

async function runCompare(ids) {
  const list = [...ids].slice(0, 3);
  if (list.length < 2) return;
  try {
    const res = await fetch("/api/rent/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: list })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Compare failed");
    openCompareDialog(data.comparison);
  } catch (e) {
    addMessage(e.message || "Could not compare listings.", "bot");
  }
}

function renderComparisonTable(comparison) {
  if (!comparison?.listings?.length) return '<p class="muted">No comparison data.</p>';
  const cols = comparison.listings;
  const head = `<tr><th></th>${cols
    .map(
      (l) =>
        `<th><div class="compare-col-head">${l.image ? `<img src="${escapeAttr(l.image)}" alt="" />` : ""}<strong>${escapeHtml(l.title)}</strong><span>${escapeHtml(formatPrice(l))}</span></div></th>`
    )
    .join("")}</tr>`;
  const body = (comparison.rows || [])
    .map((row) => {
      const cells = row.values
        .map(
          (v, i) =>
            `<td class="${row.best === i ? "compare-best" : ""}">${escapeHtml(v)}${row.best === i ? " ✓" : ""}</td>`
        )
        .join("");
      return `<tr><th scope="row">${escapeHtml(row.label)}</th>${cells}</tr>`;
    })
    .join("");
  const actions = cols
    .map(
      (l) =>
        `<button type="button" class="gold-btn inline" data-book="${escapeAttr(l.id)}">Book #${l.index}</button>`
    )
    .join("");
  return `<div class="compare-table-wrap"><table class="compare-table"><thead>${head}</thead><tbody>${body}</tbody></table></div><div class="compare-actions">${actions}</div>`;
}

function openCompareDialog(comparison) {
  if (!compareDialog || !compareContent) return;
  compareContent.innerHTML = renderComparisonTable(comparison);
  compareContent.querySelectorAll("[data-book]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = comparison.listings.find((l) => l.id === btn.getAttribute("data-book"));
      compareDialog.close();
      openLeadDialog(btn.getAttribute("data-book"), card?.title || "");
    });
  });
  compareDialog.showModal();
}

function appendComparisonToChat(comparison) {
  if (!comparison?.listings?.length) return;
  const wrap = document.createElement("div");
  wrap.className = "msg bot-wrap compare-wrap";
  wrap.innerHTML = `${renderComparisonTable(comparison)}${aiDisclaimerHtml()}`;
  wrap.querySelectorAll("[data-book]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = comparison.listings.find((l) => l.id === btn.getAttribute("data-book"));
      openLeadDialog(btn.getAttribute("data-book"), card?.title || "");
    });
  });
  appendToChat(wrap);
}

function clusterNoteHtml(listing) {
  const n = Number(listing?.other_agent_count || 0);
  if (n < 1) return "";
  return `<p class="muted cluster-note">Also listed by ${n} other agent${n === 1 ? "" : "s"} — booking binds to this offer.</p>`;
}

function formatPrice(listing) {
  if (!listing) return "";
  const amount = Number(listing.price_aed).toLocaleString();
  const cur = listing.currency || marketConfig.currency || "AED";
  const symbol = cur === "GHS" ? "GH₵" : "AED";
  if (listing.transaction_type === "rent") {
    return `${symbol} ${amount}/${listing.price_period || (cur === "GHS" ? "month" : "year")}`;
  }
  return `${symbol} ${amount}`;
}

function txLabel(type) {
  if (type === "off_plan") return "Off-plan";
  if (type === "sale") return "Buy";
  return "Rent";
}

function sourceLabel(source) {
  if (!source) return "";
  const map = {
    bayut: "Bayut",
    bayut_api: "Bayut",
    propertyfinder: "Property Finder",
    propertyfinder_api: "Property Finder",
    dubizzle: "Dubizzle",
    emaar: "Emaar",
    damac: "Damac",
    jiji: "Jiji",
    meqasa: "Meqasa",
    ghanapropertycentre: "Ghana Property Centre",
    tonaton: "Tonaton",
    fie_direct: "Direct listing",
    seed: "Demo"
  };
  return map[source] || source.replace(/_/g, " ");
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function sanitizeBotText(text = "") {
  return String(text || "")
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, "")
    .replace(/\{\s*"listings"\s*:\s*\[[\s\S]*?\]\s*\}/gi, "")
    .replace(/\[LEAD_READY\]/gi, "")
    .replace(/\[SHORTLIST:[^\]]+\]/gi, "")
    .replace(/\b(?:gemini|google search|grounding|RAG|live search|synced inventory|supabase)\b/gi, "")
    .replace(/\bI(?:'ve| have) (?:searched|looked up|queried)[^.!?]*[.!?]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownToChatHtml(text = "") {
  const chunks = [];
  let n = 0;
  const mark = (html) => {
    const key = `\uE000MD${n++}\uE001`;
    chunks.push({ key, html });
    return key;
  };

  let t = String(text || "");
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, (_, inner) => mark(`<strong>${escapeHtml(inner.trim())}</strong>`));
  t = t.replace(/\*([^*\n]+?)\*/g, (_, inner) => mark(`<strong>${escapeHtml(inner.trim())}</strong>`));
  t = t.replace(/__([^_\n]+?)__/g, (_, inner) => mark(`<strong>${escapeHtml(inner.trim())}</strong>`));
  t = t.replace(/_([^_\n]+?)_/g, (_, inner) => mark(`<strong>${escapeHtml(inner.trim())}</strong>`));
  t = t.replace(/\*/g, "");

  let html = escapeHtml(t).replace(/\n/g, "<br>");
  for (const { key, html: h } of chunks) {
    html = html.split(key).join(h);
  }
  return html;
}

function formatBotHtml(text = "") {
  const clean = sanitizeBotText(text);
  if (!clean) return "Here are some options — photos and amenities are below.";
  return markdownToChatHtml(clean);
}

function formatChatTime() {
  const d = new Date();
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `Today, ${hr}:${m} ${ampm}`;
}

function hideHero() {
  if (chatStarted) return;
  chatStarted = true;
  heroCard?.classList.add("hidden");
  quickActions?.classList.add("hidden");
}

function scrollChatToBottom() {
  const panel = chatPanel || chatEl.closest(".panel") || chatEl;
  requestAnimationFrame(() => {
    panel.scrollTop = panel.scrollHeight;
  });
}

/** Scroll listing photo cards into view after chat response. */
function scrollListingsIntoView() {
  if (!chatListingsEl || chatListingsEl.classList.contains("hidden")) return;
  const panel = chatPanel || chatEl.closest(".panel") || chatEl;
  const firstCard = chatListingsEl.querySelector(".photo-card");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (firstCard) {
        firstCard.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        chatListingsEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      panel.scrollTop = Math.min(panel.scrollTop, panel.scrollHeight - panel.clientHeight);
    });
  });
}

/** Keep listing cards at the end of the thread until replaced; new messages go below them. */
function pinListingsToEnd() {
  if (!chatListingsEl || chatListingsEl.classList.contains("hidden")) return;
  chatEl.appendChild(chatListingsEl);
  scrollChatToBottom();
}

function appendToChat(node) {
  chatEl.appendChild(node);
  scrollChatToBottom();
}

function resetChatUi({ showHero = true } = {}) {
  Array.from(chatEl.children).forEach((child) => {
    if (child !== chatListingsEl) child.remove();
  });
  clearChatListings();
  compareSelection.clear();
  updateCompareUi();
  chatStarted = !showHero;
  heroCard?.classList.toggle("hidden", !showHero);
  quickActions?.classList.toggle("hidden", !showHero);
}

function getSessionHistory() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSessionHistory(list) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, MAX_SESSION_HISTORY)));
}

function sessionLabelFromCriteria(criteria = {}) {
  const parts = [];
  if (criteria.community) parts.push(criteria.community);
  else if (criteria.emirate) parts.push(criteria.emirate);
  else if (criteria.emirates?.length) parts.push(criteria.emirates[0]);
  if (criteria.beds != null) parts.push(criteria.beds === 0 ? "Studio" : `${criteria.beds} bed`);
  if (criteria.transaction_type === "sale") parts.push("Buy");
  else if (criteria.transaction_type === "off_plan") parts.push("Off-plan");
  if (criteria.max_price) parts.push(`≤${Math.round(criteria.max_price / 1000)}k`);
  return parts.length ? parts.join(" · ") : "Property search";
}

function upsertSessionHistory(id, patch = {}) {
  if (!id) return;
  const all = getSessionHistory();
  const existing = all.find((s) => s.id === id) || {};
  const entry = {
    id,
    label: patch.label || existing.label || "New chat",
    preview: patch.preview || existing.preview || "",
    updatedAt: Date.now()
  };
  saveSessionHistory([entry, ...all.filter((s) => s.id !== id)]);
  renderSessionList();
}

function removeSessionFromHistory(id) {
  saveSessionHistory(getSessionHistory().filter((s) => s.id !== id));
  renderSessionList();
}

function formatSessionWhen(ts) {
  const d = new Date(ts || Date.now());
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderSessionList() {
  if (!sessionListEl) return;
  const list = getSessionHistory();
  if (sessionCountEl) sessionCountEl.textContent = list.length ? `${list.length}` : "";

  if (!list.length) {
    sessionListEl.innerHTML = `<p class="muted session-empty">No previous chats yet.</p>`;
    return;
  }

  sessionListEl.innerHTML = list
    .map(
      (s) => `
      <button type="button" class="session-item${s.id === sessionId ? " active" : ""}" data-session-id="${escapeAttr(s.id)}">
        <span class="session-item-title">${escapeHtml(s.label || "Chat")}</span>
        ${s.preview ? `<span class="session-item-preview">${escapeHtml(s.preview)}</span>` : ""}
        <span class="session-item-meta">${escapeHtml(formatSessionWhen(s.updatedAt))}</span>
      </button>`
    )
    .join("");

  sessionListEl.querySelectorAll("[data-session-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchToSession(btn.getAttribute("data-session-id"));
    });
  });
}

function openMenu() {
  renderSessionList();
  menuOverlay?.classList.remove("hidden");
  sideMenu?.classList.add("open");
  menuOverlay?.classList.add("open");
  sideMenu?.setAttribute("aria-hidden", "false");
  menuOverlay?.setAttribute("aria-hidden", "false");
  document.body.classList.add("menu-open");
}

function closeMenu() {
  sideMenu?.classList.remove("open");
  menuOverlay?.classList.remove("open");
  sideMenu?.setAttribute("aria-hidden", "true");
  menuOverlay?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("menu-open");
  setTimeout(() => menuOverlay?.classList.add("hidden"), 220);
}

async function createFreshSession() {
  const res = await fetch("/api/rent/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Could not start session");
  sessionId = data.sessionId;
  localStorage.setItem("uae_re_session_id", sessionId);
  upsertSessionHistory(sessionId, { label: "New chat", preview: "" });
  return sessionId;
}

async function startNewChat() {
  closeMenu();
  resetChatUi({ showHero: true });
  try {
    await createFreshSession();
    switchTab("concierge");
    input.focus();
  } catch (e) {
    addMessage(e.message || "Could not start a new chat.", "bot");
  }
}

async function loadSessionMessages(id) {
  const res = await fetch(`/api/rent/session/${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Session not found");
  return data.session || {};
}

async function switchToSession(id) {
  if (!id || id === sessionId) {
    closeMenu();
    switchTab("concierge");
    return;
  }
  closeMenu();
  resetChatUi({ showHero: false });
  sessionId = id;
  localStorage.setItem("uae_re_session_id", sessionId);

  try {
    const session = await loadSessionMessages(id);
    if (session.criteria?.language) applyUiLanguage(session.criteria.language);
    const label = sessionLabelFromCriteria(session.criteria || {});
    const messages = session.messages || [];
    const firstUser = messages.find((m) => m.role === "user");
    upsertSessionHistory(id, {
      label,
      preview: firstUser?.body?.slice(0, 80) || label
    });

    for (const m of messages) {
      if (m.role === "assistant" && !sanitizeBotText(m.body)) continue;
      addMessage(m.body, m.role === "user" ? "user" : "bot");
    }
    restoreSessionListings(session);
    switchTab("concierge");
    input.focus();
  } catch {
    removeSessionFromHistory(id);
    sessionId = "";
    localStorage.removeItem("uae_re_session_id");
    resetChatUi({ showHero: true });
    addMessage("That chat expired — starting fresh.", "bot");
    await createFreshSession();
  }
}

function clearSessionHistory() {
  if (!window.confirm("Clear all saved chat history on this device?")) return;
  saveSessionHistory([]);
  renderSessionList();
}

function addTypingIndicator(options = {}) {
  hideHero();
  const wrap = document.createElement("div");
  wrap.className = "msg bot-wrap typing-wrap";
  wrap.setAttribute("data-typing", "1");
  wrap.innerHTML = `
    <div class="msg bot typing-bubble" role="status" aria-live="polite" aria-label="Dar Concierge is typing">
      <span class="typing-dots"><span></span><span></span><span></span></span>
    </div>
  `;
  if (options.status) {
    const status = document.createElement("p");
    status.className = "typing-status";
    status.textContent = options.status;
    wrap.appendChild(status);
  }
  appendToChat(wrap);
  return wrap;
}

function addMessage(text, role = "bot", options = {}) {
  hideHero();

  if (role === "user" && !chatEl.querySelector(".chat-time")) {
    const time = document.createElement("div");
    time.className = "chat-time";
    time.textContent = formatChatTime();
    appendToChat(time);
  }

  if (role === "bot" || role === "bot typing") {
    if (role === "bot typing") {
      return addTypingIndicator({ status: text && text !== "…" ? text : null });
    }
    const wrap = document.createElement("div");
    wrap.className = "msg bot-wrap";
    wrap.innerHTML = `
      <div class="concierge-label">
        <img src="${escapeAttr(marketConfig.logo || "/dar-concierge-logo.png")}" alt="" class="brand-logo brand-logo--chat" />
        <span>${BRAND.nameUpper}</span>
      </div>
      <div class="msg bot">${formatBotHtml(text)}</div>
      ${aiDisclaimerHtml(options.aiDisclaimer)}
    `;
    appendToChat(wrap);
    return wrap;
  }

  const div = document.createElement("div");
  div.className = "msg user";
  div.textContent = text;
  appendToChat(div);
  return div;
}

function switchTab(tab) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  Object.entries(panels).forEach(([key, panel]) => {
    const active = key === tab;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  composerWrap.classList.toggle("hidden", tab !== "concierge");
  document.querySelector(".elite-main")?.classList.toggle("no-composer", tab !== "concierge");
  if (tab === "explore" && !exploreLoaded) loadExplore();
  if (tab === "saved") renderSavedGrid();
}

function openLeadDialog(listingId, listingTitle = "") {
  pendingListingId = listingId;
  pendingListingTitle = listingTitle;
  if (listingTitle) {
    leadTitle.textContent = "Book a Viewing";
    leadListing.textContent = listingTitle;
    leadListing.classList.remove("hidden");
  } else {
    leadTitle.textContent = "Connect with listing agent";
    leadListing.classList.add("hidden");
  }
  leadDialog.showModal();
}

function buildFeatureCard(l) {
  const img = l.image
    ? `<img src="${escapeAttr(l.image)}" alt="" loading="lazy" />`
    : "";
  const community = l.community || l.emirate || "";
  const beds = l.beds != null ? `${l.beds} Beds` : "";
  const baths = l.baths != null ? `${l.baths} Baths` : "";
  const sqft = l.size_sqft ? `${Number(l.size_sqft).toLocaleString()} sqft` : "";
  const saved = isSaved(l.id);
  const badge = community ? `<span class="feature-badge">${escapeHtml(community.split(",")[0])}</span>` : "";
  const premium = l.price_aed >= 5000000 ? `<span class="feature-badge">★ Premium</span>` : "";

  return `
    <article class="feature-card" data-id="${escapeAttr(l.id)}">
      <label class="compare-check-label">
        <input type="checkbox" class="compare-check" data-compare="${escapeAttr(l.id)}" ${compareSelection.has(l.id) ? "checked" : ""} />
        Compare
      </label>
      <div class="feature-media">
        ${img}
        <div class="feature-badges">${badge}${premium}</div>
        <button type="button" class="save-btn${saved ? " saved" : ""}" data-save="${escapeAttr(l.id)}" aria-label="Save">♡</button>
      </div>
      <div class="feature-body">
        <h3>${escapeHtml(l.title)}</h3>
        <p class="feature-price">${escapeHtml(formatPrice(l))}</p>
        <p class="feature-loc">📍 ${escapeHtml(l.community || l.emirate || (marketConfig.code === "GH" ? "Ghana" : "UAE"))}</p>
        <div class="feature-specs">
          ${beds ? `<span>🛏 ${beds}</span>` : ""}
          ${baths ? `<span>🛁 ${baths}</span>` : ""}
          ${sqft ? `<span>📐 ${sqft}</span>` : ""}
        </div>
        ${clusterNoteHtml(l)}
        <button type="button" class="gold-btn" data-book="${escapeAttr(l.id)}">Book Viewing</button>
      </div>
    </article>
  `;
}

function wireFeatureCards(container) {
  container.querySelectorAll("[data-book]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".feature-card");
      const title = card?.querySelector("h3")?.textContent || "";
      openLeadDialog(btn.getAttribute("data-book"), title);
    });
  });

  container.querySelectorAll(".feature-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-save]") || e.target.closest("[data-book]")) return;
      openListingDetail(card.dataset.id);
    });
  });

  container.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-save");
      const nowSaved = toggleSaved(id);
      btn.classList.toggle("saved", nowSaved);
      btn.textContent = "♡";
    });
  });

  container.querySelectorAll(".compare-check").forEach((box) => {
    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("change", (e) => {
      const ok = toggleCompareId(box.getAttribute("data-compare"), box.checked);
      if (!ok) box.checked = false;
    });
  });
}

function formatAedShort(n) {
  const v = Number(n) || 0;
  const symbol = marketConfig.currency === "GHS" ? "GH₵" : "AED";
  if (v >= 1_000_000) return `${symbol} ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${symbol} ${Math.round(v / 1000)}k`;
  return `${symbol} ${v.toLocaleString()}`;
}

function appendChartToChat(chart) {
  if (!chart?.bars?.length) return;
  const wrap = document.createElement("div");
  wrap.className = "msg bot-wrap chart-wrap";
  const max = Math.max(...chart.bars.map((b) => b.value), 1);
  const barsHtml = chart.bars
    .map((b) => {
      const h = Math.max(8, Math.round((b.value / max) * 100));
      const val = formatAedShort(b.value);
      return `
        <div class="chart-bar-col${b.highlight ? " highlight" : ""}">
          ${b.highlight ? `<span class="chart-val">${val}</span>` : ""}
          <div class="chart-bar" style="height:${h}%"></div>
          <span class="chart-label">${escapeHtml(b.label)}</span>
        </div>`;
    })
    .join("");

  const statsHtml = chart.stats?.median
    ? `<p class="chart-stats muted">Median ${formatAedShort(chart.stats.median)}/yr · ${chart.stats.sample} listings sampled</p>`
    : chart.stats?.sample
      ? `<p class="chart-stats muted">${chart.stats.sample} listings sampled · ${escapeHtml(chart.badge || "")}</p>`
      : chart.stats?.total
        ? `<p class="chart-stats muted">Estimated total ${formatAedShort(chart.stats.total)}/mo</p>`
        : "";

  wrap.innerHTML = `
    <div class="insight-card">
      <div class="insight-head">
        <h4>${escapeHtml(chart.title)}</h4>
        <span class="live-badge">${escapeHtml((chart.badge || "Updated").replace(/GEMINI LIVE|SYNCED|DATA ·/gi, "Updated ·"))}</span>
      </div>
      ${chart.subtitle ? `<p class="insight-sub">${escapeHtml(chart.subtitle)}</p>` : ""}
      <div class="chart-bars" role="img" aria-label="${escapeHtml(chart.title)}">${barsHtml}</div>
      ${statsHtml}
      ${chart.trendNote ? `<p class="chart-insight">${escapeHtml(chart.trendNote)}</p>` : ""}
    </div>
    ${aiDisclaimerHtml()}
  `;
  appendToChat(wrap);
}

function clearChatListings() {
  chatListingsEl.innerHTML = "";
  chatListingsEl.classList.add("hidden");
}

function renderMiniListings(listings = [], photoMode = false) {
  chatListingsEl.innerHTML = "";
  if (!listings.length) {
    chatListingsEl.classList.add("hidden");
    return;
  }
  chatListingsEl.classList.remove("hidden");
  chatListingsEl.classList.toggle("photo-mode", photoMode);

  lastChatListings = listings.slice();

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    const card = document.createElement("article");
    card.className = photoMode ? "photo-card" : "mini-card";
    card.dataset.id = l.id;

    const imgs = (l.images || []).length ? l.images : l.image ? [l.image] : [];
    const strip = imgs
      .slice(0, 6)
      .map((src) => `<img src="${escapeAttr(src)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" />`)
      .join("");
    const more = imgs.length > 6 ? `<span class="photo-more">+${imgs.length - 6}</span>` : "";
    const specParts = [
      l.beds != null ? `${l.beds} bed` : null,
      l.baths != null ? `${l.baths} bath` : null,
      l.size_sqft ? `${Number(l.size_sqft).toLocaleString()} sqft` : null
    ].filter(Boolean);
    const specHtml = specParts.length ? `<p class="photo-specs">${escapeHtml(specParts.join(" · "))}</p>` : "";

    const amenityHtml = (l.amenities || [])
      .slice(0, 6)
      .map((a) => `<span class="amenity-chip">${escapeHtml(a)}</span>`)
      .join("");

    if (photoMode && imgs.length) {
      card.innerHTML = `
        <label class="compare-check-inline"><input type="checkbox" class="compare-check" data-compare="${escapeAttr(l.id)}" /><span>#${i + 1}</span></label>
        <div class="photo-strip">${strip}${more}</div>
        <div class="photo-card-body">
          <h4>${escapeHtml(l.title)}</h4>
          <p class="price">${escapeHtml(formatPrice(l))}</p>
          <p class="muted">${escapeHtml(l.community || l.emirate || "")}</p>
          ${specHtml}
          ${l.description ? `<p class="photo-desc">${escapeHtml(String(l.description).slice(0, 160))}${l.description.length > 160 ? "…" : ""}</p>` : ""}
          ${amenityHtml ? `<div class="photo-amenities">${amenityHtml}</div>` : ""}
          ${clusterNoteHtml(l)}
          <button type="button" class="photo-view-btn">View full listing</button>
          <button type="button" class="photo-book-btn" data-book="${escapeAttr(l.id)}">Book viewing</button>
        </div>
      `;
      card.querySelector(".photo-view-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openListingDetail(l.id);
      });
      card.querySelector(".photo-book-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openLeadDialog(l.id, l.title);
      });
    } else {
      const imgHtml = l.image
        ? `<img src="${escapeAttr(l.image)}" alt="" loading="lazy" />`
        : `<div class="thumb"></div>`;
      card.innerHTML = `
        ${imgHtml}
        <div>
          <h4>${escapeHtml(l.title)}</h4>
          <p class="price">${escapeHtml(formatPrice(l))}</p>
          <p class="muted">${escapeHtml(l.community || l.emirate || "")}</p>
          ${clusterNoteHtml(l)}
        </div>
      `;
    }

    card.addEventListener("click", (e) => {
      if (e.target.closest(".compare-check-inline")) return;
      openListingDetail(l.id);
    });
    card.querySelector(".compare-check")?.addEventListener("click", (e) => e.stopPropagation());
    card.querySelector(".compare-check")?.addEventListener("change", (e) => {
      const box = e.target;
      const ok = toggleCompareId(box.getAttribute("data-compare"), box.checked);
      if (!ok) box.checked = false;
    });
    chatListingsEl.appendChild(card);
  }

  const compareBar = document.createElement("div");
  compareBar.className = "alert-bar";
  compareBar.innerHTML = `
    <button type="button" class="alert-save-btn" id="chat-compare-btn" disabled>Compare selected (0)</button>
    <button type="button" class="alert-save-btn secondary" id="chat-compare-all">Compare top 2</button>
  `;
  chatListingsEl.appendChild(compareBar);
  const chatCompareBtn = compareBar.querySelector("#chat-compare-btn");
  compareBar.querySelector("#chat-compare-all")?.addEventListener("click", () => {
    runCompare(lastChatListings.slice(0, 2).map((x) => x.id));
  });
  chatCompareBtn?.addEventListener("click", () => runCompare([...compareSelection]));
  updateCompareUi();

  const alertBar = document.createElement("div");
  alertBar.className = "alert-bar";
  alertBar.innerHTML = `<button type="button" class="alert-save-btn" id="save-search-alert">🔔 WhatsApp me when new matches appear</button>`;
  chatListingsEl.appendChild(alertBar);
  alertBar.querySelector("#save-search-alert")?.addEventListener("click", (e) => {
    e.stopPropagation();
    saveSearchAlert();
  });

  pinListingsToEnd();
  scrollListingsIntoView();
  chatListingsEl.querySelectorAll(".photo-strip img").forEach((img) => {
    if (img.complete) return;
    img.addEventListener("load", () => scrollListingsIntoView(), { once: true });
  });
}

const ALERT_PHONE_KEY = "uae_re_alert_phone";

async function saveSearchAlert() {
  let phone = localStorage.getItem(ALERT_PHONE_KEY) || "";
  if (!phone) {
    const raw = window.prompt(
      marketConfig.code === "GH"
        ? "Ghana mobile for WhatsApp alerts (e.g. 0244111222):"
        : "UAE mobile for WhatsApp alerts (e.g. 971501234567):",
      ""
    );
    if (!raw) return;
    phone = raw.replace(/\D/g, "");
    if (phone.length < 9) {
      alert(marketConfig.code === "GH" ? "Enter a valid Ghana mobile number." : "Enter a valid UAE mobile number.");
      return;
    }
    localStorage.setItem(ALERT_PHONE_KEY, phone);
  }
  try {
    const sid = await ensureSession();
    const res = await fetch("/api/rent/saved-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, userPhone: phone })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed");
    addMessage(
      data.duplicate
        ? `You're already subscribed to alerts for "${data.saved?.label}".`
        : `Alert saved: "${data.saved?.label}". We'll WhatsApp you when new listings match.`,
      "bot"
    );
  } catch (e) {
    addMessage(e.message || "Could not save alert.", "bot");
  }
}

async function loadExplore() {
  exploreGrid.innerHTML = `<p class="muted center">Loading properties…</p>`;
  const params = new URLSearchParams({ limit: "20" });
  if (exploreFilter === "rent") params.set("type", "rent");
  else if (exploreFilter === "sale") params.set("type", "sale");
  else if (exploreFilter === "Dubai" || exploreFilter === "Accra") params.set("emirate", exploreFilter);

  try {
    const res = await fetch(`/api/rent/browse?${params}`);
    const data = await res.json();
    if (!data.ok || !data.listings?.length) {
      exploreGrid.innerHTML = `<p class="muted center">No properties found.</p>`;
      return;
    }
    exploreGrid.innerHTML = data.listings.map(buildFeatureCard).join("");
    wireFeatureCards(exploreGrid);
    exploreLoaded = true;
  } catch {
    exploreGrid.innerHTML = `<p class="muted center">Could not load properties.</p>`;
  }
}

async function renderSavedGrid() {
  const ids = getSavedIds();
  if (!ids.length) {
    savedGrid.innerHTML = `<p class="muted center empty-hint">Tap ♡ on a property to save it here.</p>`;
    return;
  }
  savedGrid.innerHTML = `<p class="muted center">Loading saved…</p>`;
  const listings = [];
  for (const id of ids) {
    try {
      const res = await fetch(`/api/rent/listings/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.ok && data.listing) listings.push(data.listing);
    } catch {
      /* skip */
    }
  }
  if (!listings.length) {
    savedGrid.innerHTML = `<p class="muted center">Saved properties unavailable.</p>`;
    return;
  }
  savedGrid.innerHTML = listings.map(buildFeatureCard).join("");
  wireFeatureCards(savedGrid);
}

function buildPhotoGallery(images) {
  if (!images.length) {
    return `<div class="listing-gallery listing-gallery-empty"></div>`;
  }
  const thumbs = images
    .map(
      (src, i) =>
        `<button type="button" class="gallery-thumb${i === 0 ? " active" : ""}" data-index="${i}" aria-label="Photo ${i + 1}">
          <img src="${escapeAttr(src)}" alt="" loading="lazy" />
        </button>`
    )
    .join("");
  const grid = images
    .map(
      (src, i) =>
        `<button type="button" class="gallery-grid-item" data-index="${i}" aria-label="Open photo ${i + 1}">
          <img src="${escapeAttr(src)}" alt="" loading="lazy" />
        </button>`
    )
    .join("");

  return `
    <div class="photo-gallery" data-count="${images.length}">
      <div class="gallery-main-wrap">
        <button type="button" class="gallery-nav gallery-prev" aria-label="Previous photo">‹</button>
        <button type="button" class="gallery-main" data-index="0" aria-label="Open full screen">
          <img class="gallery-main-img" src="${escapeAttr(images[0])}" alt="" />
        </button>
        <button type="button" class="gallery-nav gallery-next" aria-label="Next photo">›</button>
        <span class="gallery-counter">1 / ${images.length}</span>
      </div>
      <div class="gallery-thumbs" aria-label="Photo thumbnails">${thumbs}</div>
      ${
        images.length > 4
          ? `<button type="button" class="gallery-toggle">Show all ${images.length} photos</button>
             <div class="gallery-grid hidden">${grid}</div>`
          : ""
      }
    </div>
  `;
}

function setGalleryIndex(gallery, index, images) {
  const total = images.length;
  if (!total) return;
  const i = ((index % total) + total) % total;
  gallery.dataset.index = String(i);
  const mainImg = gallery.querySelector(".gallery-main-img");
  if (mainImg) mainImg.src = images[i];
  const counter = gallery.querySelector(".gallery-counter");
  if (counter) counter.textContent = `${i + 1} / ${total}`;
  gallery.querySelectorAll(".gallery-thumb").forEach((el, idx) => {
    el.classList.toggle("active", idx === i);
    if (idx === i) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  });
  return i;
}

function wirePhotoGallery(root, images) {
  const gallery = root.querySelector(".photo-gallery");
  if (!gallery || !images.length) return;

  let index = 0;
  let touchStartX = 0;

  const go = (next) => {
    index = setGalleryIndex(gallery, next, images);
  };

  gallery.querySelector(".gallery-prev")?.addEventListener("click", () => go(index - 1));
  gallery.querySelector(".gallery-next")?.addEventListener("click", () => go(index + 1));

  gallery.querySelectorAll(".gallery-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      index = setGalleryIndex(gallery, Number(btn.dataset.index), images);
    });
  });

  gallery.querySelectorAll(".gallery-grid-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      index = setGalleryIndex(gallery, Number(btn.dataset.index), images);
      openLightbox(images, index);
    });
  });

  gallery.querySelector(".gallery-main")?.addEventListener("click", () => {
    openLightbox(images, index);
  });

  gallery.querySelector(".gallery-toggle")?.addEventListener("click", (e) => {
    const grid = gallery.querySelector(".gallery-grid");
    const btn = e.currentTarget;
    const open = grid.classList.toggle("hidden");
    btn.textContent = open ? `Show all ${images.length} photos` : "Hide photo grid";
  });

  gallery.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.changedTouches[0]?.clientX || 0;
    },
    { passive: true }
  );

  gallery.addEventListener(
    "touchend",
    (e) => {
      const dx = (e.changedTouches[0]?.clientX || 0) - touchStartX;
      if (Math.abs(dx) < 40) return;
      go(dx < 0 ? index + 1 : index - 1);
    },
    { passive: true }
  );
}

function openLightbox(images, startIndex = 0) {
  if (!images.length) return;
  lightboxImages = images;
  lightboxIndex = startIndex;
  updateLightbox();
  photoLightbox.showModal();
}

function updateLightbox() {
  const total = lightboxImages.length;
  if (!total) return;
  lightboxIndex = ((lightboxIndex % total) + total) % total;
  lightboxImg.src = lightboxImages[lightboxIndex];
  lightboxCounter.textContent = `${lightboxIndex + 1} / ${total}`;
}

function renderListingDetail(l) {
  const location = [l.building, l.community, l.emirate].filter(Boolean).join(" · ");
  const specs = [
    l.beds != null ? `${l.beds} bed` : null,
    l.baths != null ? `${l.baths} bath` : null,
    l.size_sqft ? `${Number(l.size_sqft).toLocaleString()} sqft` : null,
    l.property_type || null,
    l.furnished === true ? "Furnished" : l.furnished === false ? "Unfurnished" : null
  ].filter(Boolean);

  const images = (l.images || []).length ? l.images : l.image ? [l.image] : [];
  const gallery = buildPhotoGallery(images);

  const amenities =
    (l.amenities || []).length > 0
      ? `<div class="listing-amenities">${l.amenities
          .map((a) => `<span class="amenity">${escapeHtml(a)}</span>`)
          .join("")}</div>`
      : "";

  const offPlan =
    l.transaction_type === "off_plan"
      ? `<p class="listing-meta">${[l.developer, l.handover_date, l.payment_plan].filter(Boolean).join(" · ")}</p>`
      : "";

  const source = sourceLabel(l.source);

  listingDetailEl.innerHTML = `
    ${gallery}
    <div class="listing-body">
      <p><span class="badge">${txLabel(l.transaction_type)}</span></p>
      <h2 class="listing-title">${escapeHtml(l.title)}</h2>
      <p class="listing-price">${escapeHtml(formatPrice(l))}</p>
      <p class="listing-location">${escapeHtml(location)}</p>
      ${specs.length ? `<p class="listing-specs">${escapeHtml(specs.join(" · "))}</p>` : ""}
      ${offPlan}
      ${l.description ? `<p class="listing-desc">${escapeHtml(l.description)}</p>` : ""}
      ${amenities}
      ${l.agency_name ? `<p class="listing-meta muted">Listed by ${escapeHtml(l.agency_name)}${source ? ` · ${escapeHtml(source)}` : ""}</p>` : source ? `<p class="listing-meta muted">Listed on ${escapeHtml(source)}</p>` : ""}
      ${clusterNoteHtml(l)}
      <button type="button" class="listing-book" data-book="${escapeAttr(l.id)}">Book Viewing</button>
    </div>
  `;

  listingDetailEl.querySelector("[data-book]")?.addEventListener("click", () => {
    listingDialog.close();
    openLeadDialog(l.id, l.title);
  });

  wirePhotoGallery(listingDetailEl, images);
}

function restoreSessionListings(session = {}) {
  const recent = session.criteria?.recent_listings;
  if (Array.isArray(recent) && recent.length) {
    renderMiniListings(recent, true);
  }
}

function mergeListingDetail(api, cached) {
  if (!api) return cached || null;
  if (!cached) return api;
  const apiImgs = (api.images || []).length ? api.images : api.image ? [api.image] : [];
  const cachedImgs = (cached.images || []).length ? cached.images : cached.image ? [cached.image] : [];
  const images = apiImgs.length >= cachedImgs.length ? apiImgs : cachedImgs;
  const apiDesc = String(api.description || "").trim();
  const cachedDesc = String(cached.description || "").trim();
  return {
    ...cached,
    ...api,
    images,
    image: images[0] || api.image || cached.image || null,
    description: apiDesc.length >= cachedDesc.length ? apiDesc || cachedDesc : cachedDesc,
    amenities: api.amenities?.length ? api.amenities : cached.amenities || []
  };
}

async function openListingDetail(listingId) {
  const cached = lastChatListings.find((l) => l.id === listingId);
  listingDialog.showModal();
  if (cached && ((cached.images || []).length || cached.image)) {
    listingDetailEl.innerHTML = "";
    renderListingDetail(cached);
  } else {
    listingDetailEl.innerHTML = `<p class="listing-loading muted">Loading property…</p>`;
  }

  try {
    const res = await fetch(`/api/rent/listings/${encodeURIComponent(listingId)}`);
    const data = await res.json();
    if (data.ok && data.listing) {
      renderListingDetail(mergeListingDetail(data.listing, cached));
      return;
    }
    if (cached) {
      renderListingDetail(cached);
      return;
    }
    throw new Error(data.error || "Listing not found");
  } catch (error) {
    if (cached) {
      renderListingDetail(cached);
      return;
    }
    listingDetailEl.innerHTML = `<p class="listing-error">Could not load listing — ${escapeHtml(error.message)}</p>`;
  }
}

async function ensureSession() {
  if (sessionId) {
    try {
      const res = await fetch(`/api/rent/session/${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (data.ok) return sessionId;
    } catch {
      /* create fresh session */
    }
    sessionId = "";
    localStorage.removeItem("uae_re_session_id");
  }
  const res = await fetch("/api/rent/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Could not start session");
  sessionId = data.sessionId;
  localStorage.setItem("uae_re_session_id", sessionId);
  upsertSessionHistory(sessionId, { label: "New chat", preview: "" });
  return sessionId;
}

function looksLikePropertySearch(text = "") {
  return /\b(rent|buy|lease|bhk|br|bed|studio|apartment|villa|townhouse|penthouse|self-?contain|chamber|compound|ajman|dubai|sharjah|abu dhabi|fujairah|ras al khaimah|umm al quwain|accra|kumasi|tema|east legon|osu|spintex|aed|gh₵|cedis|budget|under|max|min)\b/i.test(
    String(text || "")
  );
}

function appendPartnersToChat(partners = []) {
  if (!partners.length) return;
  const wrap = document.createElement("div");
  wrap.className = "partner-cards";
  wrap.innerHTML = partners
    .map((p) => {
      const meta = [p.kind, p.phone].filter(Boolean).join(" · ");
      const href = String(p.url || "").trim();
      return `<a class="partner-card" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
        <strong>${escapeHtml(p.name || "")}</strong>
        <span class="partner-kind">${escapeHtml(meta)}</span>
        <span class="partner-summary">${escapeHtml(p.summary || "")}</span>
        <span class="partner-link">Open site →</span>
      </a>`;
    })
    .join("");
  appendToChat(wrap);
}

function appendSearchStatus(text) {
  if (!text) return;
  const wrap = document.createElement("div");
  wrap.className = "search-status";
  wrap.innerHTML = `<span class="search-status-icon">🔍</span><span>${escapeHtml(text)}</span>`;
  appendToChat(wrap);
}

async function sendMessage(text, options = {}) {
  const message = String(text || "").trim();
  if (!message || busy) return;
  busy = true;
  sendBtn.disabled = true;
  micBtn.disabled = true;
  if (!options.fromVoice) addMessage(message, "user");
  else addMessage(`🎤 ${message}`, "user");
  input.value = "";
  const typingText = looksLikePropertySearch(message) ? uiText("searching") : null;
  const typing = addTypingIndicator({ status: typingText });

  try {
    const sid = await ensureSession();
    const res = await fetch("/api/rent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, message })
    });
    const data = await res.json();
    typing.remove();
    if (!data.ok) throw new Error(data.error || "Chat failed");
    if (data.language) applyUiLanguage(data.language);
    addMessage(data.text || "…", "bot", { aiDisclaimer: data.aiDisclaimer });
    if (data.showPartners && data.partners?.length) {
      appendPartnersToChat(data.partners);
    }
    if (data.showChart && data.chart) {
      appendChartToChat(data.chart);
    }
    if (data.showComparison && data.comparison) {
      clearChatListings();
      appendComparisonToChat(data.comparison);
    } else if (data.showListings && data.listings?.length) {
      renderMiniListings(data.listings, true);
    } else if (!data.keepListings) {
      clearChatListings();
    }
    if (data.searchStatus) appendSearchStatus(data.searchStatus);
    if (data.leadReady) {
      pendingListingId = data.shortlistId || pendingListingId;
      openLeadDialog(pendingListingId, data.listings?.[0]?.title || pendingListingTitle);
    }
    upsertSessionHistory(sid, {
      label: sessionLabelFromCriteria(data.criteria || {}),
      preview: message.slice(0, 80)
    });
  } catch {
    typing.remove();
    addMessage(uiText("errorGeneric"), "bot");
  } finally {
    busy = false;
    sendBtn.disabled = false;
    micBtn.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(input.value);
});

micBtn?.addEventListener("click", () => toggleVoiceRecording());

document.querySelectorAll(".pill, .action-card").forEach((el) => {
  el.addEventListener("click", () => {
    const msg = el.getAttribute("data-msg");
    if (!msg) return;
    switchTab("concierge");
    sendMessage(msg);
  });
});

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

profileShortcut?.addEventListener("click", () => switchTab("profile"));

menuBtn?.addEventListener("click", () => openMenu());
menuClose?.addEventListener("click", () => closeMenu());
menuOverlay?.addEventListener("click", () => closeMenu());
newChatBtn?.addEventListener("click", () => startNewChat());
clearSessionsBtn?.addEventListener("click", () => clearSessionHistory());

document.querySelectorAll("[data-menu-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    closeMenu();
    switchTab(btn.getAttribute("data-menu-tab"));
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sideMenu?.classList.contains("open")) closeMenu();
});

document.querySelectorAll(".filter-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll(".filter-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    exploreFilter = pill.dataset.filter;
    exploreLoaded = false;
    loadExplore();
  });
});

saveProfileBtn?.addEventListener("click", () => {
  const name = profileNameInput.value.trim();
  localStorage.setItem(PROFILE_KEY, name);
  applyProfileName(name);
});

leadCancel.addEventListener("click", () => leadDialog.close());
ownerListingCancel?.addEventListener("click", () => ownerListingDialog?.close());
document.getElementById("list-property-btn")?.addEventListener("click", openOwnerListingDialog);
document.getElementById("list-property-profile-btn")?.addEventListener("click", openOwnerListingDialog);
document.getElementById("list-property-menu-btn")?.addEventListener("click", () => {
  closeMenu();
  openOwnerListingDialog();
});
ownerListingForm?.addEventListener("submit", submitOwnerListingForm);
listingClose.addEventListener("click", () => listingDialog.close());
compareClose?.addEventListener("click", () => compareDialog.close());
savedCompareBtn?.addEventListener("click", () => runCompare([...compareSelection]));

lightboxClose.addEventListener("click", () => photoLightbox.close());
lightboxPrev.addEventListener("click", () => {
  lightboxIndex -= 1;
  updateLightbox();
});
lightboxNext.addEventListener("click", () => {
  lightboxIndex += 1;
  updateLightbox();
});
photoLightbox.addEventListener("click", (e) => {
  if (e.target === photoLightbox) photoLightbox.close();
});

let lightboxTouchX = 0;
photoLightbox.addEventListener(
  "touchstart",
  (e) => {
    lightboxTouchX = e.changedTouches[0]?.clientX || 0;
  },
  { passive: true }
);
photoLightbox.addEventListener(
  "touchend",
  (e) => {
    const dx = (e.changedTouches[0]?.clientX || 0) - lightboxTouchX;
    if (Math.abs(dx) < 40) return;
    lightboxIndex += dx < 0 ? 1 : -1;
    updateLightbox();
  },
  { passive: true }
);

leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(leadForm);
  const renterName = String(fd.get("name") || "").trim();
  const renterPhone = String(fd.get("phone") || "").trim();
  const viewingPreference = String(fd.get("viewing") || "").trim();
  const consent = fd.get("consent") === "on";
  const submitBtn = document.getElementById("lead-submit");

  if (!renterName || !renterPhone) {
    addMessage(`Please enter your name and ${marketConfig.phoneLabel || "phone number"}.`, "bot");
    return;
  }
  if (!consent) {
    addMessage("Please tick the consent box so we can share your details with the agent.", "bot");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Booking…";

  try {
    const sid = await ensureSession();
    const res = await fetch("/api/rent/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        listingId: pendingListingId,
        renterName,
        renterPhone,
        viewingPreference,
        consent: true
      })
    });
    const raw = await res.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(raw.slice(0, 120) || "Could not submit booking");
    }
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Could not submit booking");
    }
    leadDialog.close();
    switchTab("concierge");
    clearChatListings();
    lastChatListings = [];
    const confirm =
      data.text ||
      `Viewing booked${pendingListingTitle ? ` for ${pendingListingTitle}` : ""} — we'll call ${renterPhone} to confirm, then reach out to the agent.`;
    addMessage(confirm, "bot");
    if (data.payToView && data.authorizationUrl) {
      addMessage("Opening MoMo / card payment for GH₵100…", "bot");
      window.location.href = data.authorizationUrl;
    } else if (data.payToView && data.devPay && data.viewing?.id) {
      const paid = await fetch("/api/rent/viewing/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewingId: data.viewing.id })
      }).then((r) => r.json());
      if (paid.ok && paid.pin) {
        addMessage(`Your viewing PIN is ${paid.pin}. Give it to the agent only at the property. Agent confirms it here: ${location.origin}/gh/agent`, "bot");
      } else if (paid.ok) {
        addMessage("Payment marked. PIN will be sent to WhatsApp.", "bot");
      }
    }
    pendingListingId = null;
    pendingListingTitle = "";
    leadForm.reset();
  } catch (error) {
    switchTab("concierge");
    addMessage(`Could not book viewing: ${error.message}. Please try again.`, "bot");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = marketConfig.payToView
      ? `Pay GH₵${marketConfig.viewingFeeGhs || 100}`
      : "Book Viewing";
  }
});

async function bootstrap() {
  await loadMarketConfig();
  applyUiLanguage(userLanguage);

  const savedName = localStorage.getItem(PROFILE_KEY) || "";
  if (savedName) {
    profileNameInput.value = savedName;
    applyProfileName(savedName);
  }

  const saved = localStorage.getItem("uae_re_session_id");
  if (saved) {
    sessionId = saved;
    try {
      const res = await fetch(`/api/rent/session/${encodeURIComponent(saved)}`);
      const data = await res.json();
      const messages = data.ok ? data.session?.messages || [] : [];
      if (data.ok && data.session?.criteria?.language) {
        applyUiLanguage(data.session.criteria.language);
      }
      if (messages.length) {
        const label = sessionLabelFromCriteria(data.session?.criteria || {});
        const firstUser = messages.find((m) => m.role === "user");
        upsertSessionHistory(saved, {
          label,
          preview: firstUser?.body?.slice(0, 80) || label
        });
        for (const m of messages) {
          if (m.role === "assistant" && !sanitizeBotText(m.body)) continue;
          addMessage(m.body, m.role === "user" ? "user" : "bot");
        }
        restoreSessionListings(data.session);
        input.focus();
        renderSessionList();
        return;
      }
    } catch {
      /* fresh welcome */
    }
  }
  input.focus();
  renderSessionList();
}

registerRentServiceWorker();
initPwaInstall();
bootstrap();
