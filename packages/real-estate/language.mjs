/**
 * Lightweight language detection for UAE / Ghana concierge (no external deps).
 */

import { isGhanaMarket } from "./market.mjs";

export const LANGUAGE_NAMES = {
  en: "English",
  ar: "Arabic",
  hi: "Hindi",
  ur: "Urdu",
  ru: "Russian",
  tl: "Tagalog",
  fr: "French",
  zh: "Chinese",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  bn: "Bengali",
  fa: "Persian",
  ml: "Malayalam",
  ta: "Tamil"
};

export function languageName(code = "en") {
  return LANGUAGE_NAMES[String(code || "en").toLowerCase()] || "English";
}

export function detectLanguage(text = "") {
  const t = String(text || "").trim();
  if (!t) return "en";

  if (/[\u0900-\u097F]/.test(t)) return "hi";
  if (/[\u0980-\u09FF]/.test(t)) return "bn";
  if (/[\u0D00-\u0D7F]/.test(t)) return "ml";
  if (/[\u0B80-\u0BFF]/.test(t)) return "ta";
  if (/[\u4E00-\u9FFF]/.test(t)) return "zh";
  if (/[\u0400-\u04FF]/.test(t)) return "ru";
  if (/[\u0600-\u06FF]/.test(t)) {
    if (/(\s|^)(میں|ہے|ہیں|کرایہ|فلیٹ|کیا|آپ|مجھے)(\s|$)/.test(t)) return "ur";
    if (/(\s|^)(من|في|شقة|دبي|أريد|ابحث)(\s|$)/.test(t)) return "ar";
    if (/(\s|^)(من|در|آپارتمان|اجاره)(\s|$)/.test(t)) return "fa";
    return "ar";
  }

  const lower = t.toLowerCase();
  if (/\b(bonjour|appartement|cherche|louer|je veux)\b/.test(lower)) return "fr";
  if (/\b(hola|busco|apartamento|alquiler|quiero)\b/.test(lower)) return "es";
  if (/\b(olá|procuro|apartamento|alugar)\b/.test(lower)) return "pt";
  if (/\b(guten|wohnung|miete|ich suche)\b/.test(lower)) return "de";
  if (/\b(kumusta|hanap|paupahan|gusto ko)\b/.test(lower)) return "tl";
  if (/\b(хочу|квартира|аренда|ищу)\b/.test(lower)) return "ru";

  return "en";
}

/** Keep session language unless user clearly switches. */
export function resolveSessionLanguage(text = "", previous = "en") {
  const detected = detectLanguage(text);
  const prev = String(previous || "en").toLowerCase();
  if (!String(text || "").trim()) return prev || "en";
  if (detected === "en" && prev !== "en" && String(text).trim().length < 16) {
    return prev;
  }
  return detected;
}

