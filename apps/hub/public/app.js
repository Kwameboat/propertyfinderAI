let selectedInstance = null;
let contactsCache = [];
let selectedCampaignId = null;
let pollTimer = null;
let publicBase = "http://127.0.0.1:3000";
let clientsCache = [];

const els = {
  clientList: document.getElementById("client-list"),
  contactsBody: document.getElementById("contacts-body"),
  recipientPicker: document.getElementById("recipient-picker"),
  campaignList: document.getElementById("campaign-list"),
  campaignDetail: document.getElementById("campaign-detail"),
  campaignMsg: document.getElementById("campaign-msg"),
  passwordMsg: document.getElementById("password-msg"),
  contactSearch: document.getElementById("contact-search"),
  distributionMode: document.getElementById("distribution-mode"),
  handoffKeywords: document.getElementById("handoff-keywords"),
  clientSystemPrompt: document.getElementById("client-system-prompt"),
  clientAdminPhones: document.getElementById("client-admin-phones"),
  teamSettingsMsg: document.getElementById("team-settings-msg"),
  agentList: document.getElementById("agent-list"),
  unassignedList: document.getElementById("unassigned-list"),
  leadsList: document.getElementById("leads-list"),
  agentMsg: document.getElementById("agent-msg"),
  productList: document.getElementById("product-list"),
  productMsg: document.getElementById("product-msg"),
  productSearch: document.getElementById("product-search"),
  productForm: document.getElementById("product-form")
};

async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function isClientOnline(status) {
  return /open|connect|online|active/i.test(String(status || ""));
}

function relativeTime(ms) {
  if (!ms) return "";
  const diff = Date.now() - Number(ms);
  if (diff < 60_000) return "Now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.hidden = pane.id !== `tab-${name}`;
  });
  const showHero = name === "contacts";
  document.getElementById("hero-stream")?.classList.toggle("is-collapsed", !showHero);
  document.getElementById("quick-actions")?.classList.toggle("is-collapsed", !showHero);
  document.getElementById("ops-banner")?.classList.toggle("is-collapsed", !showHero);
}

function renderActivity() {
  const feed = document.getElementById("activity-feed");
  if (!feed) return;
  const items = (contactsCache || [])
    .filter((c) => c.last_inbound_at || c.last_inbound_text)
    .sort((a, b) => (Number(b.last_inbound_at) || 0) - (Number(a.last_inbound_at) || 0))
    .slice(0, 8);
  if (!items.length) {
    feed.innerHTML = `<li class="empty muted">No recent inbound yet for this client.</li>`;
    return;
  }
  feed.innerHTML = "";
  for (const c of items) {
    const li = document.createElement("li");
    const name = c.push_name || c.phone || "Contact";
    const text = (c.last_inbound_text || "New message").slice(0, 90);
    const fresh = Date.now() - Number(c.last_inbound_at || 0) < 15 * 60_000;
    li.innerHTML = `<div class="act-head"><span>${escapeHtml(name)}</span><span class="act-time">${escapeHtml(relativeTime(c.last_inbound_at))}</span></div>
      <div class="act-body">${escapeHtml(text)}</div>
      ${fresh ? `<span class="act-tag">New Inbound</span>` : ""}`;
    feed.appendChild(li);
  }
}

async function loadClients() {
  const data = await api("/api/clients");
  publicBase = data.publicBase || publicBase;
  clientsCache = data.clients || [];
  els.clientList.innerHTML = "";

  const online = clientsCache.filter((c) => isClientOnline(c.status)).length;
  const badge = document.getElementById("online-badge");
  if (badge) {
    badge.textContent = `${String(online).padStart(2, "0")} ONLINE`;
  }

  if (!clientsCache.length) {
    els.clientList.innerHTML = `<li class="muted">No Evolution instances yet.</li>`;
    return;
  }
  for (const client of clientsCache) {
    const li = document.createElement("li");
    li.dataset.instance = client.instance_name;
    if (client.instance_name === selectedInstance) li.classList.add("active");
    const on = isClientOnline(client.status);
    const typeLabel = {
      store: "Store",
      pa: "PA",
      customer_service: "CS",
      booking: "Booking"
    }[client.agent_type || "store"] || "Store";
    const store =
      (client.agent_type || "store") === "store" && client.store_slug
        ? `<a class="store-link" href="${publicBase}/s/${encodeURIComponent(client.store_slug)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">store/s/${escapeHtml(client.store_slug)}</a>`
        : (client.agent_type || "store") === "store"
          ? `<div class="meta">Inactive · store link pending</div>`
          : `<div class="meta">${escapeHtml(typeLabel)} agent</div>`;
    li.innerHTML = `<div class="client-top"><span class="status-dot ${on ? "on" : ""}"></span><strong>${escapeHtml(client.display_name || client.instance_name)}</strong></div>
      <div class="meta">${escapeHtml(typeLabel)} · ${client.contact_count || 0} contacts · ${client.agent_count || 0} agents</div>
      ${on || (client.agent_type && client.agent_type !== "store") ? store : `<div class="meta">Inactive · ${escapeHtml(client.status || "unknown")}</div>`}`;
    li.addEventListener("click", () => selectClient(client.instance_name));
    els.clientList.appendChild(li);
  }
  if (!selectedInstance && clientsCache[0]) {
    await selectClient(clientsCache[0].instance_name);
  } else if (selectedInstance) {
    renderStoreLinks();
  }
}

function renderStoreLinks() {
  const client = clientsCache.find((c) => c.instance_name === selectedInstance);
  const storeA = document.getElementById("storefront-link");
  const manageA = document.getElementById("manage-link");
  const msg = document.getElementById("store-links-msg");
  if (!client || !storeA || !manageA) return;
  if (client.store_slug && client.store_token) {
    const storeUrl = `${publicBase}/s/${client.store_slug}`;
    const manageUrl = `${publicBase}/manage/${client.store_token}`;
    storeA.href = storeUrl;
    storeA.textContent = storeUrl;
    manageA.href = manageUrl;
    manageA.textContent = manageUrl;
    if (msg) msg.textContent = "";
  } else {
    storeA.href = "#";
    storeA.textContent = "—";
    manageA.href = "#";
    manageA.textContent = "—";
    if (msg) msg.textContent = "Use Onboard or Regenerate to create links.";
  }
}

function syncOnboardTypeFields() {
  const type = document.getElementById("onboard-agent-type")?.value || "store";
  const storeFields = document.getElementById("onboard-store-fields");
  const bookingFields = document.getElementById("onboard-booking-fields");
  if (storeFields) storeFields.hidden = type !== "store";
  if (bookingFields) bookingFields.hidden = type !== "booking";
}

document.getElementById("onboard-agent-type")?.addEventListener("change", syncOnboardTypeFields);
syncOnboardTypeFields();

async function selectClient(instance) {
  selectedInstance = instance;
  document.querySelectorAll("#client-list li").forEach((li) => {
    li.classList.toggle("active", li.dataset.instance === instance);
  });
  renderStoreLinks();
  const form = document.getElementById("onboard-form");
  const client = clientsCache.find((c) => c.instance_name === instance);
  const agencyName = document.getElementById("agency-instance")?.value || "";
  const isAgency = Boolean(agencyName) && instance === agencyName;
  if (form) {
    form.instanceName.value = instance;
    form.displayName.value = client?.display_name || instance;
    form.whatsappOrderNumber.value = client?.whatsapp_order_number || "";
    form.storeTagline.value = client?.store_tagline || "";
    form.contactPhone.value = client?.contact_phone || "";
    form.leadDistribution.value = client?.lead_distribution === "manual" ? "manual" : "auto";
    if (form.agentType) form.agentType.value = client?.agent_type || "store";
    if (form.bookingUrl) form.bookingUrl.value = client?.booking_url || "";
    if (form.systemPrompt) form.systemPrompt.value = client?.system_prompt || "";
    if (form.shopAddress) form.shopAddress.value = client?.shop_address || "";
    if (form.shopLat) form.shopLat.value = client?.shop_lat ?? "";
    if (form.shopLng) form.shopLng.value = client?.shop_lng ?? "";
    syncOnboardTypeFields();
  }
  // Features (Inbox / Knowledge / bookings digest) belong to this client agent only.
  const featureNote = isAgency
    ? "This is the agency WhatsApp channel — client features (KB, inbox, bookings) apply to onboarded agents you select, not the whole system."
    : null;
  for (const id of ["inbox-scope", "knowledge-scope"]) {
    const el = document.getElementById(id);
    if (el && featureNote) el.textContent = featureNote;
  }
  await Promise.all([loadContacts(), loadCampaigns(), loadTeam(), loadProducts()]);
  if (document.querySelector('.tab.active')?.dataset.tab === "finance") {
    await loadFinanceLedger();
  }
  if (document.querySelector('.tab.active')?.dataset.tab === "inbox") {
    await loadInbox();
  }
  if (document.querySelector('.tab.active')?.dataset.tab === "knowledge") {
    await loadKnowledge();
    await loadBookings();
  }
}

