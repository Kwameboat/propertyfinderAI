/**
 * Personal Assistant document RAG — chunk, embed (Gemini), retrieve.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPaDoc, replacePaChunks, listPaChunks, addPaEvent } from "./hub-db/pa.mjs";

function geminiKey() {
  return String(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      ""
  ).trim();
}

function embeddingModel() {
  return String(process.env.JAB_PA_EMBED_MODEL || "text-embedding-004").trim();
}

export function chunkText(text, { size = 900, overlap = 120 } = {}) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + size);
    chunks.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = Math.max(i + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

export async function embedTexts(texts) {
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY missing for embeddings");
  const model = embeddingModel();
  const out = [];
  for (const text of texts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:embedContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text: String(text || "").slice(0, 8000) }] }
      }),
      signal: AbortSignal.timeout(45000)
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Embed ${res.status}: ${body.slice(0, 180)}`);
    const json = JSON.parse(body || "{}");
    const values = json?.embedding?.values || json?.embeddings?.[0]?.values;
    if (!Array.isArray(values) || !values.length) throw new Error("Empty embedding");
    out.push(values);
  }
  return out;
}

export function cosineSim(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function extractPlainText(buf, mime = "", filename = "") {
  const name = String(filename || "").toLowerCase();
  const type = String(mime || "").toLowerCase();
  // Text / markdown / html-ish
  if (
    type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    name.endsWith(".json")
  ) {
    return Buffer.from(buf).toString("utf8");
  }
  // Naive PDF text scrape (works for many simple PDFs without extra deps)
  if (type.includes("pdf") || name.endsWith(".pdf")) {
    const raw = Buffer.from(buf).toString("latin1");
    const pieces = [];
    const re = /\((?:\\.|[^\\)]){2,}\)/g;
    let m;
    while ((m = re.exec(raw))) {
      let s = m[0].slice(1, -1);
      s = s
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
      if (/[A-Za-z]{3,}/.test(s)) pieces.push(s);
    }
    const joined = pieces.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length > 80) return joined;
    return "";
  }
  // Fallback: try utf8
  return Buffer.from(buf).toString("utf8");
}

export async function ingestPaDocument(db, {
  ownerId,
  baseDir,
  filename,
  mime,
  buffer,
  title = ""
}) {
  const dir = path.join(baseDir, "pa", "docs");
  mkdirSync(dir, { recursive: true });
  const stamp = createHash("sha1")
    .update(`${ownerId}:${filename}:${Date.now()}`)
    .digest("hex")
    .slice(0, 12);
  const safeName = String(filename || "doc")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const outPath = path.join(dir, `${stamp}-${safeName}`);
  writeFileSync(outPath, buffer);

  const text = extractPlainText(buffer, mime, filename);
  if (!text || text.trim().length < 40) {
    throw new Error(
      "Could not extract enough text from that file. Send TXT/MD, or a text-based PDF."
    );
  }

  const parts = chunkText(text);
  let embeddings = [];
  try {
    embeddings = await embedTexts(parts);
  } catch (error) {
    // Still store chunks without embeddings — keyword fallback still works
    embeddings = parts.map(() => []);
    addPaEvent(db, {
      ownerId,
      eventType: "embed_skip",
      detail: error.message
    });
  }

  const doc = createPaDoc(db, {
    ownerId,
    title: title || filename || "Untitled",
    sourcePath: outPath,
    mime: mime || "",
    charCount: text.length
  });
  replacePaChunks(db, {
    docId: doc.id,
    ownerId,
    chunks: parts.map((t, i) => ({ text: t, embedding: embeddings[i] || [] }))
  });
  addPaEvent(db, {
    ownerId,
    eventType: "doc_ingest",
    detail: `doc #${doc.id} chunks=${parts.length}`
  });
  return { doc, chunkCount: parts.length, path: outPath };
}

export async function retrievePaContext(db, ownerId, query, { topK = 5 } = {}) {
  const q = String(query || "").trim();
  if (!q) return { hits: [], promptBlock: "" };
  const chunks = listPaChunks(db, ownerId);
  if (!chunks.length) return { hits: [], promptBlock: "(no documents uploaded yet)" };

  let qEmb = null;
  try {
    qEmb = (await embedTexts([q]))[0];
  } catch {
    qEmb = null;
  }

  const scored = [];
  for (const ch of chunks) {
    let score = 0;
    let emb = [];
    try {
      emb = JSON.parse(ch.embedding_json || "[]");
    } catch {
      emb = [];
    }
    if (qEmb && emb.length) {
      score = cosineSim(qEmb, emb);
    } else {
      const lower = String(ch.text || "").toLowerCase();
      const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
      const hits = terms.filter((t) => lower.includes(t)).length;
      score = terms.length ? hits / terms.length : 0;
    }
    scored.push({ ...ch, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.filter((h) => h.score > 0.05).slice(0, topK);
  if (!hits.length) {
    return { hits: [], promptBlock: "No strong matches in uploaded documents." };
  }
  const promptBlock = [
    "Retrieved document chunks:",
    ...hits.map(
      (h, i) =>
        `[${i + 1}] (${h.doc_title || "doc"} · score ${h.score.toFixed(3)})\n${String(h.text).slice(0, 1200)}`
    )
  ].join("\n\n");
  return { hits, promptBlock };
}

export function readLocalFileIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return readFileSync(filePath);
}
