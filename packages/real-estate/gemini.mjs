/**
 * Gemini chat runner for UAE real estate concierge (session memory on disk).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { voiceTranscriptionPrompt } from "./language.mjs";

const STATE_DIR = process.env.VERCEL
  ? path.join("/tmp", "fie-ai-gemini")
  : path.join(
      process.env.JAB_HUB_DATA_DIR ||
        path.join(process.env.USERPROFILE || process.env.HOME || "", ".openclaw", "jab-hub"),
      "gemini"
    );
const SESSION_PATH = path.join(STATE_DIR, "re-sessions.json");
const GEMINI_MODEL =
  process.env.JAB_RE_GEMINI_MODEL ||
  process.env.JAB_HUB_GEMINI_MODEL ||
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash";

const SESSION_MAX = Number(process.env.JAB_RE_SESSION_HISTORY_MAX || 24);

const GEMINI_API_BASE =
  process.env.JAB_HUB_GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";

let sessionChain = Promise.resolve();

async function readSessions() {
  try {
    const raw = await readFile(SESSION_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistSessions(mutator) {
  sessionChain = sessionChain.then(async () => {
    const sessions = await readSessions();
    await mutator(sessions);
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(SESSION_PATH, JSON.stringify(sessions), "utf8");
  });
  return sessionChain;
}

export async function resolveGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY.trim();
  return "";
}

export function stripHiddenTokens(text = "") {
  let out = String(text || "")
    .replace(/\[LEAD_READY\]/gi, "")
    .replace(/\[SHORTLIST:[^\]]+\]/gi, "")
    .replace(/\[CRITERIA:[^\]]+\]/gi, "");

  out = out.replace(/```(?:json)?\s*[\s\S]*?```/gi, "");
  out = out.replace(/\{\s*"listings"\s*:\s*\[[\s\S]*?\]\s*\}/gi, "");
  out = out.replace(/^\s*\[\s*\{[\s\S]*?"id"\s*:\s*"L\d+/m, "");

  const jargon = [
    /\b(?:gemini|google search|grounding|RAG|live search|synced inventory|supabase|APIFY|scrape)\b/gi,
    /\bI(?:'ve| have) (?:searched|looked up|queried|pulled)[^.!?]*[.!?]/gi,
    /\b(?:searching|looking up|running a search|live data from)[^.!?]*[.!?]/gi,
    /\bbased on (?:my|the) search[^.!?]*[.!?]/gi,
    /\bas an AI\b[^.!?]*[.!?]?/gi
  ];
  for (const re of jargon) out = out.replace(re, "");

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export async function transcribeVoiceNote({ base64, mimetype = "audio/webm" } = {}) {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing for voice transcription");

  const model =
    process.env.JAB_RE_GEMINI_MODEL ||
    process.env.JAB_HUB_GEMINI_MODEL ||
    GEMINI_MODEL;
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const data = String(base64 || "")
    .trim()
    .replace(/^data:[^;]+;base64,/, "");

  if (!data) throw new Error("Empty audio payload");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: voiceTranscriptionPrompt()
            },
            { inlineData: { mimeType: mimetype || "audio/webm", data } }
          ]
        }
      ],
      generationConfig: { temperature: 0.1, maxOutputTokens: 900 }
    }),
    signal: AbortSignal.timeout(90000)
  });

  const body = await response.text();
  if (!response.ok) throw new Error(`Gemini transcribe ${response.status}: ${body.slice(0, 300)}`);

  const parsed = JSON.parse(body || "{}");
  const text =
    parsed?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const transcript = String(text).trim();
  if (!transcript) throw new Error("Empty transcription");
  return transcript;
}

export async function runRealEstateGemini({ systemPrompt, userMessage, sessionKey, history = [], timeoutSec = 60 }) {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing for UAE real estate agent");

  const sessions = await readSessions();
  const filePrior = Array.isArray(sessions[sessionKey]) ? sessions[sessionKey] : [];
  const prior = history.length ? history : filePrior;
  const contents = [];
  for (const turn of prior.slice(-SESSION_MAX)) {
    if (!turn?.text) continue;
    contents.push({
      role: turn.role === "model" ? "model" : "user",
      parts: [{ text: String(turn.text) }]
    });
  }
  contents.push({ role: "user", parts: [{ text: String(userMessage || "") }] });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5, timeoutSec) * 1000);
  try {
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents,
        generationConfig: {
          temperature: 0.65,
          topP: 0.92,
          maxOutputTokens: 1024
        }
      }),
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${body.slice(0, 400)}`);
    const parsed = JSON.parse(body);
    const text =
      parsed?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
      parsed?.candidates?.[0]?.output ||
      "";
    if (!text.trim()) throw new Error("Gemini returned empty response");

    await persistSessions((store) => {
      const next = Array.isArray(store[sessionKey]) ? store[sessionKey] : [];
      next.push({ role: "user", text: String(userMessage || "").slice(0, 2000) });
      next.push({ role: "model", text: text.slice(0, 2000) });
      store[sessionKey] = next.slice(-SESSION_MAX * 2);
    });

    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function runOpenClawRealEstate({ systemPrompt, userMessage, sessionKey, history = [], timeoutSec = 60 }) {
  const via = String(process.env.JAB_RE_OPENCLAW_VIA || process.env.JAB_HUB_OPENCLAW_VIA || "gemini").toLowerCase();
  if (via === "gemini") {
    return runRealEstateGemini({ systemPrompt, userMessage, sessionKey, history, timeoutSec });
  }

  const gatewayUrl = (process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789").replace(/\/$/, "");
  const agentId = process.env.JAB_RE_OPENCLAW_AGENT_ID || "uae-real-estate-agent";
  const token = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.JAB_HUB_OPENCLAW_TOKEN || "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5, timeoutSec) * 1000);
  try {
    const prompt = [systemPrompt, `\nMessage: ${userMessage}`].filter(Boolean).join("\n");
    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "Content-Type": "application/json",
        "x-openclaw-agent-id": agentId,
        "x-openclaw-session-key": sessionKey,
        "x-openclaw-message-channel": "web"
      },
      body: JSON.stringify({
        model: `openclaw/${agentId}`,
        stream: false,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`OpenClaw HTTP ${response.status}: ${body.slice(0, 400)}`);
    const parsed = JSON.parse(body);
    const text =
      parsed?.choices?.[0]?.message?.content ||
      parsed?.choices?.[0]?.text ||
      parsed?.output ||
      "";
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export { GEMINI_MODEL, GEMINI_API_BASE };
