/**
 * Natural-language intent helpers for the Personal PA (no slash commands required).
 */

export function wantsWebSearch(text) {
  const t = String(text || "").toLowerCase();
  return (
    /\b(search|google|look up|lookup|browse|surf|internet|online|news|headline|current|today|latest|who won|what happened|weather|price of|stock|update me|any update)\b/.test(
      t
    ) ||
    /\b(202[4-9]|ghana news|world news|breaking)\b/.test(t) ||
    /\b(ghana law|what does (?:the )?law say|legal|statute|constitution|act \d|legislation)\b/.test(t) ||
    /\b(sentence|sentenced|jailed|jail|convict|conviction|arrest|arrested|court|judgement|judgment|galamsey|mining case)\b/.test(
      t
    ) ||
    /\b(chairman|wontumi|wonyumi|akufo|mahama|npp|ndc|parliament)\b/.test(t) ||
    /\b(have you heard|did you hear|is it true|what(?:'s| is) the (?:latest|update)|tell me about)\b/.test(t)
  );
}

export function wantsRag(text) {
  const t = String(text || "").toLowerCase();
  return /\b(sermon|preach|my notes|my document|what did i (write|preach|say)|from my (file|doc|notes|upload)|uploaded|in my notes)\b/.test(
    t
  );
}

export function wantsPreachTone(text) {
  const t = String(text || "").toLowerCase();
  return /\b(sermon|preach|preaching|scripture|bible study|homily|message outline|illustration for|application points|prayer points|pastoral)\b/.test(
    t
  );
}

export function wantsTopicTone(text) {
  const t = String(text || "").toLowerCase();
  return /\b(topic ideas|give me topics|suggest topics|brainstorm|theme ideas|sermon topics|content ideas)\b/.test(
    t
  );
}

export function wantsNewsTone(text) {
  const t = String(text || "").toLowerCase();
  return (
    /\b(headlines|current affairs|what(?:'s| is) happening|in the news|news today|breaking news|latest news)\b/.test(
      t
    ) ||
    /\b(sentence|sentenced|jailed|arrested|conviction|court judgement|court judgment)\b/.test(t) ||
    /\b(wontumi|wonyumi|chairman wontumi)\b/.test(t)
  );
}

/** One-turn mode hint (does not persist settings). */
export function inferModeFromMessage(text, currentMode = "pa") {
  if (wantsPreachTone(text)) return "preach";
  if (wantsTopicTone(text)) return "topics";
  if (wantsNewsTone(text) || wantsWebSearch(text)) return "news";
  return currentMode || "pa";
}

export function wantsMemories(text) {
  const t = String(text || "").toLowerCase();
  return /\b(what do you remember|show my memories|my memories|what have you saved|what did i tell you to remember)\b/.test(
    t
  );
}

export function wantsDocs(text) {
  const t = String(text || "").toLowerCase();
  return /\b(my documents|my docs|uploaded files|what files|what did i upload|list my notes)\b/.test(t);
}

export function wantsBrief(text) {
  const t = String(text || "").toLowerCase();
  return /\b(morning brief|daily brief|brief me|start my day|good morning brief|today'?s brief)\b/.test(t);
}

export function wantsHelp(text) {
  const t = String(text || "").toLowerCase().trim();
  return /^(help|what can you do|how do i use you|how does this work|hi|hello|hey)[!.?]*$/.test(t);
}

export function wantsStatus(text) {
  const t = String(text || "").toLowerCase();
  return /\b(status|how are you set up|are you online|system check)\b/.test(t);
}

export function wantsTaskList(text) {
  const t = String(text || "").toLowerCase();
  return /\b(my tasks|open tasks|what are my tasks|todo list|show tasks|what(?:'s| is) on my list|reminders list|what did i ask you to remind)\b/.test(
    t
  );
}

export function wantsCursorCapability(text) {
  const t = String(text || "").toLowerCase();
  return /\b(cursor|cloud agent|codebase|repo|repository|work on jab-hub|coding task)\b/.test(t);
}

export function parseRemember(text) {
  const t = String(text || "").trim();
  const patterns = [
    /^remember(?:\s+that)?\s+(.+)$/i,
    /^keep in mind(?:\s+that)?\s+(.+)$/i,
    /^(?:please\s+)?(?:don'?t|do not) forget(?:\s+that)?\s+(.+)$/i,
    /^save(?:\s+(?:this|that|memory))?[:\s]+(.+)$/i,
    /^note(?:\s+that)?\s+(.+)$/i,
    /^store(?:\s+that)?\s+(.+)$/i
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const body = m[1].trim();
    const kv = body.match(/^([^:=]{2,60})\s*[:=]\s*(.+)$/);
    if (kv) return { key: kv[1].trim(), value: kv[2].trim() };
    return { key: body.slice(0, 60), value: body };
  }
  return null;
}

export function parseRemind(text, now = Date.now(), tzOffsetMin = 0) {
  const t = String(text || "").trim();
  const lower = t.toLowerCase();

  const trigger =
    /\b(remind|reminder|don'?t let me forget|set a reminder|add (?:a )?reminder|schedule|todo|task)\b/i.test(
      lower
    ) || /\bi need to .+ (tomorrow|tonight|next week|at \d)/i.test(lower);

  if (!trigger) return null;

  let title = t
    .replace(/^\/?(remind|reminder|todo|task)\s+(me\s+)?(to\s+)?/i, "")
    .replace(/^(?:please\s+)?(?:don'?t|do not) let me forget(?:\s+to)?\s+/i, "")
    .replace(/^(?:set|add) (?:a )?reminder(?:\s+to)?\s+/i, "")
    .replace(/^schedule\s+/i, "")
    .replace(/^i need to\s+/i, "")
    .trim();

  let remindAt = null;
  const inMatch = lower.match(/\bin\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/);
  if (inMatch) {
    const n = Number(inMatch[1]);
    const unit = inMatch[2];
    const ms =
      /min/.test(unit) ? n * 60_000 : /hour|hr/.test(unit) ? n * 3_600_000 : n * 86_400_000;
    remindAt = now + ms;
    title = title.replace(/\bin\s+\d+\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/i, "").trim();
  }

  const tomorrow = /\btomorrow\b/.test(lower);
  const tonight = /\btonight\b/.test(lower);
  const timeMatch = lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if ((tomorrow || tonight || timeMatch) && !remindAt) {
    const d = new Date(now);
    d.setUTCMinutes(d.getUTCMinutes() + tzOffsetMin);
    if (tomorrow) d.setUTCDate(d.getUTCDate() + 1);
    let h = timeMatch ? Number(timeMatch[1]) : tonight ? 20 : 9;
    const min = timeMatch && timeMatch[2] ? Number(timeMatch[2]) : 0;
    const ap = timeMatch?.[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    d.setUTCHours(h, min, 0, 0);
    remindAt = d.getTime() - tzOffsetMin * 60_000;
    title = title
      .replace(/\btomorrow\b/i, "")
      .replace(/\btonight\b/i, "")
      .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/i, "")
      .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i, "")
      .trim();
  }

  title = title.replace(/^(to\s+)/i, "").replace(/\s+/g, " ").trim() || "Reminder";
  if (!remindAt) remindAt = now + 60 * 60_000;
  return { title: title.slice(0, 300), remindAt, dueAt: remindAt };
}

export function parseCompleteTask(text) {
  const patterns = [
    /\b(?:done|complete|finished|mark)\s+(?:task\s+|reminder\s+)?#?(\d+)\b/i,
    /\btask\s+#?(\d+)\s+(?:is\s+)?(?:done|complete|finished)\b/i,
    /\b(?:i(?:'ve| have))\s+(?:done|finished|completed)\s+(?:task\s+)?#?(\d+)\b/i
  ];
  for (const re of patterns) {
    const m = String(text || "").match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

export function parseCancelTask(text) {
  const m = String(text || "").match(
    /\b(?:cancel|delete|remove|drop)\s+(?:task\s+|reminder\s+)?#?(\d+)\b/i
  );
  if (!m) return null;
  return Number(m[1]);
}

/** Persistent mode switch from natural language (null = no switch). */
export function parseModeSwitch(text) {
  const t = String(text || "").trim();
  const slash = t.match(/^\/?mode\s+(pa|preach|preaching|sermon|news|affairs|topics|topic)\b/i);
  if (slash) return slash[1];

  if (/\b(back to normal|back to assistant|general assistant|normal mode|default mode)\b/i.test(t)) {
    return "pa";
  }
  if (
    /\b(switch to|go to|use|be my|act as|i want you as|from now on.*)(?:a\s+)?(?:preach|preaching|sermon)\b/i.test(
      t
    ) ||
    /\bpreaching companion\b/i.test(t)
  ) {
    return "preach";
  }
  if (
    /\b(switch to|go to|use|be my|act as|from now on.*)(?:news|current affairs)\b/i.test(t) ||
    /\bnews mode\b/i.test(t)
  ) {
    return "news";
  }
  if (/\b(switch to|go to|use|be my|act as|from now on.*)(?:topics|topic ideas)\b/i.test(t)) {
    return "topics";
  }
  if (/\b(switch to|go to|use|be my|act as|from now on.*)(?:pa|personal assistant|assistant mode)\b/i.test(t)) {
    return "pa";
  }
  return null;
}

export function naturalWelcome(ownerName = "Boss") {
  return [
    `Hey ${ownerName} — I’m your 24/7 Personal Assistant.`,
    "",
    "Just talk naturally. Examples:",
    "• What does Ghana law say about tenancy?",
    "• What’s in the news today?",
    "• Remind me tomorrow at 7am to call Kwame",
    "• Remember my church meets every Wednesday",
    "• Help me outline a sermon on faith",
    "• Send me a PDF or notes and ask me about it later",
    "• Use Cursor to fix a bug in jab-hub, then report back here",
    "",
    "No commands needed — chat like you would with ChatGPT."
  ].join("\n");
}