async function loadProducts() {
  if (!selectedInstance || !els.productList) return;
  const q = els.productSearch?.value || "";
  const data = await api(
    `/api/clients/${encodeURIComponent(selectedInstance)}/products?q=${encodeURIComponent(q)}`
  );
  els.productList.innerHTML = "";
  const products = data.products || [];
  if (!products.length) {
    els.productList.innerHTML = `<li class="muted">No products yet. Add the first one for this client.</li>`;
    return;
  }
  for (const p of products) {
    const li = document.createElement("li");
    const img = (p.images && p.images[0]) || p.image_path
      ? `<img class="product-thumb" src="/uploads/${encodeURI((p.images && p.images[0]) || p.image_path)}" alt="" />`
      : "";
    const extra =
      p.images && p.images.length > 1
        ? `<div class="meta">${p.images.length} photos</div>`
        : "";
    li.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-start">
      ${img}
      <div style="flex:1">
        <strong>${escapeHtml(p.name)}</strong> ${p.active ? "" : "<span class='muted'>(inactive)</span>"}
        <div class="meta">${escapeHtml(p.currency || "GHS")} ${Number(p.price || 0).toFixed(2)}
          ${p.sku ? ` · ${escapeHtml(p.sku)}` : ""}
          ${p.stock === null || p.stock === undefined ? "" : ` · stock ${p.stock}`}
        </div>
        <div class="meta">${escapeHtml((p.description || "").slice(0, 120))}</div>
        ${extra}
        <div class="toolbar" style="margin-top:8px">
          <button type="button" class="ghost edit-product" data-id="${p.id}">Edit</button>
          <button type="button" class="ghost toggle-product" data-id="${p.id}" data-active="${p.active ? 0 : 1}">
            ${p.active ? "Deactivate" : "Activate"}
          </button>
          <button type="button" class="ghost delete-product" data-id="${p.id}">Delete</button>
        </div>
      </div>
    </div>`;
    els.productList.appendChild(li);
  }
  els.productList._products = products;
}

async function loadPlatformOverview() {
  try {
    const data = await api("/api/platform/overview");
    const line = document.getElementById("platform-agency-line");
    if (line) {
      line.textContent = data.agencyPhone
        ? `Agency line: ${data.agencyPhone} · Instance: ${data.agencyInstance || "—"}`
        : "Set JAB_AGENCY_WA_PHONE in .env or agency contact phone for wa.me links.";
    }
    const list = document.getElementById("platform-tenant-list");
    if (list) {
      list.innerHTML = "";
      const tenants = data.tenants || [];
      if (!tenants.length) {
        list.innerHTML = `<li class="muted">No platform tenants yet — enable under Team for each client.</li>`;
      }
      for (const t of tenants) {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${escapeHtml(t.display_name || t.instance_name)}</strong>
          <div class="meta">${escapeHtml(t.platform_slug || "")}</div>
          ${t.wa_link ? `<div class="meta"><a href="${escapeAttr(t.wa_link)}" target="_blank" rel="noopener">${escapeHtml(t.wa_link)}</a></div>` : ""}`;
        list.appendChild(li);
      }
    }
    window.__platformOverview = data;
    const client = (await api("/api/clients")).clients?.find((c) => c.instance_name === selectedInstance);
    if (client) await refreshPlatformWaLink(client);
  } catch (error) {
    const line = document.getElementById("platform-agency-line");
    if (line) line.textContent = error.message || "Could not load platform overview.";
  }
}

async function refreshPlatformWaLink(client) {
  const linkEl = document.getElementById("platform-wa-link");
  const hint = document.getElementById("platform-wa-hint");
  if (!linkEl || !client) return;
  const overview = window.__platformOverview;
  if (!client.platform_whatsapp_enabled) {
    linkEl.value = "";
    if (hint) hint.textContent = "Enable platform tenant to generate a customer wa.me link.";
    return;
  }
  const slug = String(client.platform_slug || client.store_slug || "").trim();
  const agencyPhone = String(overview?.agencyPhone || "").replace(/\D/g, "");
  if (!agencyPhone) {
    linkEl.value = "";
    if (hint) hint.textContent = "Configure agency WhatsApp phone (Finance / .env JAB_AGENCY_WA_PHONE).";
    return;
  }
  const name = client.display_name || client.instance_name || slug;
  const text = slug ? `Hi ${name} ref:${slug}` : `Hi ${name}`;
  linkEl.value = `https://wa.me/${agencyPhone}?text=${encodeURIComponent(text)}`;
  if (hint) hint.textContent = "Share this link in ads — opens agency line with shop context.";
}

async function loadTeam() {
  if (!selectedInstance) return;
  const clients = await api("/api/clients");
  const client = (clients.clients || []).find((c) => c.instance_name === selectedInstance);
  if (client) {
    els.distributionMode.value = client.lead_distribution === "manual" ? "manual" : "auto";
    els.handoffKeywords.value =
      client.handoff_keywords ||
      "human,agent,speak to someone,talk to someone,call me,representative";
    if (els.clientSystemPrompt) els.clientSystemPrompt.value = client.system_prompt || "";
    if (els.clientAdminPhones) els.clientAdminPhones.value = client.admin_phones || "";
    const digestEn = document.getElementById("digest-enabled");
    const digestHour = document.getElementById("digest-hour");
    const ownerPhone = document.getElementById("owner-notify-phone");
    if (digestEn) digestEn.checked = Boolean(client.digest_enabled);
    if (digestHour) digestHour.value = client.digest_hour != null ? client.digest_hour : 8;
    if (ownerPhone) ownerPhone.value = client.owner_notify_phone || "";
    const notifyMode = document.getElementById("client-notify-mode");
    const scoreThr = document.getElementById("client-score-threshold");
    const opsChannel = document.getElementById("client-ops-channel");
    if (notifyMode) notifyMode.value = client.client_notify_mode || "digest";
    if (scoreThr) scoreThr.value = client.client_score_notify_threshold ?? 60;
    if (opsChannel) opsChannel.value = client.client_ops_channel || "whatsapp";
    const platEn = document.getElementById("platform-whatsapp-enabled");
    const platSlug = document.getElementById("platform-slug");
    if (platEn) platEn.checked = Boolean(client.platform_whatsapp_enabled);
    if (platSlug) platSlug.value = client.platform_slug || client.store_slug || "";
    await refreshPlatformWaLink(client);
  }

  const agentsData = await api(`/api/clients/${encodeURIComponent(selectedInstance)}/agents`);
  const agents = agentsData.agents || [];
  els.agentList.innerHTML = "";
  for (const a of agents) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(a.name)}</strong>
      <div class="meta">${escapeHtml(a.phone)} · login ${escapeHtml(a.login)} · ${a.active ? "active" : "inactive"}</div>
      <div class="toolbar" style="margin-top:8px">
        <button type="button" class="ghost toggle-agent" data-id="${a.id}" data-active="${a.active ? 0 : 1}">
          ${a.active ? "Deactivate" : "Activate"}
        </button>
      </div>`;
    els.agentList.appendChild(li);
  }

  const leadsData = await api(`/api/clients/${encodeURIComponent(selectedInstance)}/leads`);
  const leads = leadsData.leads || [];
  const unassigned = leads.filter((l) => l.status === "unassigned");
  els.unassignedList.innerHTML = "";
  if (!unassigned.length) {
    els.unassignedList.innerHTML = `<li class="muted">No unassigned leads</li>`;
  }
  for (const lead of unassigned) {
    const li = document.createElement("li");
    const options = agents
      .filter((a) => a.active)
      .map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
      .join("");
    li.innerHTML = `<strong>${escapeHtml(lead.contact_name || "Unknown")} · ${escapeHtml(lead.contact_phone || "")}</strong>
      <div class="meta">${escapeHtml(lead.reason || "")} · ${escapeHtml((lead.summary || lead.last_customer_message || "").slice(0, 80))}</div>
      <div class="toolbar" style="margin-top:8px">
        <select data-lead="${lead.id}" class="assign-select">${options || "<option value=''>No agents</option>"}</select>
        <button type="button" class="assign-btn" data-lead="${lead.id}">Assign</button>
      </div>`;
    els.unassignedList.appendChild(li);
  }

  els.leadsList.innerHTML = "";
  for (const lead of leads.slice(0, 20)) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>#${lead.id} ${escapeHtml(lead.contact_name || "")} · ${escapeHtml(lead.contact_phone || "")}</strong>
      <div class="meta">${lead.status} · ${escapeHtml(lead.agent_name || "unassigned")} · ${escapeHtml(lead.reason || "")}</div>`;
    els.leadsList.appendChild(li);
  }
}

