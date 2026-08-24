/**
 * Agency social caption + poster art-direction prompts (Gemini).
 */

export function buildSocialCaptionsPrompt({
  brief = "",
  brandName = "JAB Digital Hub",
  platforms = [],
  tone = "warm Ghana agency"
} = {}) {
  return [
    `You are the social creative lead for ${brandName} (${tone}).`,
    "From the brief, write captions AND poster copy for a PosterMyWall / Canva-style flyer.",
    "No markdown fences. No invented stats/ROI/%.",
    "Return ONLY valid JSON with keys:",
    "default, instagram, facebook, tiktok, x, linkedin, youtube, hashtags, imagePrompt, videoHook,",
    "posterHeadline, posterLine2, posterLine3, posterContact.",
    "",
    "Rules:",
    "- Captions are customer-facing post text (NOT a repeat of the operator instruction).",
    "- posterHeadline: 1–3 short ALL-CAPS style words for the flyer (e.g. SECURITY GUARDS).",
    "- posterLine2 / posterLine3: supporting stacked lines (e.g. WANTED IN / DUBAI).",
    "- posterContact: WhatsApp numbers or CTA from the brief if present, else empty string.",
    "- imagePrompt: detailed PosterMyWall art direction — dark poster, bold left headlines, 1–2 circular photo insets of realistic people matching the topic, white circle borders, contact arrow/bar, photorealistic, premium Instagram ad, no watermark.",
    "- hashtags: 3–8 tags without #.",
    "- x: max ~260 chars.",
    "",
    `Platforms: ${(platforms || []).join(", ") || "all"}`,
    `Brief: ${brief}`
  ].join("\n");
}

export function buildSocialChatSystemPrompt({ brandName = "JAB Digital Hub", context = "" } = {}) {
  return [
    `You are ${brandName}'s social media partner on Telegram.`,
    "You help design unique PosterMyWall-style flyers (varied styles), free stock photos, captions, and Reels — then publish after approval.",
    "",
    "How to talk:",
    "- Chat like a creative colleague — clear, warm, not a bot manual.",
    "- Before generating, you (or the system) collect: topic/roles, location, WhatsApp number(s), and a style.",
    "- If they describe a flyer idea, acknowledge it and ask for any missing number/location/style — do NOT pretend you already generated media.",
    "- Never claim a post went live unless the system says so.",
    "- Do not dump slash-command lists unless they ask for commands.",
    "",
    "Live context:",
    context || "(none)"
  ].join("\n");
}

export function parseCaptionsJson(raw) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const defaultCaption = String(obj.default || obj.instagram || obj.facebook || "").trim();
    if (!defaultCaption) return null;
    const hashtags = Array.isArray(obj.hashtags)
      ? obj.hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean)
      : [];
    return {
      default: defaultCaption,
      instagram: String(obj.instagram || defaultCaption).trim(),
      facebook: String(obj.facebook || defaultCaption).trim(),
      tiktok: String(obj.tiktok || defaultCaption).trim(),
      x: String(obj.x || defaultCaption).slice(0, 270).trim(),
      linkedin: String(obj.linkedin || defaultCaption).trim(),
      youtube: String(obj.youtube || defaultCaption).trim(),
      hashtags,
      imagePrompt: String(obj.imagePrompt || "").trim(),
      videoHook: String(obj.videoHook || "").trim(),
      posterHeadline: String(obj.posterHeadline || "").trim(),
      posterLine2: String(obj.posterLine2 || "").trim(),
      posterLine3: String(obj.posterLine3 || "").trim(),
      posterContact: String(obj.posterContact || "").trim()
    };
  } catch {
    return null;
  }
}

export function captionForPlatform(captions, platform) {
  const c = captions || {};
  const base = c[platform] || c.default || "";
  const tags = (c.hashtags || []).slice(0, 8).map((t) => (t.startsWith("#") ? t : `#${t}`));
  if (!tags.length) return base;
  if (platform === "x") {
    const withTags = `${base}\n\n${tags.slice(0, 3).join(" ")}`;
    return withTags.slice(0, 280);
  }
  return `${base}\n\n${tags.join(" ")}`;
}

function guessPosterFromBrief(brief) {
  const t = String(brief || "");
  const phones = [...t.matchAll(/(?:\+?\d[\d\s-]{7,}\d)/g)].map((m) => m[0].replace(/\s+/g, ""));
  const upper = t.toUpperCase();
  let posterHeadline = "NOW HIRING";
  if (/security/i.test(t)) posterHeadline = "SECURITY";
  else if (/clean/i.test(t)) posterHeadline = "CLEANERS";
  else if (/driver|yango|bolt/i.test(t)) posterHeadline = "DRIVERS";
  else if (/salon|beauty/i.test(t)) posterHeadline = "SALON";
  else if (/whatsapp|ai agent/i.test(t)) posterHeadline = "WHATSAPP AI";

  let posterLine2 = "GUARDS & CLEANERS";
  if (/security/i.test(t) && /clean/i.test(t)) posterLine2 = "GUARDS & CLEANERS";
  else if (/security/i.test(t)) posterLine2 = "GUARDS WANTED";
  else if (/clean/i.test(t)) posterLine2 = "WANTED";
  else if (/whatsapp|ai agent/i.test(t)) posterLine2 = "FOR BUSINESS";
  else posterLine2 = "APPLY NOW";

  let posterLine3 = "WANTED";
  if (/dubai/i.test(t)) posterLine3 = "IN DUBAI";
  else if (/ghana|accra|kumasi/i.test(t)) posterLine3 = "IN GHANA";
  else if (upper.includes("WANTED IN")) posterLine3 = "WANTED IN";

  return {
    posterHeadline,
    posterLine2,
    posterLine3,
    posterContact: phones.slice(0, 2).join(" / ")
  };
}

export function fallbackCaptions(brief, brandName = "JAB Digital Hub") {
  const poster = guessPosterFromBrief(brief);
  const line = [
    poster.posterHeadline,
    poster.posterLine2,
    poster.posterLine3,
    poster.posterContact ? `WhatsApp: ${poster.posterContact}` : null,
    `— ${brandName}`
  ]
    .filter(Boolean)
    .join("\n");
  return {
    default: line,
    instagram: line,
    facebook: line,
    tiktok: `${poster.posterHeadline} ${poster.posterLine2}`.trim(),
    x: `${poster.posterHeadline} ${poster.posterLine2} ${poster.posterLine3}`.trim().slice(0, 260),
    linkedin: line,
    youtube: `${poster.posterHeadline} ${poster.posterLine2}`.trim(),
    hashtags: ["Hiring", "Jobs", "WhatsApp"],
    imagePrompt: [
      "PosterMyWall-style Instagram recruitment flyer",
      "black background, bold white stacked headlines on the left",
      "two circular photorealistic insets with white borders on the right matching the job roles",
      "CONTACT US arrow and WhatsApp numbers at bottom left",
      "premium advertising layout, no watermark"
    ].join(", "),
    videoHook: poster.posterHeadline,
    ...poster
  };
}
