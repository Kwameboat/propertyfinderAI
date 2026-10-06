/**
 * Lightweight language detection for UAE / Ghana concierge (no external deps).
 */

import { isGhanaMarket } from "./market.mjs";

export const LANGUAGE_NAMES = {
  en: "English",
  tw: "Twi (Akan)",
  fat: "Fante",
  ee: "Ewe",
  gaa: "Ga",
  dag: "Dagbani",
  ha: "Hausa",
  pidgin: "Ghanaian Pidgin",
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

export const GHANA_LANGUAGE_CODES = ["tw", "fat", "ee", "gaa", "dag", "ha", "pidgin"];

export function languageName(code = "en") {
  return LANGUAGE_NAMES[String(code || "en").toLowerCase()] || "English";
}

export function isGhanaianLanguage(code = "") {
  return GHANA_LANGUAGE_CODES.includes(String(code || "").toLowerCase());
}

const EXPLICIT_SWITCH = [
  { code: "tw", re: /\b(?:kasa\s+twi|speak(?:\s+in)?\s+twi|reply\s+in\s+twi|in\s+twi|asante\s+twi|akuapem|akan\s+kasa|\btwi\b)\b/i },
  { code: "fat", re: /\b(?:fante|mfantse|speak(?:\s+in)?\s+fante|reply\s+in\s+fante)\b/i },
  { code: "ee", re: /\b(?:eʋegbe|evegbe|speak(?:\s+in)?\s+ewe|reply\s+in\s+ewe|in\s+ewe|\bewe\b)\b/i },
  { code: "gaa", re: /\b(?:speak(?:\s+in)?\s+ga|reply\s+in\s+ga|kɛ\s+ga|in\s+ga language|\bga\s+kasa)\b/i },
  { code: "dag", re: /\b(?:dagbani|dagbanli|dagomba|speak(?:\s+in)?\s+dagbani|reply\s+in\s+dagbani)\b/i },
  { code: "ha", re: /\b(?:hausa|speak(?:\s+in)?\s+hausa|reply\s+in\s+hausa|in\s+hausa)\b/i },
  { code: "pidgin", re: /\b(?:ghana(?:ian)?\s+pidgin|speak(?:\s+in)?\s+pidgin|reply\s+in\s+pidgin|in\s+pidgin)\b/i }
];

function detectExplicitSwitch(text = "") {
  const raw = String(text || "");
  for (const row of EXPLICIT_SWITCH) {
    if (row.re.test(raw)) return row.code;
  }
  return null;
}

const TWI_RE =
  /[ɛɔ]|mepɛ|me pɛ|me pe\b|hwehwɛ|kyerɛ me|medaase|wo ho te sɛn|\bɛyɛ\b|\bɛhe\b|\bɔdan\b|\bofie\b|\bfie ha\b|\bsika\b.*\b(?:dan|ofie|fie)\b|\bme hia\b|\bme pɛ dan\b|\byɛn kɔ\b|\badɛn\b|\bkasa twi\b/i;
const FANTE_RE = /\b(?:mfantse|fante|hom|\bmo ho te sɛn)\b/i;
const EWE_RE =
  /[ƒɖʋɣ]|eʋegbe|\baƒe\b|\bxɔ\b|\bme le\b|\bnuka\b|\bakpe\b|\bmiele\b|\bɖe\b|\bwoƒe\b|\beʋe\b/i;
const GA_RE = /\b(?:tsɔɔmɔ|miishɛɛ|miŋ|\bshia\b|\boogbɛ\b|\bkɛɛ\b ga|\bga ju\b)\b/i;
const DAG_RE = /\b(?:dagbani|dagbanli|\bn bɔri\b|\byɛlimaŋli\b|\btiŋa\b)\b/i;
const HAUSA_RE = /\b(?:ina so|gida|haya|zan sayi|na so gida|hausa)\b/i;
const PIDGIN_RE = /\b(?:i dey|you dey|abeg|wahala|make i|e be like|how far|i wan rent|i dey find)\b/i;

export function detectLanguage(text = "") {
  const t = String(text || "")
    .replace(/^\[voice note\]\s*/i, "")
    .trim();
  if (!t) return "en";

  const switched = detectExplicitSwitch(t);
  if (switched) return switched;

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

  if (EWE_RE.test(t)) return "ee";
  if (DAG_RE.test(t)) return "dag";
  if (GA_RE.test(t) && !/\bga\s+(?:west|south|east|north)\b/i.test(t)) return "gaa";
  if (FANTE_RE.test(t)) return "fat";
  if (TWI_RE.test(t)) return "tw";
  if (HAUSA_RE.test(t)) return "ha";
  if (PIDGIN_RE.test(t)) return "pidgin";

  const lower = t.toLowerCase();
  if (/\b(bonjour|appartement|cherche|louer|je veux)\b/.test(lower)) return "fr";
  if (/\b(hola|busco|apartamento|alquiler|quiero)\b/.test(lower)) return "es";
  if (/\b(olá|procuro|apartamento|alugar)\b/.test(lower)) return "pt";
  if (/\b(guten|wohnung|miete|ich suche)\b/.test(lower)) return "de";
  if (/\b(kumusta|hanap|paupahan|gusto ko)\b/.test(lower)) return "tl";
  if (/\b(хочу|квартира|аренда|ищу)\b/.test(lower)) return "ru";

  return "en";
}

function looksLikeEnglish(text = "") {
  const lower = String(text || "").toLowerCase();
  const hits = (lower.match(/\b(?:the|this|that|what|where|show|need|want|please|rent|bedroom|apartment)\b/g) || [])
    .length;
  return hits >= 3;
}

/** Keep session language unless user clearly switches. */
export function resolveSessionLanguage(text = "", previous = "en") {
  const detected = detectLanguage(text);
  const prev = String(previous || "en").toLowerCase();
  if (!String(text || "").trim()) return prev || "en";
  if (detectExplicitSwitch(text)) return detected;
  if (detected === "en" && prev !== "en" && String(text).trim().length < 24) {
    return prev;
  }
  if (detected === "en" && isGhanaianLanguage(prev) && !looksLikeEnglish(text)) {
    return prev;
  }
  return detected;
}

function ghanaLanguageStyle(code) {
  const styles = {
    tw: [
      "- Reply in natural Ghanaian Twi as people chat on WhatsApp (Asante/Akuapem mix is fine). Use ɛ and ɔ.",
      "- Keep area names in English (East Legon, Osu, Spintex). You may keep self-contain / chamber and hall in English if that is how the client said it.",
      "- Do not write stiff textbook Twi or word-for-word English translation."
    ],
    fat: [
      "- Reply in natural Fante (Mfantse). Keep Accra/Cape Coast place names in English."
    ],
    ee: [
      "- Reply in natural Ewe (Eʋegbe). Use ƒ, ɖ, ʋ, ŋ where needed.",
      "- Keep Accra/Ho/Tema place names in English. Do not invent Ewe."
    ],
    gaa: [
      "- Reply in natural Ga. Keep Accra area names in English."
    ],
    dag: [
      "- Reply in natural Dagbani (Dagbanli). Keep Tamale/Accra place names in English."
    ],
    ha: [
      "- Reply in the Hausa used in Ghana (Zongo), not Kano newspaper Hausa. Keep GH₵ and Accra place names."
    ],
    pidgin: [
      "- Reply in Ghanaian Pidgin, not Nigerian slang you are unsure of. Short and clear."
    ]
  };
  return (styles[code] || []).join("\n");
}

export function languagePromptBlock(language = "en") {
  const code = String(language || "en").toLowerCase();
  const name = languageName(code);
  return [
    "Language (critical):",
    `- Always reply in ${name} (${code}) — the user's current language.`,
    "- If they switch language mid-chat, switch immediately to match them.",
    isGhanaMarket()
      ? "- You are fluent in Ghanaian languages: Twi (Akan), Fante, Ewe, Ga, Dagbani, Hausa, and Ghanaian Pidgin, plus Ghanaian English. Voice notes may arrive in any of these — answer in the same language."
      : "- Keep UAE place names and AED prices as-is (Marina, JVC, AED 120,000/year).",
    isGhanaMarket()
      ? "- Keep Ghana place names and GH₵ prices as-is (East Legon, Osu, GH₵ 1,800/month)."
      : "",
    "- Voice notes arrive as transcribed text — respond in the transcript's language.",
    ghanaLanguageStyle(code),
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

export function voiceTranscriptionPrompt() {
  if (isGhanaMarket()) {
    return [
      "Transcribe this Ghana voice note.",
      "The speaker may use Ghanaian English, Twi (Akan), Fante, Ewe, Ga, Dagbani, Hausa, Ghanaian Pidgin, or mix them in one message.",
      "Write exactly what they said, in that language. Use Ghanaian letters ɛ ɔ ƒ ɖ ŋ ʋ where they used those sounds.",
      "Do not translate into English unless they spoke English. Reply with ONLY the transcript — no labels, quotes, or preamble."
    ].join(" ");
  }
  return "Transcribe this voice note to plain text in the language spoken. Reply with ONLY the transcript — no labels, quotes, or preamble.";
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
  tw: {
    placeholder: "Bisa PropertyFinder Gh…",
    transcribing: "Yɛrekyerɛw wo nne…",
    recording: "Yɛrekyere… mia mic na fa kɔ",
    micDenied: "Browser no ammɛn wo microphone. Ma ho kwan wɔ settings mu.",
    voiceFailed: "Yɛantumi ankyerɛw nne no — twerɛ kyerɛ me.",
    bookViewing: "Tua kɔhwɛ",
    bookTitle: "Tua kɔhwɛ"
  },
  ee: {
    placeholder: "Bia PropertyFinder Gh…",
    transcribing: "Miele gbe ŋlɔm…",
    recording: "Miele mɔ̃ ɖem… zi mic ɖe ɖoɖo",
    micDenied: "Browser me de mɔ̃ ɖe microphone ŋu o.",
    voiceFailed: "Meteŋu ŋlɔ gbe la o — ŋlɔe.",
    bookViewing: "Dɔ kpɔkpɔ",
    bookTitle: "Dɔ kpɔkpɔ"
  },
  gaa: {
    placeholder: "Bii PropertyFinder Gh…",
    transcribing: "Wɔŋmɛɔ dzee…",
    recording: "Wɔŋmɛɔ… shi mic kɛha",
    micDenied: "Browser ekɛ microphone lɛ shwie.",
    voiceFailed: "Wɔnyɛ dzee ŋmaaa — ŋma.",
    bookViewing: "Naakpɛɛ",
    bookTitle: "Naakpɛɛ"
  },
  fat: {
    placeholder: "Bisa PropertyFinder Gh…",
    transcribing: "Yɛrekyerɛw wo ndze…",
    recording: "Yɛrekyerɛ… mia mic",
    micDenied: "Browser no ammɛn microphone.",
    voiceFailed: "Yɛantumi — kyerɛw kyerɛ me.",
    bookViewing: "Tua kɔhwɛ",
    bookTitle: "Tua kɔhwɛ"
  },
  dag: {
    placeholder: "Bɔhi PropertyFinder Gh…",
    transcribing: "Ti yɛri a yɛltɔɣa…",
    recording: "Ti yɛri… n-ŋme mic",
    micDenied: "Browser bi ti microphone.",
    voiceFailed: "Ti ku tooi yɛli — sabi.",
    bookViewing: "Labi nya",
    bookTitle: "Labi nya"
  },
  ha: {
    placeholder: "Tambayi PropertyFinder Gh…",
    transcribing: "Muna rubuta murya…",
    recording: "Ana ɗauka… taɓa mic",
    micDenied: "Browser ya hana microphone.",
    voiceFailed: "Ba a iya rubuta muryar — rubuta.",
    bookViewing: "Biyan duba",
    bookTitle: "Biyan duba"
  },
  pidgin: {
    placeholder: "Ask PropertyFinder Gh…",
    transcribing: "I dey write di voice…",
    recording: "I dey record… tap mic send",
    micDenied: "Browser no gree microphone.",
    voiceFailed: "E no transcribe — type am.",
    bookViewing: "Pay make we go see",
    bookTitle: "Pay make we go see"
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