export function languagePromptBlock(language = "en") {
  const code = String(language || "en").toLowerCase();
  const name = languageName(code);
  return [
    "Language (critical):",
    `- Always reply in ${name} (${code}) — the user's current language.`,
    "- If they switch language mid-chat, switch immediately to match them.",
    isGhanaMarket()
      ? "- Keep Ghana place names and GH₵ prices as-is (East Legon, Osu, GH₵ 1,800/month)."
      : "- Keep UAE place names and AED prices as-is (Marina, JVC, AED 120,000/year).",
    "- Voice notes arrive as transcribed text — respond in the transcript's language.",
    code === "ar"
      ? "- Use natural Gulf-friendly Arabic; you can mix English property terms when common (Studio, Penthouse)."
      : "",
    code === "ur"
      ? "- Use natural Urdu script; property terms in English are fine when standard in UAE."
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

/** UI strings for rent PWA composer (subset of concierge languages). */
export const UI_STRINGS = {
  en: {
    placeholder: "Ask Dar Concierge AI…",
    transcribing: "Transcribing voice…",
    recording: "Recording… tap to send",
    micDenied: "Microphone access denied — allow mic in browser settings.",
    voiceFailed: "Could not transcribe — try typing instead.",
    bookViewing: "Book Viewing",
    bookTitle: "Book a Viewing"
  },
  ar: {
    placeholder: "اسأل Dar Concierge AI…",
    transcribing: "جاري تحويل الصوت إلى نص…",
    recording: "جاري التسجيل… اضغط للإرسال",
    micDenied: "تم رفض الميكrophone — فعّل الميكrophone من إعدادات المتصفح.",
    voiceFailed: "تعذّر تحويل الصوت — جرّب الكتابة.",
    bookViewing: "حجز معاينة",
    bookTitle: "حجز معاينة"
  },
  hi: {
    placeholder: "Dar Concierge AI से पूछें…",
    transcribing: "आवाज़ लिखी जा रही है…",
    recording: "रिकॉर्ड हो रहा है… भेजने के लिए टैप करें",
    micDenied: "माइक्रोफ़ोन की अनुमति नहीं मिली।",
    voiceFailed: "ट्रांसक्रिप्शन नहीं हो सका — टाइप करें।",
    bookViewing: "देखने का समय बुक करें",
    bookTitle: "देखने का समय बुक करें"
  },
  ur: {
    placeholder: "Dar Concierge AI سے پوچھیں…",
    transcribing: "آواز لکھی جا رہی ہے…",
    recording: "ریکارڈ ہو رہا ہے… بھیجنے کے لیے ٹیپ کریں",
    micDenied: "مائیکروفون کی اجازت نہیں ملی۔",
    voiceFailed: "آواز نہیں لکھی جا سکی — ٹائپ کریں۔",
    bookViewing: "ملاقات بک کریں",
    bookTitle: "ملاقات بک کریں"
  },
  ru: {
    placeholder: "Спросите Dar Concierge AI…",
    transcribing: "Расшифровка голоса…",
    recording: "Запись… нажмите, чтобы отправить",
    micDenied: "Нет доступа к микрофону.",
    voiceFailed: "Не удалось расшифровать — напишите текстом.",
    bookViewing: "Записаться на просмотр",
    bookTitle: "Записаться на просмотр"
  },
  fr: {
    placeholder: "Demandez à Dar Concierge AI…",
    transcribing: "Transcription en cours…",
    recording: "Enregistrement… appuyez pour envoyer",
    micDenied: "Microphone refusé.",
    voiceFailed: "Transcription impossible — écrivez votre message.",
    bookViewing: "Réserver une visite",
    bookTitle: "Réserver une visite"
  },
  es: {
    placeholder: "Pregunta a Dar Concierge AI…",
    transcribing: "Transcribiendo voz…",
    recording: "Grabando… toca para enviar",
    micDenied: "Micrófono denegado.",
    voiceFailed: "No se pudo transcribir — escribe tu mensaje.",
    bookViewing: "Reservar visita",
    bookTitle: "Reservar visita"
  },
  zh: {
    placeholder: "咨询 Dar Concierge AI…",
    transcribing: "正在转写语音…",
    recording: "录音中… 点击发送",
    micDenied: "麦克风被拒绝。",
    voiceFailed: "无法转写 — 请改用文字。",
    bookViewing: "预约看房",
    bookTitle: "预约看房"
  },
  tl: {
    placeholder: "Magtanong sa Dar Concierge AI…",
    transcribing: "Tina-transcribe ang boses…",
    recording: "Nagre-record… tap para ipadala",
    micDenied: "Tinanggihan ang mikropono.",
    voiceFailed: "Hindi ma-transcribe — mag-type na lang.",
    bookViewing: "Mag-book ng viewing",
    bookTitle: "Mag-book ng viewing"
  }
};

export function uiStrings(language = "en") {
  const code = String(language || "en").toLowerCase();
  return UI_STRINGS[code] || UI_STRINGS.en;
}