async function loadContacts() {
  if (!selectedInstance) return;
  const q = els.contactSearch.value || "";
  const data = await api(`/api/clients/${encodeURIComponent(selectedInstance)}/contacts?q=${encodeURIComponent(q)}`);
  contactsCache = data.contacts || [];
  renderContacts();
  renderRecipientPicker();
  renderActivity();
}

function renderContacts() {
  els.contactsBody.innerHTML = "";
  for (const c of contactsCache) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.push_name || "—")}</td>
      <td>${escapeHtml(c.phone)}</td>
      <td>${fmtTime(c.last_inbound_at)}</td>
      <td><input type="text" data-id="${c.id}" class="note-input" value="${escapeAttr(c.notes || "")}" /></td>
      <td><input type="checkbox" data-id="${c.id}" class="optout-input" ${c.opted_out ? "checked" : ""} /></td>
    `;
    els.contactsBody.appendChild(tr);
  }
}

function renderRecipientPicker() {
  els.recipientPicker.innerHTML = "";
  for (const c of contactsCache.filter((x) => !x.opted_out)) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" name="recipient" value="${c.id}" />
      <span>${escapeHtml(c.push_name || "Unknown")} · ${escapeHtml(c.phone)}</span>`;
    els.recipientPicker.appendChild(label);
  }
}

async function loadCampaigns() {
  if (!selectedInstance) return;
  const data = await api(`/api/clients/${encodeURIComponent(selectedInstance)}/campaigns`);
  els.campaignList.innerHTML = "";
  for (const c of data.campaigns || []) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(c.name)}</strong>
      <div class="meta">${c.status} · ${c.sent_count || 0}/${c.recipient_count || 0} sent</div>`;
    li.addEventListener("click", () => showCampaign(c.id));
    els.campaignList.appendChild(li);
  }
  if (selectedCampaignId) await showCampaign(selectedCampaignId);
}

async function showCampaign(id) {
  selectedCampaignId = id;
  const data = await api(`/api/campaigns/${id}`);
  const c = data.campaign;
  const total = c.stats.total || 1;
  const done = c.stats.sent + c.stats.failed + c.stats.skipped;
  const pct = Math.round((done / total) * 100);
  els.campaignDetail.hidden = false;
  els.campaignDetail.innerHTML = `
    <h3>${escapeHtml(c.name)}</h3>
    <p class="muted">Status: <strong>${c.status}</strong> · delay ${c.delay_ms}ms</p>
    <div class="progress"><span style="width:${pct}%"></span></div>
    <p>${c.stats.sent} sent · ${c.stats.failed} failed · ${c.stats.pending} pending · ${c.stats.skipped} skipped</p>
    <p class="muted">Parts: ${(c.parts || []).map((p) => p.type).join(" → ") || "none"}</p>
    <div class="toolbar">
      <button type="button" id="start-campaign">Start / Resume</button>
      <button type="button" id="pause-campaign" class="ghost">Pause</button>
    </div>
  `;
  document.getElementById("start-campaign").onclick = async () => {
    await api(`/api/campaigns/${id}/start`, { method: "POST" });
    await showCampaign(id);
    await loadCampaigns();
  };
  document.getElementById("pause-campaign").onclick = async () => {
    await api(`/api/campaigns/${id}/pause`, { method: "POST" });
    await showCampaign(id);
    await loadCampaigns();
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    setTab(btn.dataset.tab);
    if (btn.dataset.tab === "finance") loadFinance().catch(console.error);
    if (btn.dataset.tab === "social") loadSocial().catch(console.error);
    if (btn.dataset.tab === "inbox") loadInbox().catch(console.error);
    if (btn.dataset.tab === "knowledge") {
      loadKnowledge().catch(console.error);
      loadBookings().catch(console.error);
    }
  });
});

document.querySelectorAll(".action-card[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.goto;
    setTab(tab);
    if (tab === "finance") loadFinance().catch(console.error);
  });
});

document.getElementById("refresh-clients")?.addEventListener("click", () => loadClients());
document.getElementById("logout-btn")?.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.href = "/login";
});

// Subtle live latency flicker for the hero meter
setInterval(() => {
  const el = document.getElementById("latency-label");
  if (!el || document.getElementById("hero-stream")?.classList.contains("is-collapsed")) return;
  el.textContent = `${18 + Math.floor(Math.random() * 14)}ms`;
}, 3200);

els.contactSearch.addEventListener("input", () => {
  clearTimeout(els.contactSearch._t);
  els.contactSearch._t = setTimeout(loadContacts, 250);
});

document.getElementById("add-contact-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedInstance) return;
  const fd = new FormData(e.target);
  await api(`/api/clients/${encodeURIComponent(selectedInstance)}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: fd.get("phone"),
      pushName: fd.get("pushName")
    })
  });
  e.target.reset();
  await loadContacts();
  await loadClients();
});

els.contactsBody.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.classList.contains("note-input")) {
    await api(`/api/contacts/${t.dataset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: t.value })
    });
  }
  if (t.classList.contains("optout-input")) {
    await api(`/api/contacts/${t.dataset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optedOut: t.checked })
    });
    await loadContacts();
  }
});

document.getElementById("select-all-contacts").addEventListener("click", () => {
  els.recipientPicker.querySelectorAll('input[name="recipient"]').forEach((el) => {
    el.checked = true;
  });
});

document.getElementById("clear-contact-selection").addEventListener("click", () => {
  els.recipientPicker.querySelectorAll('input[name="recipient"]').forEach((el) => {
    el.checked = false;
  });
});

document.getElementById("campaign-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedInstance) return;
  els.campaignMsg.textContent = "Creating…";
  const form = e.target;
  const fd = new FormData(form);
  const contactIds = [...els.recipientPicker.querySelectorAll('input[name="recipient"]:checked')].map(
    (el) => Number(el.value)
  );
  fd.set("contactIds", JSON.stringify(contactIds));
  try {
    const res = await fetch(`/api/clients/${encodeURIComponent(selectedInstance)}/campaigns`, {
      method: "POST",
      body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Create failed");
    els.campaignMsg.textContent = data.warning || "Campaign created. Open it and press Start.";
    form.reset();
    selectedCampaignId = data.campaign.id;
    await loadCampaigns();
    await showCampaign(data.campaign.id);
  } catch (error) {
    els.campaignMsg.textContent = error.message;
  }
});

document.getElementById("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  els.passwordMsg.textContent = "Updating…";
  try {
    await api("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: fd.get("currentPassword"),
        newPassword: fd.get("newPassword")
      })
    });
    els.passwordMsg.textContent = "Password updated. Please sign in again.";
    setTimeout(() => {
      location.href = "/login";
    }, 800);
  } catch (error) {
    els.passwordMsg.textContent = error.message;
  }
});

