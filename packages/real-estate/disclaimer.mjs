/**
 * AI transparency disclaimer — shown under every assistant reply (UI + WhatsApp).
 */

export const AI_DISCLAIMER = {
  en: "This is AI. AI can make mistakes.",
  ar: "هذا ذكاء اصطناعي. قد يخطئ الذكاء الاصطناعي.",
  hi: "यह AI है। AI गलती कर सकता है।",
  ur: "یہ AI ہے۔ AI غلطی کر سکتا ہے۔",
  ru: "Это ИИ. ИИ может ошибаться.",
  fr: "Ceci est une IA. L'IA peut se tromper.",
  es: "Esto es IA. La IA puede equivocarse.",
  zh: "这是 AI。AI 可能会出错。",
  tl: "Ito ay AI. Maaaring magkamali ang AI.",
  de: "Das ist KI. KI kann Fehler machen.",
  pt: "Isto é IA. A IA pode errar."
};

export function aiDisclaimerText(language = "en") {
  const code = String(language || "en").toLowerCase();
  return AI_DISCLAIMER[code] || AI_DISCLAIMER.en;
}
