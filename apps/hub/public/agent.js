let selectedLeadId = null;

async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    location.href = "/agent-login";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function boot() {
  const me = await api("/api/me");
  if (me.role !== "agent") {
    location.href = "/login";
    return;
  }
  document.getElementById("agent-title").textContent = `${me.agent?.name || "Agent"} · My leads`;
  await loadLeads();
}

async function loadLeads() {
  const data = await api("/api/agent/leads");
  const list = document.getElementById("lead-list");
  list.innerHTML = "";
  const leads = (data.leads || []).filter((l) => l.status !== "closed");
  if (!leads.length) {
    list.innerHTML = `<li class="muted">No open leads yet</li>`;
  }
  for (const lead of leads) {
    const li = document.createElement("li");
    if (lead.id === selectedLeadId) li.classList.add("active");
    li.innerHTML = `<strong>${escapeHtml(lead.contact_name || "Unknown")}</strong>
      <div class="meta">${escapeHtml(lead.contact_phone || "")} · ${lead.status}${lead.qualification_score ? ` · score ${lead.qualification_score}` : ""}</div>`;
    li.addEventListener("click", () => showLead(lead.id));
    list.appendChild(li);
  }
  if (selectedLeadId) await showLead(selectedLeadId);
}

async function showLead(id) {
  selectedLeadId = id;
  const data = await api(`/api/agent/leads/${id}`);
  const lead = data.lead;
  document.getElementById("lead-empty").hidden = true;
  document.getElementById("lead-detail").hidden = false;
  document.getElementById("lead-heading").textContent =
    `${lead.contact?.push_name || "Unknown"} · ${lead.contact?.phone || ""}`;
  const score = Number(lead.contact?.qualification_score) || 0;
  const scoreEl = document.getElementById("lead-score");
  if (scoreEl) {
    if (score) {
      scoreEl.hidden = false;
      scoreEl.innerHTML = `Qualification: <span class="score-badge${score >= 60 ? " hot" : ""}">${score}/100</span>`;
    } else {
      scoreEl.hidden = true;
    }
  }
  const hubLink = document.getElementById("lead-hub-link");
  if (hubLink && lead.instance_name && lead.contact?.phone) {
    const url = `${location.origin}/?tab=inbox&instance=${encodeURIComponent(lead.instance_name)}&phone=${encodeURIComponent(lead.contact.phone)}`;
    hubLink.hidden = false;
    hubLink.innerHTML = `Full chat → <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open Hub Inbox</a>`;
  } else if (hubLink) {
    hubLink.hidden = true;
  }
  document.getElementById("lead-meta").textContent =
    `Status: ${lead.status} · reason: ${lead.reason || "—"} · client: ${lead.instance_name}`;
  const digest =
    lead.contact?.qualification_summary ||
    (lead.summary ? String(lead.summary).split("\n").slice(0, 3).join("\n") : "");
  document.getElementById("lead-summary").textContent =
    digest || "No summary yet — open Hub Inbox for the full thread.";
  document.getElementById("lead-last").textContent = lead.last_customer_message
    ? `Last customer message: ${lead.last_customer_message}`
    : "";

  // Prefill suggested first reply from briefing if present.
  const replyBox = document.querySelector('#reply-form textarea[name="text"]');
  if (replyBox && !replyBox.value) {
    const match = String(lead.summary || "").match(/Suggested first reply:\s*(.+)/i);
    if (match?.[1]) replyBox.value = match[1].trim();
  }
  await loadLeadsActiveOnly();
}

async function loadLeadsActiveOnly() {
  const data = await api("/api/agent/leads");
  const list = document.getElementById("lead-list");
  list.innerHTML = "";
  const leads = (data.leads || []).filter((l) => l.status !== "closed");
  for (const lead of leads) {
    const li = document.createElement("li");
    if (lead.id === selectedLeadId) li.classList.add("active");
    li.innerHTML = `<strong>${escapeHtml(lead.contact_name || "Unknown")}</strong>
      <div class="meta">${escapeHtml(lead.contact_phone || "")} · ${lead.status}${lead.qualification_score ? ` · score ${lead.qualification_score}` : ""}</div>`;
    li.addEventListener("click", () => showLead(lead.id));
    list.appendChild(li);
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.href = "/agent-login";
});

document.getElementById("reply-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedLeadId) return;
  const msg = document.getElementById("reply-msg");
  msg.textContent = "Sending…";
  const text = new FormData(e.target).get("text");
  try {
    await api(`/api/agent/leads/${selectedLeadId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    e.target.reset();
    msg.textContent = "Sent on client business WhatsApp.";
    await showLead(selectedLeadId);
  } catch (error) {
    msg.textContent = error.message;
  }
});

document.getElementById("close-lead").addEventListener("click", async () => {
  if (!selectedLeadId) return;
  await api(`/api/leads/${selectedLeadId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "closed" })
  });
  selectedLeadId = null;
  document.getElementById("lead-detail").hidden = true;
  document.getElementById("lead-empty").hidden = false;
  await loadLeads();
});

boot().catch(() => {
  location.href = "/agent-login";
});

setInterval(() => {
  loadLeads().catch(() => {});
}, 5000);