document.getElementById("save-team-settings").addEventListener("click", async () => {
  if (!selectedInstance) return;
  els.teamSettingsMsg.textContent = "Saving…";
  try {
    const platformEnabled = document.getElementById("platform-whatsapp-enabled")?.checked;
    const platformSlug = String(document.getElementById("platform-slug")?.value || "").trim();
    if (platformEnabled && platformSlug) {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(platformSlug.toLowerCase())) {
        els.teamSettingsMsg.textContent =
          "Platform slug: lowercase letters, numbers, hyphens only (2–48 chars).";
        return;
      }
    }
    await api(`/api/clients/${encodeURIComponent(selectedInstance)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadDistribution: els.distributionMode.value,
        handoffKeywords: els.handoffKeywords.value,
        systemPrompt: els.clientSystemPrompt ? els.clientSystemPrompt.value : undefined,
        adminPhones: els.clientAdminPhones ? els.clientAdminPhones.value : undefined,
        digestEnabled: document.getElementById("digest-enabled")?.checked,
        digestHour: document.getElementById("digest-hour")?.value,
        ownerNotifyPhone: document.getElementById("owner-notify-phone")?.value,
        clientNotifyMode: document.getElementById("client-notify-mode")?.value,
        clientScoreNotifyThreshold: document.getElementById("client-score-threshold")?.value,
        clientOpsChannel: document.getElementById("client-ops-channel")?.value,
        platformWhatsappEnabled: document.getElementById("platform-whatsapp-enabled")?.checked,
        platformSlug: document.getElementById("platform-slug")?.value
      })
    });
    els.teamSettingsMsg.textContent = "Saved.";
    await loadClients();
    await loadPlatformOverview();
  } catch (error) {
    els.teamSettingsMsg.textContent = error.message;
  }
});

document.getElementById("add-agent-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedInstance) return;
  const fd = new FormData(e.target);
  els.agentMsg.textContent = "Adding…";
  try {
    await api(`/api/clients/${encodeURIComponent(selectedInstance)}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        phone: fd.get("phone"),
        login: fd.get("login"),
        password: fd.get("password")
      })
    });
    e.target.reset();
    els.agentMsg.textContent = "Agent added.";
    await loadTeam();
    await loadClients();
  } catch (error) {
    els.agentMsg.textContent = error.message;
  }
});

els.agentList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".toggle-agent");
  if (!btn) return;
  await api(`/api/agents/${btn.dataset.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: btn.dataset.active === "1" })
  });
  await loadTeam();
});

els.unassignedList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".assign-btn");
  if (!btn) return;
  const leadId = btn.dataset.lead;
  const select = els.unassignedList.querySelector(`select.assign-select[data-lead="${leadId}"]`);
  const agentId = Number(select?.value);
  if (!agentId) return;
  await api(`/api/leads/${leadId}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId })
  });
  await loadTeam();
});

els.productSearch?.addEventListener("input", () => {
  clearTimeout(els.productSearch._t);
  els.productSearch._t = setTimeout(loadProducts, 250);
});

document.getElementById("reset-product-form")?.addEventListener("click", () => {
  els.productForm.reset();
  els.productForm.productId.value = "";
  els.productForm.active.checked = true;
  els.productMsg.textContent = "";
});

els.productForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedInstance) return;
  els.productMsg.textContent = "Saving…";
  const fd = new FormData(els.productForm);
  fd.set("active", els.productForm.active.checked ? "1" : "0");
  const productId = String(fd.get("productId") || "").trim();
  try {
    if (productId) {
      const res = await fetch(`/api/products/${productId}`, { method: "PATCH", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
    } else {
      const res = await fetch(`/api/clients/${encodeURIComponent(selectedInstance)}/products`, {
        method: "POST",
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
    }
    els.productForm.reset();
    els.productForm.productId.value = "";
    els.productForm.active.checked = true;
    els.productMsg.textContent = "Saved.";
    await loadProducts();
  } catch (error) {
    els.productMsg.textContent = error.message;
  }
});

els.productList?.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".edit-product");
  const toggleBtn = e.target.closest(".toggle-product");
  const deleteBtn = e.target.closest(".delete-product");
  if (editBtn) {
    const product = (els.productList._products || []).find((p) => String(p.id) === editBtn.dataset.id);
    if (!product) return;
    els.productForm.productId.value = product.id;
    els.productForm.name.value = product.name || "";
    els.productForm.sku.value = product.sku || "";
    els.productForm.description.value = product.description || "";
    els.productForm.price.value = product.price ?? 0;
    els.productForm.currency.value = product.currency || "GHS";
    els.productForm.stock.value = product.stock ?? "";
    els.productForm.active.checked = Boolean(product.active);
    els.productMsg.textContent = `Editing #${product.id}`;
    return;
  }
  if (toggleBtn) {
    const fd = new FormData();
    fd.set("active", toggleBtn.dataset.active);
    await fetch(`/api/products/${toggleBtn.dataset.id}`, { method: "PATCH", body: fd });
    await loadProducts();
    return;
  }
  if (deleteBtn) {
    if (!confirm("Delete this product?")) return;
    await api(`/api/products/${deleteBtn.dataset.id}`, { method: "DELETE" });
    await loadProducts();
  }
});

document.getElementById("onboard-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const result = document.getElementById("onboard-result");
  const agentType = String(fd.get("agentType") || "store");
  result.hidden = false;
  result.innerHTML = "Creating…";
  try {
    const data = await api("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentType,
        displayName: fd.get("displayName"),
        instanceName: fd.get("instanceName"),
        whatsappOrderNumber: fd.get("whatsappOrderNumber"),
        storeTagline: fd.get("storeTagline"),
        shopAddress: fd.get("shopAddress"),
        shopLat: fd.get("shopLat") || null,
        shopLng: fd.get("shopLng") || null,
        bookingUrl: fd.get("bookingUrl"),
        systemPrompt: fd.get("systemPrompt"),
        contactPhone: fd.get("contactPhone"),
        leadDistribution: fd.get("leadDistribution")
      })
    });
    const typeLabel = {
      store: "Store",
      pa: "Personal Assistant",
      customer_service: "Customer Service",
      booking: "Booking"
    }[data.agentType || data.client.agent_type || "store"] || "Store";

    let linksHtml = "";
    if (data.links?.storefront && data.links?.manage) {
      const shopNote = data.client.shop_address
        ? `<p class="muted">Shop for Yango quotes: ${escapeHtml(data.client.shop_address)}${
            data.client.shop_lat != null ? ` (${data.client.shop_lat}, ${data.client.shop_lng})` : ""
          }</p>`
        : `<p class="muted">Tip: set shop address so the AI can quote Yango delivery fees.</p>`;
      linksHtml = `
        <p><strong>Storefront (public):</strong><br><a href="${data.links.storefront}" target="_blank" rel="noopener" style="color:var(--accent-2)">${data.links.storefront}</a></p>
        <p><strong>Manage link (give to client):</strong><br><a href="${data.links.manage}" target="_blank" rel="noopener" style="color:var(--accent-2)">${data.links.manage}</a></p>
        ${shopNote}
        <p class="muted">Client uses the manage link to add products and update stock — no agency password needed.</p>
      `;
    } else {
      linksHtml = `
        <p class="muted">No storefront for this type. WhatsApp replies use the seeded AI persona — tweak it anytime under Team.</p>
        ${
          data.client.booking_url
            ? `<p><strong>Booking URL:</strong> <a href="${escapeHtml(data.client.booking_url)}" target="_blank" rel="noopener">${escapeHtml(data.client.booking_url)}</a></p>`
            : ""
        }
      `;
    }

    result.innerHTML = `
      <p><strong>Onboarded:</strong> ${escapeHtml(data.client.display_name)} <span class="muted">(${escapeHtml(typeLabel)})</span></p>
      <p><strong>Instance:</strong> ${escapeHtml(data.client.instance_name)}</p>
      ${linksHtml}
    `;
    selectedInstance = data.client.instance_name;
    await loadClients();
  } catch (error) {
    result.textContent = error.message;
  }
});

