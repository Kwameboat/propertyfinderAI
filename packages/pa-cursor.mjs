/**
 * Cursor Cloud Agent bridge for the Telegram Personal Assistant.
 *
 * Stores lightweight job metadata on disk so the PA can launch cloud coding
 * tasks, poll them later, and send updates even when the original request
 * happened hours earlier.
 */

import path from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

function jobsFile(baseDir) {
  return path.join(baseDir, "pa", "cursor-jobs.json");
}

function ensureJobsDir(baseDir) {
  mkdirSync(path.join(baseDir, "pa"), { recursive: true });
}

function safeReadJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export function loadCursorJobs(baseDir) {
  ensureJobsDir(baseDir);
  const file = jobsFile(baseDir);
  const data = safeReadJson(file, { nextId: 1, jobs: [] });
  if (!Array.isArray(data.jobs)) data.jobs = [];
  if (!Number.isFinite(data.nextId) || data.nextId < 1) data.nextId = 1;
  return data;
}

export function saveCursorJobs(baseDir, state) {
  ensureJobsDir(baseDir);
  safeWriteJson(jobsFile(baseDir), state);
}

export function listCursorJobs(baseDir, ownerId, { limit = 10 } = {}) {
  const state = loadCursorJobs(baseDir);
  return state.jobs
    .filter((j) => String(j.ownerId) === String(ownerId))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, Math.max(1, Math.min(30, Number(limit) || 10)));
}

export function getCursorJob(baseDir, localId) {
  const state = loadCursorJobs(baseDir);
  return state.jobs.find((j) => Number(j.localId) === Number(localId)) || null;
}

export function upsertCursorJob(baseDir, job) {
  const state = loadCursorJobs(baseDir);
  const idx = state.jobs.findIndex((j) => Number(j.localId) === Number(job.localId));
  if (idx >= 0) state.jobs[idx] = { ...state.jobs[idx], ...job };
  else state.jobs.push(job);
  saveCursorJobs(baseDir, state);
  return job;
}

function nextLocalId(state) {
  const id = state.nextId++;
  return id;
}

async function cursorFetch(apiKey, pathname, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.cursor.com${pathname}`, {
    method,
    headers: {
      Authorization: authHeader(apiKey),
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000)
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Cursor API ${res.status}: ${(text || "").slice(0, 500)}`);
  }
  return json;
}

export async function createCursorCloudJob(baseDir, {
  ownerId,
  chatId,
  prompt,
  apiKey,
  repoUrl,
  startingRef = "master",
  modelId = "composer-2.5",
  autoCreatePR = false
}) {
  const state = loadCursorJobs(baseDir);
  const localId = nextLocalId(state);
  const createdAt = new Date().toISOString();
  const body = {
    prompt: { text: String(prompt || "").trim() },
    model: { id: modelId },
    repos: [{ url: repoUrl, startingRef }],
    autoCreatePR: Boolean(autoCreatePR)
  };
  const response = await cursorFetch(apiKey, "/v1/agents", { method: "POST", body });
  const agent = response.agent || {};
  const run = response.run || {};
  const job = {
    localId,
    ownerId: String(ownerId),
    chatId: String(chatId),
    prompt: String(prompt || "").trim().slice(0, 2000),
    agentId: agent.id || run.agentId || "",
    runId: run.id || agent.latestRunId || "",
    agentUrl: agent.url || "",
    status: run.status || agent.status || "CREATING",
    result: "",
    notifiedTerminal: false,
    createdAt,
    updatedAt: createdAt,
    repoUrl,
    startingRef,
    modelId,
    autoCreatePR: Boolean(autoCreatePR)
  };
  state.jobs.push(job);
  saveCursorJobs(baseDir, state);
  return job;
}

export async function refreshCursorJob(baseDir, apiKey, localId) {
  const state = loadCursorJobs(baseDir);
  const idx = state.jobs.findIndex((j) => Number(j.localId) === Number(localId));
  if (idx < 0) return null;
  const job = state.jobs[idx];
  if (!job.agentId || !job.runId) return job;
  const run = await cursorFetch(apiKey, `/v1/agents/${job.agentId}/runs/${job.runId}`);
  const next = {
    ...job,
    status: run.status || job.status,
    result: String(run.result || job.result || ""),
    git: run.git || job.git || null,
    durationMs: run.durationMs || job.durationMs || null,
    updatedAt: new Date().toISOString()
  };
  state.jobs[idx] = next;
  saveCursorJobs(baseDir, state);
  return next;
}

export function isCursorLaunchIntent(text) {
  const t = String(text || "").trim().toLowerCase();
  return (
    /\b(use cursor to|ask cursor to|tell cursor to|put cursor to work|run a cloud agent to)\b/.test(t) ||
    /\b(work on the codebase|work on jab-hub|work on the repo|fix this in the repo|make this code change)\b/.test(t)
  );
}

export function extractCursorPrompt(text) {
  const raw = String(text || "").trim();
  return raw
    .replace(/\b(use cursor to|ask cursor to|tell cursor to|put cursor to work and|put cursor to work|run a cloud agent to)\b/i, "")
    .replace(/\b(work on the codebase|work on jab-hub|work on the repo)\b[:\s-]*/i, "")
    .trim();
}

export function isCursorStatusIntent(text) {
  const t = String(text || "").toLowerCase();
  return (
    /\b(cursor job status|status of cursor job|what is cursor doing|check cursor job|my cursor jobs|cloud agent status)\b/.test(t) ||
    /^cursor status[!.?]*$/.test(t)
  );
}

export function parseCursorJobId(text) {
  const m = String(text || "").match(/\b(?:job|task)\s*#?(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

export function formatCursorJob(job) {
  const branch = job.git?.branches?.[0]?.branch || "";
  const prUrl = job.git?.branches?.[0]?.prUrl || "";
  return [
    `Cursor job #${job.localId}`,
    `Status: ${job.status}`,
    branch ? `Branch: ${branch}` : null,
    prUrl ? `PR: ${prUrl}` : null,
    job.agentUrl ? `Agent: ${job.agentUrl}` : null,
    job.result ? `Result: ${job.result.slice(0, 1200)}` : null
  ].filter(Boolean).join("\n");
}

export async function pollCursorJobs(baseDir, apiKey) {
  const state = loadCursorJobs(baseDir);
  const changed = [];
  for (let i = 0; i < state.jobs.length; i++) {
    const job = state.jobs[i];
    if (!job.agentId || !job.runId || TERMINAL.has(String(job.status || "").toUpperCase())) continue;
    try {
      const run = await cursorFetch(apiKey, `/v1/agents/${job.agentId}/runs/${job.runId}`);
      const nextStatus = String(run.status || job.status || "");
      const next = {
        ...job,
        status: nextStatus,
        result: String(run.result || job.result || ""),
        git: run.git || job.git || null,
        durationMs: run.durationMs || job.durationMs || null,
        updatedAt: new Date().toISOString()
      };
      const becameTerminal = TERMINAL.has(nextStatus) && !job.notifiedTerminal;
      if (becameTerminal) {
        next.notifiedTerminal = true;
        changed.push(next);
      }
      state.jobs[i] = next;
    } catch {
      /* ignore transient API errors */
    }
  }
  saveCursorJobs(baseDir, state);
  return changed;
}
