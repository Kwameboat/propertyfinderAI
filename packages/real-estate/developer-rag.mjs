/**
 * Developer & Government live RAG — fetch curated URLs → Jina → Gemini → prompt block.
 */

import { ALL_INTEL_SOURCES } from "./data/developer-sources.mjs";
import { resolveGeminiApiKey, GEMINI_API_BASE, GEMINI_MODEL } from "./gemini.mjs";
import { extractImagesFromText } from "./listing-images.mjs";
import { upsertDeveloperIntelRow, searchDeveloperIntelSupabase, isSupabaseEnabled } from "./supabase.mjs";

const TIMEOUT_MS = Math.min(Math.max(Number(process.env.DEVELOPER_INTEL_TIMEOUT_MS || 90000), 30000), 120000);
const MAX_URLS = Math.min(Math.max(Number(process.env.DEVELOPER_INTEL_MAX_URLS || 3), 1), 5);

function tokenize(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Score and pick registry sources for this query. */
export function matchIntelSources(query = "", { limit = MAX_URLS } = {}) {
  const words = new Set(tokenize(query));
  const scored = ALL_INTEL_SOURCES.map((src) => {
    let score = 0;
    const name = src.name.toLowerCase();
    if (words.has(src.id)) score += 8;
    if ([...words].some((w) => name.includes(w) || w.includes(src.id))) score += 4;
    for (const kw of src.keywords || []) {
      const k = kw.toLowerCase();
      if (words.has(k) || query.toLowerCase().includes(k)) score += 3;
      for (const w of words) {
        if (k.includes(w) || w.includes(k.split(" ")[0])) score += 1;
      }
    }
    if (src.type === "government" && /dld|rera|regulation|government|law|fee|ejari|tenancy|news|update/.test(query.toLowerCase())) {
      score += 2;
    }
    if (src.type === "developer" && /developer|off plan|off-plan|project|launch|handover|payment plan/.test(query.toLowerCase())) {
      score += 2;
    }
    return { src, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    const fallback =
      /dld|rera|regulation|government|ejari|tenancy|fee|law/.test(query.toLowerCase())
        ? ALL_INTEL_SOURCES.filter((s) => s.type === "government")
        : ALL_INTEL_SOURCES.filter((s) => s.type === "developer");
    return fallback.slice(0, limit).flatMap((src) => src.urls.slice(0, 1).map((url) => ({ src, url })));
  }

  const picks = [];
  for (const { src } of scored) {
    for (const url of src.urls) {
      picks.push({ src, url });
      if (picks.length >= limit) return picks;
    }
  }
  return picks;
}

async function fetchPageMarkdown(url = "") {
  const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
  const res = await fetch(jinaUrl, {
    headers: { Accept: "text/markdown", "X-Return-Format": "markdown" },
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
  return (await res.text()).slice(0, 14000);
}

function parseGeminiJson(text = "") {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const m = candidate.match(/\{[\s\S]*\}/);
    if (m) try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function extractIntelWithGemini(pages = [], query = "") {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) return { projects: [], updates: [], summary: "" };

  const pageBlock = pages
    .map((p, i) => `--- PAGE ${i + 1}: ${p.url} (${p.sourceName}, ${p.sourceType}) ---\n${p.markdown.slice(0, 6000)}`)
    .join("\n\n");

  const prompt = [
    `User question: ${query}`,
    "Extract UAE real estate developer projects and/or government updates from the page markdown below.",
    "Return ONLY valid JSON (no markdown fences):",
    `{
  "summary": "2-3 sentence overview answering the user",
  "projects": [
    {
      "developer": "",
      "project_name": "",
      "emirate": "",
      "location": "",
      "status": "selling|announced|handover",
      "payment_plan": "",
      "handover": "",
      "price_from": "",
      "unit_types": [],
      "amenities": [],
      "description": "",
      "source_url": ""
    }
  ],
  "updates": [
    {
      "agency": "DLD|RERA|ADREC|other",
      "title": "",
      "summary": "",
      "effective_date": "",
      "category": "regulation|fee|news|tenancy",
      "source_url": ""
    }
  ]
}`,
    "Rules: only facts present in the markdown; real source_url from PAGE headers; max 6 projects and 4 updates.",
    pageBlock
  ].join("\n\n");

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 2500, responseMimeType: "application/json" }
    }),
    signal: AbortSignal.timeout(60000)
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(JSON.stringify({ at: new Date().toISOString(), developerIntelGeminiError: body.slice(0, 300) }));
    return { projects: [], updates: [], summary: "" };
  }

  const parsed = JSON.parse(body);
  const text = parsed?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const data = parseGeminiJson(text) || {};
  return {
    summary: String(data.summary || "").trim(),
    projects: Array.isArray(data.projects) ? data.projects : [],
    updates: Array.isArray(data.updates) ? data.updates : []
  };
}

export function formatDeveloperIntelBlock({ summary = "", projects = [], updates = [], fetchedAt = "" } = {}) {
  if (!summary && !projects.length && !updates.length) {
    return "";
  }
  const lines = ["DEVELOPER & GOVERNMENT LIVE DATA (from official sites — cite naturally, do not mention scraping):"];
  if (summary) lines.push(`Overview: ${summary}`);
  if (fetchedAt) lines.push(`Fetched: ${fetchedAt}`);

  for (const p of projects.slice(0, 6)) {
    lines.push(
      [
        `Project: ${p.project_name || p.title || "—"} by ${p.developer || "—"}`,
        p.location || p.emirate ? `Location: ${[p.location, p.emirate].filter(Boolean).join(", ")}` : null,
        p.payment_plan ? `Payment: ${p.payment_plan}` : null,
        p.handover ? `Handover: ${p.handover}` : null,
        p.price_from ? `From: ${p.price_from}` : null,
        p.description ? String(p.description).slice(0, 200) : null,
        p.source_url ? `Source: ${p.source_url}` : null
      ]
        .filter(Boolean)
        .join(" · ")
    );
  }

  for (const u of updates.slice(0, 4)) {
    lines.push(
      [
        `Update (${u.agency || "Gov"}): ${u.title || "—"}`,
        u.summary ? String(u.summary).slice(0, 220) : null,
        u.effective_date ? `Date: ${u.effective_date}` : null,
        u.source_url ? `Source: ${u.source_url}` : null
      ]
        .filter(Boolean)
        .join(" · ")
    );
  }

  return lines.join("\n");
}

export function projectsToListingCards(projects = []) {
  return projects.slice(0, 5).map((p, i) => {
    const images = Array.isArray(p.images) ? p.images : extractImagesFromText(p.description || "");
    return {
      id: `dev-${String(p.source_url || p.project_name || i).replace(/\W+/g, "-").slice(0, 40)}`,
      title: `${p.project_name || "Project"} · ${p.developer || "Developer"}`,
      transaction_type: "off_plan",
      emirate: p.emirate || "Dubai",
      community: p.location || p.emirate || "",
      beds: null,
      price_aed: Number(String(p.price_from || "").replace(/[^\d.]/g, "")) || 0,
      price_period: "total",
      developer: p.developer || "",
      payment_plan: p.payment_plan || "",
      handover_date: p.handover || "",
      images,
      image: images[0] || null,
      source: "developer_intel",
      source_url: p.source_url || "",
      description: String(p.description || p.summary || "").slice(0, 300),
      amenities: Array.isArray(p.amenities) ? p.amenities : []
    };
  });
}

async function persistIntel(pages = [], extracted = {}) {
  if (!isSupabaseEnabled()) return;
  const now = new Date().toISOString();
  for (const p of extracted.projects || []) {
    const page = pages.find((x) => p.source_url?.startsWith?.(new URL(x.url).origin)) || pages[0];
    void upsertDeveloperIntelRow({
      url: p.source_url || page?.url,
      source_name: page?.sourceName || p.developer,
      source_type: "developer",
      title: p.project_name || "",
      summary: p.description || extracted.summary,
      developer: p.developer,
      project_name: p.project_name,
      emirate: p.emirate,
      payment_plan: p.payment_plan,
      handover: p.handover,
      price_from: p.price_from,
      unit_types: p.unit_types || [],
      amenities: p.amenities || [],
      images: p.images || [],
      metadata: { status: p.status, query_at: now }
    }).catch(() => {});
  }
  for (const u of extracted.updates || []) {
    void upsertDeveloperIntelRow({
      url: u.source_url || pages[0]?.url,
      source_name: u.agency || "Government",
      source_type: "government",
      title: u.title,
      summary: u.summary,
      metadata: { category: u.category, effective_date: u.effective_date, query_at: now }
    }).catch(() => {});
  }
}

/** Main entry: live fetch developer/gov intel for chat. */
export async function buildDeveloperIntelContext(query = "", { useCache = true } = {}) {
  const q = String(query || "").trim();
  if (!q) return { block: "", projects: [], updates: [], sources: [] };

  if (useCache && isSupabaseEnabled()) {
    try {
      const term = q.split(/\s+/).slice(0, 4).join(" ");
      const cached = await searchDeveloperIntelSupabase({ q: term, limit: 6 });
      const fresh = (cached || []).filter((row) => {
        const age = Date.now() - new Date(row.last_updated || 0).getTime();
        return age < 6 * 3600 * 1000;
      });
      if (fresh.length >= 2) {
        const projects = fresh
          .filter((r) => r.source_type === "developer")
          .map((r) => ({
            developer: r.developer,
            project_name: r.project_name || r.title,
            emirate: r.emirate,
            location: r.emirate,
            payment_plan: r.payment_plan,
            handover: r.handover,
            price_from: r.price_from,
            description: r.summary,
            source_url: r.url,
            amenities: r.amenities,
            images: r.images
          }));
        const updates = fresh
          .filter((r) => r.source_type === "government")
          .map((r) => ({
            agency: r.source_name,
            title: r.title,
            summary: r.summary,
            source_url: r.url
          }));
        const block = formatDeveloperIntelBlock({
          summary: "",
          projects,
          updates,
          fetchedAt: fresh[0]?.last_updated
        });
        if (block) {
          return { block, projects, updates, sources: fresh.map((r) => r.url), cached: true };
        }
      }
    } catch {
      /* live fetch */
    }
  }

  const picks = matchIntelSources(q);
  const pages = [];

  for (const { src, url } of picks) {
    try {
      const markdown = await fetchPageMarkdown(url);
      pages.push({
        url,
        sourceName: src.name,
        sourceType: src.type,
        markdown
      });
    } catch (error) {
      console.error(JSON.stringify({ at: new Date().toISOString(), developerIntelFetchError: error.message, url }));
    }
  }

  if (!pages.length) {
    return { block: "", projects: [], updates: [], sources: [] };
  }

  let extracted;
  try {
    extracted = await Promise.race([
      extractIntelWithGemini(pages, q),
      new Promise((_, rej) => setTimeout(() => rej(new Error("developer intel timeout")), TIMEOUT_MS))
    ]);
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), developerIntelError: error.message }));
    extracted = { projects: [], updates: [], summary: "" };
  }

  for (const p of extracted.projects || []) {
    if (!p.source_url && pages[0]) p.source_url = pages[0].url;
    const page = pages.find((x) => p.source_url && p.source_url.includes(new URL(x.url).hostname));
    if (page && !p.images?.length) {
      p.images = extractImagesFromText(page.markdown).slice(0, 8);
    }
  }

  void persistIntel(pages, extracted);

  const block = formatDeveloperIntelBlock({
    summary: extracted.summary,
    projects: extracted.projects,
    updates: extracted.updates,
    fetchedAt: new Date().toISOString()
  });

  return {
    block,
    projects: extracted.projects || [],
    updates: extracted.updates || [],
    sources: pages.map((p) => p.url),
    cached: false
  };
}