document.getElementById("copy-manage-link")?.addEventListener("click", async () => {
  const href = document.getElementById("manage-link")?.href;
  const msg = document.getElementById("store-links-msg");
  if (!href || href.endsWith("#")) {
    if (msg) msg.textContent = "No manage link yet.";
    return;
  }
  await navigator.clipboard.writeText(href);
  if (msg) msg.textContent = "Manage link copied.";
});

document.getElementById("regen-manage-link")?.addEventListener("click", async () => {
  if (!selectedInstance) return;
  const msg = document.getElementById("store-links-msg");
  if (msg) msg.textContent = "Regenerating…";
  const client = clientsCache.find((c) => c.instance_name === selectedInstance);
  await api(`/api/clients/${encodeURIComponent(selectedInstance)}/store-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: client?.display_name,
      storeTagline: client?.store_tagline,
      whatsappOrderNumber: client?.whatsapp_order_number,
      regenerateToken: true
    })
  });
  await loadClients();
  if (msg) msg.textContent = "New manage link created. Old link stops working.";
});

pollTimer = setInterval(async () => {
  if (!selectedInstance) return;
  try {
    await loadCampaigns();
  } catch {
    // ignore transient poll errors
  }
}, 4000);

let financeCache = null;

async function loadFinance() {
  const data = await api("/api/billing/overview");
  financeCache = data;
  const status = document.getElementById("paystack-status");
  if (status) {
    status.textContent = data.paystackConfigured
      ? `Paystack: configured (${data.paystackPublicKey || "secret set"})`
      : "Paystack: NOT configured — set PAYSTACK_SECRET_KEY + PAYSTACK_PUBLIC_KEY in .env on the server";
  }
  const webhook = document.getElementById("paystack-webhook-url");
  if (webhook) webhook.value = data.paystackWebhookUrl || "";
  const callback = document.getElementById("paystack-callback-url");
  if (callback) callback.value = data.paystackCallbackUrl || "";

  const agencySel = document.getElementById("agency-instance");
  if (agencySel) {
    agencySel.innerHTML = `<option value="">— none —</option>`;
    for (const c of clientsCache) {
      const opt = document.createElement("option");
      opt.value = c.instance_name;
      opt.textContent = c.display_name || c.instance_name;
      agencySel.appendChild(opt);
    }
    agencySel.value = data.settings?.agency_instance_name || data.agencyInstance || "";
  }
  const thr = document.getElementById("low-balance-threshold");
  if (thr) thr.value = data.settings?.low_balance_threshold ?? 50;
  const nLow = document.getElementById("notify-low-balance");
  if (nLow) nLow.checked = Boolean(data.settings?.notify_low_balance);
  const nPay = document.getElementById("notify-payment");
  if (nPay) nPay.checked = Boolean(data.settings?.notify_payment);
  const signupBonus = document.getElementById("signup-bonus-points");
  if (signupBonus) signupBonus.value = data.settings?.signup_bonus_points ?? 100;
  const notifyMode = document.getElementById("agency-notify-mode");
  if (notifyMode) notifyMode.value = data.settings?.agency_notify_mode || "digest";
  const opsChannel = document.getElementById("agency-ops-channel");
  if (opsChannel) opsChannel.value = data.settings?.agency_ops_channel || "both";
  const digestHubUrl = document.getElementById("agency-digest-hub-url");
  if (digestHubUrl) digestHubUrl.checked = Boolean(Number(data.settings?.agency_digest_include_hub_url));
  const tgStatus = document.getElementById("telegram-ops-status");
  if (tgStatus) {
    tgStatus.textContent = data.telegramOpsConfigured
      ? "Telegram ops: configured"
      : "Telegram ops: set TELEGRAM_BOT_TOKEN + TELEGRAM_OPS_CHAT_IDS in server .env";
  }
  const scoreThr = document.getElementById("agency-score-threshold");
  if (scoreThr) scoreThr.value = data.settings?.agency_score_notify_threshold ?? 60;
  await loadPlatformOverview();

  const form = document.getElementById("rates-form");
  if (form && data.rates) {
    for (const [k, v] of Object.entries(data.rates)) {
      if (form[k]) form[k].value = v;
    }
  }

  const pkgList = document.getElementById("package-list");
  const pkgSelect = document.getElementById("wallet-package");
  if (pkgList) {
    pkgList.innerHTML = "";
    for (const p of data.packages || []) {
      const li = document.createElement("li");
      const total = Number(p.points || 0) + Number(p.bonus_points || 0);
      const kind = Number(p.is_topup) ? "top-up" : "plan";
      const days = Number(p.duration_days) || 30;
      li.innerHTML = `<strong>${escapeHtml(p.name)}</strong>
        <div class="meta">${kind} · GHS ${Number(p.price_ghs).toFixed(2)} → ${total} pts${p.bonus_points ? ` (incl. +${p.bonus_points} bonus)` : ""} · ${days}d · ${p.active ? "active" : "off"}</div>
        <div class="row-actions">
          <button type="button" class="ghost" data-edit-pkg="${p.id}">Edit</button>
          <button type="button" class="ghost" data-del-pkg="${p.id}">Delete</button>
        </div>`;
      pkgList.appendChild(li);
    }
  }
  if (pkgSelect) {
    pkgSelect.innerHTML = "";
    for (const p of (data.packages || []).filter((x) => x.active)) {
      const opt = document.createElement("option");
      opt.value = p.id;
      const kind = Number(p.is_topup) ? "top-up" : "plan";
      opt.textContent = `${p.name} · ${kind} (GHS ${Number(p.price_ghs).toFixed(0)})`;
      pkgSelect.appendChild(opt);
    }
  }

  const walletList = document.getElementById("wallet-list");
  if (walletList) {
    walletList.innerHTML = "";
    const rows = data.wallets || [];
    if (!rows.length) {
      walletList.innerHTML = `<li class="muted">No wallets yet — they appear after first credit or AI use.</li>`;
    }
    for (const w of rows) {
      const li = document.createElement("li");
      const ends = w.period_ends_at ? new Date(Number(w.period_ends_at)).toLocaleDateString() : "no period";
      li.innerHTML = `<strong>${escapeHtml(w.display_name || w.instance_name)}</strong>
        <div class="meta">${w.balance_points} points · expires ${ends} · ${w.contact_phone || "no owner phone"}</div>`;
      li.style.cursor = "pointer";
      li.addEventListener("click", () => selectClient(w.instance_name));
      walletList.appendChild(li);
    }
  }

  const payList = document.getElementById("payments-list");
  if (payList) {
    payList.innerHTML = "";
    for (const p of data.payments || []) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(p.display_name || p.instance_name)}</strong>
        <div class="meta">${p.status} · GHS ${Number(p.amount_ghs).toFixed(2)} · ${p.points} pts · ${escapeHtml(p.package_name || "—")} · ${escapeHtml(p.reference)}</div>`;
      payList.appendChild(li);
    }
  }

  await loadFinanceLedger();
}

