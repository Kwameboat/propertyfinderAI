/**
 * Agency prospect qualification scoring + digest text for WhatsApp ops alerts.
 * Full chat stays in Hub Inbox — connected numbers get score + short summary only.
 */

/** Score end-customer chats on client business WhatsApp lines (store, travel, etc.). */
export function scoreClientProspect({
  messages = [],
  inboundText = "",
  pushName = "",
  existingScore = 0
} = {}) {
  const customerLines = messages
    .filter((m) => m.role === "customer" || m.direction === "in")
    .map((m) => String(m.body || ""))
    .concat(inboundText ? [String(inboundText)] : []);
  const allText = customerLines.join("\n");
  const lower = allText.toLowerCase();
  const assistantText = messages
    .filter((m) => m.role === "assistant" || m.direction === "out")
    .map((m) => String(m.body || ""))
    .join("\n")
    .toLowerCase();

  let score = 0;
  const signals = [];

  if (/price|pricing|cost|ghs|how much|quote|fee|budget|pay|payment|buy|order|purchase/.test(lower)) {
    score += 28;
    signals.push("pricing / purchase interest");
  }
  if (/book|booking|appointment|schedule|reserve|available|when can|tomorrow|today|date/.test(lower)) {
    score += 24;
    signals.push("booking intent");
  }
  if (/deliver|delivery|location|address|pickup|ship|send to/.test(lower)) {
    score += 16;
    signals.push("delivery / location");
  }
  if (/interested|i want|need|looking for|do you have|available/.test(lower)) {
    score += 14;
    signals.push("product interest");
  }
  if (customerLines.length >= 3) {
    score += 10;
    signals.push("engaged chat");
  }
  if (/\b(yes|ok|okay|sure|sounds good|let's|lets go|ready|confirm)\b/.test(lower)) {
    score += 12;
    signals.push("positive intent");
  }
  if (/\[payment_link|paystack|checkout|paid|receipt/.test(assistantText)) {
    score += 18;
    signals.push("payment step");
  }
  if (/\b(stop|unsubscribe|not interested|no thanks|leave me|spam)\b/.test(lower)) {
    score -= 45;
    signals.push("opt-out risk");
  }

  score = Math.max(0, Math.min(100, score));
  const mergedScore = Math.max(score, Math.floor(Number(existingScore) || 0));
  if (signals.includes("opt-out risk")) {
    return {
      score: Math.min(mergedScore, 25),
      summary: buildQualificationSummary({ pushName, signals, inboundText }),
      signals
    };
  }
  return {
    score: mergedScore,
    summary: buildQualificationSummary({ pushName, signals, inboundText }),
    signals
  };
}

export function scoreAgencyProspect({
  messages = [],
  inboundText = "",
  pushName = "",
  existingScore = 0
} = {}) {
  const customerLines = messages
    .filter((m) => m.role === "customer" || m.direction === "in")
    .map((m) => String(m.body || ""))
    .concat(inboundText ? [String(inboundText)] : []);
  const allText = customerLines.join("\n");
  const lower = allText.toLowerCase();
  const assistantText = messages
    .filter((m) => m.role === "assistant" || m.direction === "out")
    .map((m) => String(m.body || ""))
    .join("\n")
    .toLowerCase();

  let score = 0;
  const signals = [];

  if (/price|pricing|cost|ghs|how much|package|plan|setup|pay|payment|subscribe/.test(lower)) {
    score += 28;
    signals.push("pricing interest");
  }
  if (/demo|call|meet|schedule|tomorrow|today|screen.?share|zoom/.test(lower)) {
    score += 22;
    signals.push("demo intent");
  }
  if (
    /agency|business|shop|store|clinic|travel|salon|restaurant|company|brand|startup/.test(lower)
  ) {
    score += 18;
    signals.push("business context");
  }
  if (customerLines.length >= 3) {
    score += 12;
    signals.push("engaged chat");
  }
  if (/\b(yes|ok|okay|interested|let's|lets go|sounds good|i want|ready)\b/.test(lower)) {
    score += 12;
    signals.push("positive intent");
  }
  if (/\[payment_link|paystack|checkout/.test(assistantText)) {
    score += 15;
    signals.push("payment link sent");
  }
  if (/\b(stop|unsubscribe|not interested|no thanks|leave me)\b/.test(lower)) {
    score -= 45;
    signals.push("opt-out risk");
  }

  score = Math.max(0, Math.min(100, score));
  const mergedScore = Math.max(score, Math.floor(Number(existingScore) || 0));
  if (signals.includes("opt-out risk")) {
    return {
      score: Math.min(mergedScore, 25),
      summary: buildQualificationSummary({ pushName, signals, inboundText }),
      signals
    };
  }
  return {
    score: mergedScore,
    summary: buildQualificationSummary({ pushName, signals, inboundText }),
    signals
  };
}

export function buildQualificationSummary({ pushName = "", signals = [], inboundText = "" } = {}) {
  const name = String(pushName || "").trim() || "Prospect";
  const latest = String(inboundText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const tag = signals.length ? signals.slice(0, 3).join(" · ") : "early chat";
  if (latest) return `${name}: ${tag} — "${latest}${latest.length >= 120 ? "…" : ""}"`;
  return `${name}: ${tag}`;
}

/** One-line digest from full handoff briefing (stored in Hub only). */
export function digestFromHandoffBriefing(briefing, { pushName = "", score = 0, fallback = "" } = {}) {
  const lines = String(briefing || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const intent = lines.find((l) => /^intent:/i.test(l));
  const discussed = lines.find((l) => /^discussed so far:/i.test(l));
  const pick = intent || discussed;
  if (pick) {
    return pick.replace(/^[^:]+:\s*/i, "").slice(0, 160);
  }
  return fallback || buildQualificationSummary({ pushName, signals: [`score ${score}`] });
}

/** Human-readable WhatsApp number for ops alerts (incl. LID). */
export function formatDisplayPhone(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "—";
  if (raw.includes("@lid")) return `${raw.split("@")[0]} (WhatsApp ID)`;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  if (digits.length >= 10) return `+${digits}`;
  return digits;
}

export function formatContactAlertLines({ name, phone, label = "Client" } = {}) {
  const n = String(name || "").trim();
  return [`${label}: ${n || "Unknown"}`, `${label} WhatsApp: ${formatDisplayPhone(phone)}`];
}

export function prospectWaMeUrl(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

export function formatAgencyLeadDigest({
  pushName = "Prospect",
  phone = "",
  score = 0,
  summary = "",
  event = "Lead update",
  hubUrl = "",
  hubClientName = "",
  hubClientPhone = "",
  channelName = "",
  channelPhone = "",
  includeHubUrl = false
} = {}) {
  const lines = [`📋 ${event}`, ...formatContactAlertLines({ name: pushName, phone, label: "Client" })];
  if (hubClientName && hubClientPhone) {
    lines.push(
      ...formatContactAlertLines({ name: hubClientName, phone: hubClientPhone, label: "Hub account" })
    );
  } else if (hubClientName) {
    lines.push(`Hub account: ${hubClientName}`);
  } else if (hubClientPhone) {
    lines.push(`Hub account WhatsApp: ${formatDisplayPhone(hubClientPhone)}`);
  }
  if (channelName || channelPhone) {
    const channelParts = [channelName, channelPhone ? formatDisplayPhone(channelPhone) : null].filter(Boolean);
    if (channelParts.length) lines.push(`Channel: ${channelParts.join(" · ")}`);
  }
  lines.push(`Qualification: ${Math.round(Number(score) || 0)}/100`);
  if (summary) lines.push(`Summary: ${String(summary).slice(0, 280)}`);
  const wa = prospectWaMeUrl(phone);
  if (wa) lines.push(`WhatsApp prospect → ${wa}`);
  if (includeHubUrl && hubUrl) lines.push(`Full chat → ${hubUrl}`);
  return lines.filter(Boolean).join("\n");
}

export function agencyInboxUrl(publicBase, instanceName, phone) {
  const base = String(publicBase || "").replace(/\/$/, "");
  const inst = encodeURIComponent(instanceName || "");
  const ph = encodeURIComponent(String(phone || "").replace(/\D/g, ""));
  return `${base}/?tab=inbox&instance=${inst}&phone=${ph}`;
}