async function loadFinanceLedger() {
  const list = document.getElementById("ledger-list");
  if (!list || !selectedInstance) return;
  const data = await api(`/api/billing/wallets/${encodeURIComponent(selectedInstance)}`);
  list.innerHTML = "";
  const bal = data.wallet?.balance_points ?? 0;
  const ends = data.wallet?.period_ends_at
    ? new Date(Number(data.wallet.period_ends_at)).toLocaleString()
    : "none";
  list.innerHTML = `<li class="muted"><strong>${escapeHtml(selectedInstance)}</strong> balance: ${bal} · period ends: ${escapeHtml(ends)}</li>`;
  for (const e of data.ledger || []) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="meta">${e.direction} ${e.amount} · ${escapeHtml(e.reason)} · bal ${e.balance_after}${e.note ? ` · ${escapeHtml(e.note)}` : ""}</div>`;
    list.appendChild(li);
  }
}

document.getElementById("save-billing-settings")?.addEventListener("click", async () => {
  const msg = document.getElementById("billing-settings-msg");
  try {
    await api("/api/billing/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agencyInstanceName: document.getElementById("agency-instance")?.value || "",
        lowBalanceThreshold: Number(document.getElementById("low-balance-threshold")?.value || 50),
        notifyLowBalance: document.getElementById("notify-low-balance")?.checked,
        notifyPayment: document.getElementById("notify-payment")?.checked,
        signupBonusPoints: Number(document.getElementById("signup-bonus-points")?.value || 0),
        agencyNotifyMode: document.getElementById("agency-notify-mode")?.value || "digest",
        agencyOpsChannel: document.getElementById("agency-ops-channel")?.value || "both",
        agencyDigestIncludeHubUrl: Boolean(document.getElementById("agency-digest-hub-url")?.checked),
        agencyScoreNotifyThreshold: Number(document.getElementById("agency-score-threshold")?.value || 60)
      })
    });
    if (msg) msg.textContent = "Saved.";
    await loadFinance();
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
});

document.getElementById("rates-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("rates-msg");
  const fd = new FormData(e.target);
  const rates = {};
  for (const [k, v] of fd.entries()) rates[k] = Number(v);
  try {
    await api("/api/billing/rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rates })
    });
    if (msg) msg.textContent = "Rates saved.";
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
});

document.getElementById("package-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById("package-msg");
  const id = String(form.packageId.value || "").trim();
  const body = {
    name: form.name.value,
    priceGhs: Number(form.priceGhs.value),
    points: Number(form.points.value),
    bonusPoints: Number(form.bonusPoints.value || 0),
    durationDays: Number(form.durationDays?.value || 30),
    isTopup: Boolean(form.isTopup?.checked),
    active: form.active.checked
  };
  try {
    if (id) {
      await api(`/api/billing/packages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } else {
      await api("/api/billing/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    }
    form.reset();
    form.packageId.value = "";
    form.active.checked = true;
    form.durationDays.value = 30;
    if (form.isTopup) form.isTopup.checked = false;
    if (msg) msg.textContent = "Package saved.";
    await loadFinance();
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
});

document.getElementById("clear-package-form")?.addEventListener("click", () => {
  const form = document.getElementById("package-form");
  if (!form) return;
  form.reset();
  form.packageId.value = "";
  form.active.checked = true;
  form.durationDays.value = 30;
  if (form.isTopup) form.isTopup.checked = false;
});

document.getElementById("new-topup-package")?.addEventListener("click", () => {
  const form = document.getElementById("package-form");
  if (!form) return;
  form.reset();
  form.packageId.value = "";
  form.active.checked = true;
  form.durationDays.value = 30;
  form.isTopup.checked = true;
  form.name.placeholder = "e.g. Top-up 500";
  form.name.focus();
});

document.getElementById("package-list")?.addEventListener("click", async (e) => {
  const editId = e.target.dataset.editPkg;
  const delId = e.target.dataset.delPkg;
  if (editId && financeCache) {
    const p = financeCache.packages.find((x) => String(x.id) === editId);
    if (!p) return;
    const form = document.getElementById("package-form");
    form.packageId.value = p.id;
    form.name.value = p.name;
    form.priceGhs.value = p.price_ghs;
    form.points.value = p.points;
    form.bonusPoints.value = p.bonus_points || 0;
    form.durationDays.value = p.duration_days || 30;
    form.isTopup.checked = Boolean(Number(p.is_topup));
    form.active.checked = Boolean(p.active);
    return;
  }
  if (delId) {
    if (!confirm("Delete this package?")) return;
    await api(`/api/billing/packages/${delId}`, { method: "DELETE" });
    await loadFinance();
  }
});

document.getElementById("wallet-adjust-btn")?.addEventListener("click", async () => {
  const msg = document.getElementById("wallet-msg");
  if (!selectedInstance) {
    if (msg) msg.textContent = "Select a client first.";
    return;
  }
  try {
    await api(`/api/billing/wallets/${encodeURIComponent(selectedInstance)}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction: document.getElementById("wallet-adjust-dir")?.value || "credit",
        amount: Number(document.getElementById("wallet-adjust-amount")?.value || 0),
        note: document.getElementById("wallet-adjust-note")?.value || ""
      })
    });
    if (msg) msg.textContent = "Wallet updated.";
    await loadFinance();
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
});

document.getElementById("wallet-topup-btn")?.addEventListener("click", async () => {
  const msg = document.getElementById("wallet-msg");
  if (!selectedInstance) {
    if (msg) msg.textContent = "Select a client first.";
    return;
  }
  try {
    const data = await api("/api/billing/paystack/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instanceName: selectedInstance,
        packageId: Number(document.getElementById("wallet-package")?.value || 0) || null,
        notifyWhatsApp: true
      })
    });
    if (msg) {
      msg.innerHTML = `Payment link ready: <a href="${escapeAttr(data.authorizationUrl)}" target="_blank" rel="noopener">${escapeHtml(data.authorizationUrl)}</a>`;
    }
    await loadFinance();
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
});

document.getElementById("wallet-custom-topup-btn")?.addEventListener("click", async () => {
  const msg = document.getElementById("wallet-msg");
  if (!selectedInstance) {
    if (msg) msg.textContent = "Select a client first.";
    return;
  }
  const priceGhs = Number(document.getElementById("custom-topup-ghs")?.value || 0);
  const points = Number(document.getElementById("custom-topup-points")?.value || 0);
  const name = String(document.getElementById("custom-topup-name")?.value || "").trim();
  const saveAsPackage = Boolean(document.getElementById("custom-topup-save")?.checked);
  if (!(priceGhs > 0) || !(points > 0)) {
    if (msg) msg.textContent = "Enter custom GHS price and points.";
    return;
  }
  try {
    const data = await api("/api/billing/paystack/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instanceName: selectedInstance,
        custom: {
          priceGhs,
          points,
          name: name || undefined,
          saveAsPackage,
          isTopup: true
        },
        notifyWhatsApp: true
      })
    });
    if (msg) {
      const saved = data.package ? ` Saved as package “${escapeHtml(data.package.name)}”.` : "";
      msg.innerHTML = `Custom top-up link ready:${saved} <a href="${escapeAttr(data.authorizationUrl)}" target="_blank" rel="noopener">${escapeHtml(data.authorizationUrl)}</a>`;
    }
    document.getElementById("custom-topup-ghs").value = "";
    document.getElementById("custom-topup-points").value = "";
    document.getElementById("custom-topup-name").value = "";
    document.getElementById("custom-topup-save").checked = false;
    await loadFinance();
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
});

let inboxSelectedPhone = null;

function scoreBadgeHtml(score) {
  const n = Math.round(Number(score) || 0);
  if (!n) return "";
  const hot = n >= 60 ? " hot" : "";
  return `<span class="score-badge${hot}" title="Qualification score">${n}</span>`;
}

async function loadInbox() {
  if (!selectedInstance) return;
  const scope = document.getElementById("inbox-scope");
  const client = clientsCache.find((c) => c.instance_name === selectedInstance);
  if (scope) {
    scope.textContent = `Client: ${client?.display_name || selectedInstance} · type ${client?.agent_type || "store"}`;
  }
  const data = await api(`/api/clients/${encodeURIComponent(selectedInstance)}/inbox`);
  const list = document.getElementById("inbox-thread-list");
  if (!list) return;
  list.innerHTML = "";
  const threads = data.threads || [];
  if (!threads.length) {
    list.innerHTML = `<li class="muted">No conversations yet. Messages appear after WhatsApp traffic.</li>`;
    return;
  }
  for (const t of threads) {
    const li = document.createElement("li");
    if (t.phone === inboxSelectedPhone) li.classList.add("active");
    li.innerHTML = `<strong>${escapeHtml(t.push_name || t.phone)} ${scoreBadgeHtml(t.qualification_score)}</strong>
      <div class="meta">${escapeHtml(t.handoff_status || "ai")} · ${escapeHtml((t.last_body || t.last_inbound_text || "").slice(0, 60))}${t.qualification_summary ? ` · ${escapeHtml(String(t.qualification_summary).slice(0, 50))}` : ""}</div>`;
    li.addEventListener("click", () => openInboxThread(t.phone));
    list.appendChild(li);
  }
}

async function openInboxThread(phone) {
  if (!selectedInstance) return;
  inboxSelectedPhone = phone;
  const data = await api(
    `/api/clients/${encodeURIComponent(selectedInstance)}/inbox/${encodeURIComponent(phone)}`
  );
  const title = document.getElementById("inbox-thread-title");
  const box = document.getElementById("inbox-messages");
  const form = document.getElementById("inbox-reply-form");
  const release = document.getElementById("inbox-release-ai");
  if (title) {
    const score = Number(data.contact?.qualification_score) || 0;
    title.textContent = `${data.contact?.push_name || phone} · ${data.contact?.handoff_status || "ai"}${score ? ` · score ${score}` : ""}`;
  }
  if (box) {
    box.innerHTML = (data.messages || [])
      .map((m) => {
        const who = m.role === "customer" ? "Customer" : m.role === "human" ? "You" : "AI";
        return `<p><strong>${escapeHtml(who)}:</strong> ${escapeHtml(m.body)}</p>`;
      })
      .join("") || `<p class="muted">No stored messages yet.</p>`;
    box.scrollTop = box.scrollHeight;
  }
  if (form) form.hidden = false;
  if (release) {
    const human = ["unassigned", "assigned", "human_active"].includes(data.contact?.handoff_status);
    release.hidden = !human;
  }
  await loadInbox();
}

document.getElementById("inbox-reply-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedInstance || !inboxSelectedPhone) return;
  const fd = new FormData(e.target);
  const msg = document.getElementById("inbox-reply-msg");
  if (msg) msg.textContent = "Sending…";
  try {
    await api(
      `/api/clients/${encodeURIComponent(selectedInstance)}/inbox/${encodeURIComponent(inboxSelectedPhone)}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fd.get("text") })
      }
    );
    e.target.reset();
    if (msg) msg.textContent = "Sent.";
    await openInboxThread(inboxSelectedPhone);
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
});

document.getElementById("inbox-release-ai")?.addEventListener("click", async () => {
  if (!selectedInstance || !inboxSelectedPhone) return;
  await api(
    `/api/clients/${encodeURIComponent(selectedInstance)}/inbox/${encodeURIComponent(inboxSelectedPhone)}/release`,
    { method: "POST" }
  );
  await openInboxThread(inboxSelectedPhone);
});

async function loadKnowledge() {
  if (!selectedInstance) return;
  const scope = document.getElementById("knowledge-scope");
  const client = clientsCache.find((c) => c.instance_name === selectedInstance);
  if (scope) {
    scope.textContent = `Client: ${client?.display_name || selectedInstance} · type ${client?.agent_type || "store"}`;
  }
  const data = await api(`/api/clients/${encodeURIComponent(selectedInstance)}/knowledge`);
  const list = document.getElementById("knowledge-list");
  if (!list) return;
  list.innerHTML = "";
  const docs = data.docs || [];
  if (!docs.length) {
    list.innerHTML = `<li class="muted">No docs yet — add FAQs so the AI stays accurate.</li>`;
    return;
  }
  for (const d of docs) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(d.title)}</strong>
      <div class="meta">${d.active ? "active" : "off"} · ${escapeHtml(String(d.content || "").slice(0, 80))}</div>
      <div class="toolbar" style="margin-top:8px">
        <button type="button" class="ghost kb-edit" data-id="${d.id}">Edit</button>
        <button type="button" class="ghost kb-del" data-id="${d.id}">Delete</button>
      </div>`;
    list.appendChild(li);
  }
  list._docs = docs;
}

document.getElementById("knowledge-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedInstance) return;
  const fd = new FormData(e.target);
  const msg = document.getElementById("knowledge-msg");
  if (msg) msg.textContent = "Saving…";
  try {
    await api(`/api/clients/${encodeURIComponent(selectedInstance)}/knowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: fd.get("id") || null,
        title: fd.get("title"),
        content: fd.get("content"),
        active: Boolean(fd.get("active"))
      })
    });
    e.target.reset();
    e.target.id.value = "";
    e.target.active.checked = true;
    if (msg) msg.textContent = "Saved.";
    await loadKnowledge();
  } catch (error) {
    if (msg) msg.textContent = error.message;
  }
});

document.getElementById("knowledge-list")?.addEventListener("click", async (e) => {
  const edit = e.target.closest(".kb-edit");
  const del = e.target.closest(".kb-del");
  const list = document.getElementById("knowledge-list");
  if (edit && list?._docs) {
    const doc = list._docs.find((d) => String(d.id) === String(edit.dataset.id));
    if (!doc) return;
    const form = document.getElementById("knowledge-form");
    form.id.value = doc.id;
    form.title.value = doc.title;
    form.content.value = doc.content;
    form.active.checked = Boolean(doc.active);
  }
  if (del) {
    if (!confirm("Delete this document?")) return;
    await api(
      `/api/clients/${encodeURIComponent(selectedInstance)}/knowledge/${del.dataset.id}`,
      { method: "DELETE" }
    );
    await loadKnowledge();
  }
});

async function loadBookings() {
  if (!selectedInstance) return;
  const data = await api(`/api/clients/${encodeURIComponent(selectedInstance)}/bookings`);
  const list = document.getElementById("bookings-list");
  if (!list) return;
  list.innerHTML = "";
  const rows = data.bookings || [];
  if (!rows.length) {
    list.innerHTML = `<li class="muted">No bookings yet.</li>`;
    return;
  }
  for (const b of rows.slice(0, 20)) {
    const li = document.createElement("li");
    const when = new Date(b.starts_at).toLocaleString();
    li.innerHTML = `<strong>${escapeHtml(b.service_name || "Booking")}</strong>
      <div class="meta">${escapeHtml(b.customer_name || "")} · ${escapeHtml(b.phone)} · ${escapeHtml(when)} · ${escapeHtml(b.status)}</div>`;
    list.appendChild(li);
  }
}

async function loadSocial() {
  const statusEl = document.getElementById("social-status");
  const platList = document.getElementById("social-platform-list");
  const postList = document.getElementById("social-post-list");
  if (!platList) return;
  const data = await api("/api/social/overview");
  window.__socialOverview = data;
  const postsData = await api("/api/social/posts?limit=20");
  if (statusEl) {
    statusEl.textContent = `Dry-run: ${data.dryRun ? "ON" : "OFF"} · Hub URL: ${data.publicUrl || "—"} · Draft posts via the Social Telegram bot.`;
  }
  const appsForm = document.getElementById("social-apps-form");
  if (appsForm?.publicUrl && data.publicUrl) appsForm.publicUrl.value = data.publicUrl;
  if (appsForm?.metaAppId && data.oauth?.instagram?.appId) appsForm.metaAppId.placeholder = data.oauth.instagram.appId;
  platList.innerHTML = "";
  for (const p of data.platforms || []) {
    const li = document.createElement("li");
    const oauthNote = p.oauthReady ? "login ready" : "needs app setup";
    li.innerHTML = `<strong>${escapeHtml(p.platform)}</strong>
      <div class="meta">${p.ready ? "connected" : "not connected"} · ${escapeHtml(p.handle || "—")} · ${oauthNote}</div>
      <div class="row-actions" style="margin-top:6px">
        <button type="button" class="ghost small" data-social-select="${escapeAttr(p.platform)}">Select</button>
        <button type="button" class="small" data-social-oauth="${escapeAttr(p.platform)}">${
          p.ready ? "Reconnect" : "Connect"
        }</button>
      </div>`;
    platList.appendChild(li);
  }
  if (postList) {
    postList.innerHTML = "";
    const posts = postsData.posts || [];
    if (!posts.length) {
      postList.innerHTML = `<li class="muted">No drafts yet — message the Social Telegram bot.</li>`;
    } else {
      for (const post of posts) {
        const li = document.createElement("li");
        li.innerHTML = `<strong>#${post.id}</strong> ${escapeHtml(post.status)}
          <div class="meta">${escapeHtml((post.platforms || []).join(", "))} · ${escapeHtml(
            String(post.brief || "").slice(0, 80)
          )}</div>`;
        postList.appendChild(li);
      }
    }
  }
  syncSocialPlatformFields();
}

const SOCIAL_PLATFORM_HINTS = {
  instagram:
    "Opens Facebook login, then links your Instagram Professional account attached to a Page.",
  facebook: "Opens Facebook login and connects your Facebook Page(s).",
  tiktok: "Opens TikTok login to authorize posting.",
  x: "Opens X login to authorize posting.",
  linkedin: "Opens LinkedIn login to authorize posting.",
  youtube: "Opens Google login to authorize YouTube Shorts uploads."
};

const SOCIAL_PLATFORM_LABELS = {
  instagram: "Connect with Instagram",
  facebook: "Connect with Facebook",
  tiktok: "Connect with TikTok",
  x: "Connect with X",
  linkedin: "Connect with LinkedIn",
  youtube: "Connect with YouTube"
};

function socialRedirectFor(platform) {
  const base = (window.__socialOverview?.publicUrl || location.origin).replace(/\/$/, "");
  if (platform === "instagram" || platform === "facebook") {
    return `${base}/api/social/oauth/meta/callback`;
  }
  return `${base}/api/social/oauth/${platform}/callback`;
}

function syncSocialPlatformFields() {
  const select = document.getElementById("social-platform-select");
  if (!select) return;
  const platform = select.value;
  const hint = document.getElementById("social-platform-hint");
  if (hint) hint.textContent = SOCIAL_PLATFORM_HINTS[platform] || "";
  const btn = document.getElementById("social-oauth-btn");
  if (btn) btn.textContent = SOCIAL_PLATFORM_LABELS[platform] || "Connect";
  const readyEl = document.getElementById("social-oauth-ready");
  const oauth = window.__socialOverview?.oauth?.[platform];
  if (readyEl) {
    readyEl.textContent = oauth?.ready
      ? "App credentials found — click Connect to sign in."
      : "First open “One-time app setup” below, paste App ID + Secret for this platform, Save, then Connect.";
  }
  const redirectHint = document.getElementById("social-redirect-hint");
  if (redirectHint) redirectHint.textContent = socialRedirectFor(platform);

  const appKey =
    platform === "instagram" || platform === "facebook"
      ? "meta"
      : platform === "youtube"
        ? "youtube"
        : platform;
  document.querySelectorAll("#social-apps-form .social-app-fields").forEach((block) => {
    block.hidden = block.dataset.app !== appKey;
  });

  const msg = document.getElementById("social-account-msg");
  if (msg) msg.textContent = "";
}

function startSocialOAuth(platform) {
  const oauth = window.__socialOverview?.oauth?.[platform];
  const msg = document.getElementById("social-account-msg");
  if (!oauth?.ready) {
    if (msg) {
      msg.textContent = "Save App ID + Secret in One-time app setup first, then try Connect again.";
    }
    document.getElementById("social-apps-setup")?.setAttribute("open", "open");
    return;
  }
  location.href = `/api/social/oauth/${encodeURIComponent(platform)}/start`;
}

document.getElementById("social-platform-select")?.addEventListener("change", syncSocialPlatformFields);

document.getElementById("social-oauth-btn")?.addEventListener("click", () => {
  const platform = document.getElementById("social-platform-select")?.value || "instagram";
  startSocialOAuth(platform);
});

document.getElementById("social-platform-list")?.addEventListener("click", (e) => {
  const selectBtn = e.target.closest("[data-social-select]");
  const oauthBtn = e.target.closest("[data-social-oauth]");
  const select = document.getElementById("social-platform-select");
  if (selectBtn && select) {
    select.value = selectBtn.dataset.socialSelect;
    syncSocialPlatformFields();
    select.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (oauthBtn) {
    if (select) select.value = oauthBtn.dataset.socialOauth;
    syncSocialPlatformFields();
    startSocialOAuth(oauthBtn.dataset.socialOauth);
  }
});

document.getElementById("social-apps-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById("social-apps-msg");
  try {
    await api("/api/social/apps", {
      method: "POST",
      body: JSON.stringify({
        publicUrl: form.publicUrl.value,
        metaAppId: form.metaAppId.value,
        metaAppSecret: form.metaAppSecret.value,
        tiktokClientKey: form.tiktokClientKey.value,
        tiktokClientSecret: form.tiktokClientSecret.value,
        xClientId: form.xClientId.value,
        xClientSecret: form.xClientSecret.value,
        linkedinClientId: form.linkedinClientId.value,
        linkedinClientSecret: form.linkedinClientSecret.value,
        googleClientId: form.googleClientId.value,
        googleClientSecret: form.googleClientSecret.value
      })
    });
    if (msg) msg.textContent = "Saved. You can Connect now.";
    form.metaAppSecret.value = "";
    form.tiktokClientSecret.value = "";
    form.xClientSecret.value = "";
    form.linkedinClientSecret.value = "";
    form.googleClientSecret.value = "";
    await loadSocial();
  } catch (error) {
    if (msg) msg.textContent = error.message || "Failed";
  }
});

function applyHubQueryParams() {
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab");
  const instance = params.get("instance");
  const phone = params.get("phone");
  if (tab === "social") {
    setTab("social");
    loadSocial().catch(console.error);
  } else if (tab === "inbox") {
    setTab("inbox");
    if (instance) {
      selectedInstance = decodeURIComponent(instance);
    }
    if (phone) {
      inboxSelectedPhone = decodeURIComponent(phone).replace(/\D/g, "");
    }
  } else if (tab) {
    setTab(tab);
    if (tab === "finance") loadFinance().catch(console.error);
  }
  const flash = document.getElementById("social-flash");
  if (flash) {
    if (params.get("social_ok")) {
      flash.hidden = false;
      flash.textContent = `Connected: ${params.get("social_ok")}`;
    } else if (params.get("social_error")) {
      flash.hidden = false;
      flash.textContent = `Connect failed: ${params.get("social_error")}`;
    }
  }
  if (params.has("tab") || params.has("instance") || params.has("phone") || params.has("social_ok") || params.has("social_error")) {
    history.replaceState({}, "", location.pathname);
  }
  return { openInbox: tab === "inbox", phone: inboxSelectedPhone };
}

syncSocialPlatformFields();

loadClients()
  .then(async () => {
    const params = new URLSearchParams(location.search);
    if (params.get("tab") === "inbox" && params.get("instance")) {
      selectedInstance = decodeURIComponent(params.get("instance"));
      const phone = params.get("phone");
      setTab("inbox");
      await selectClient(selectedInstance);
      await loadInbox();
      if (phone) await openInboxThread(decodeURIComponent(phone).replace(/\D/g, ""));
      history.replaceState({}, "", location.pathname);
    } else {
      applyHubQueryParams();
    }
  })
  .catch((error) => {
    console.error(error);
    location.href = "/login";
  });
