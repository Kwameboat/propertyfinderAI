async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtDate(v) {
  if (!v) return "—";
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function fmtPrice(n, tx) {
  const p = Number(n);
  if (!Number.isFinite(p)) return "—";
  if (marketCode === "GH") {
    return tx === "sale" ? `GH₵ ${p.toLocaleString()}` : `GH₵ ${p.toLocaleString()}/mo`;
  }
  return tx === "rent" ? `AED ${p.toLocaleString()}/yr` : `AED ${p.toLocaleString()}`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function renderTable(headers, rows) {
  if (!rows.length) return '<p class="ld-muted">No rows.</p>';
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="ld-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const VIEW_TITLES = {
  overview: "Overview",
  listings: "Listings",
  leads: "Leads",
  viewings: "Viewings",
  ingest: "Ingest",
  scrapes: "Scrape runs"
};

let marketCode = "AE";

const LEAD_STATUSES = [
  "new",
  "contacted",
  "viewing_scheduled",
  "viewed",
  "offer",
  "closed",
  "lost",
  "pending_telegram",
  "sent"
];

let dashboardCache = null;
let listingsPage = 0;
const LISTINGS_PAGE_SIZE = 24;
let listingsSearchTimer = null;

function switchView(name) {
  document.querySelectorAll(".ld-nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  document.querySelectorAll(".ld-view").forEach((v) => {
    const active = v.id === `view-${name}`;
    v.classList.toggle("active", active);
    v.hidden = !active;
  });
  document.getElementById("view-title").textContent = VIEW_TITLES[name] || name;
  if (name === "leads") loadLeads();
  if (name === "listings") loadListings();
  if (name === "scrapes") loadScrapes();
  if (name === "viewings") loadViewings();
}

function listingFilters() {
  return {
    source: document.getElementById("listing-source-filter").value,
    emirate: document.getElementById("listing-emirate-filter").value,
    beds: document.getElementById("listing-beds-filter").value,
    transaction_type: document.getElementById("listing-tx-filter").value,
    q: document.getElementById("listing-q").value.trim()
  };
}

function listingQueryString(page = listingsPage) {
  const f = listingFilters();
  const params = new URLSearchParams();
  params.set("limit", String(LISTINGS_PAGE_SIZE));
  params.set("offset", String(page * LISTINGS_PAGE_SIZE));
  if (f.source) params.set("source", f.source);
  if (f.emirate) params.set("emirate", f.emirate);
  if (f.beds !== "") params.set("beds", f.beds);
  if (f.transaction_type) params.set("transaction_type", f.transaction_type);
  if (f.q) params.set("q", f.q);
  return params.toString();
}

function listingThumb(listing) {
  const imgs = listing.images || [];
  const url = imgs[0] || listing.image || "";
  if (url) {
    return `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<span class=\\'ld-no-img\\'>No photo</span>'" />`;
  }
  return '<span class="ld-no-img">No photo</span>';
}

function renderListingCard(l) {
  const bedsLabel = l.beds === 0 ? "Studio" : l.beds != null ? `${l.beds} bed` : "—";
  return `<article class="ld-card-item" data-listing-id="${esc(l.id)}">
    <div class="ld-card-thumb">${listingThumb(l)}</div>
    <div class="ld-card-body">
      <p class="ld-card-price">${esc(fmtPrice(l.price_aed, l.transaction_type))}</p>
      <p class="ld-card-loc">${esc(l.community || l.building || l.emirate || "—")}</p>
      <div class="ld-card-meta">
        <span class="ld-pill">${esc(l.emirate || "—")}</span>
        <span class="ld-pill muted">${esc(bedsLabel)}</span>
        <span class="ld-pill muted">${esc(l.source || "—")}</span>
      </div>
    </div>
  </article>`;
}

async function loadDashboard() {
  try {
    const cfg = await api("/api/rent/config");
    if (cfg.market?.code) marketCode = cfg.market.code;
  } catch {
    /* keep AE */
  }
  const data = await api("/api/admin/re/dashboard");
  dashboardCache = data;
  document.getElementById("kpi-listings").textContent = data.listings ?? "0";
  document.getElementById("kpi-pf").textContent = data.sources?.propertyfinder ?? "0";
  document.getElementById("kpi-leads").textContent = data.leads?.total ?? "0";
  document.getElementById("kpi-new-leads").textContent = data.leads?.byStatus?.new ?? "0";
  document.getElementById("kpi-puppeteer").textContent = data.puppeteer?.enabled ? "ON" : "OFF";
  document.getElementById("store-badge").textContent = data.store || "local";

  document.getElementById("sources-list").innerHTML = Object.entries(data.sources || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<li><span>${esc(k)}</span><strong>${v}</strong></li>`)
    .join("");

  const recent = data.leads?.recent || [];
  document.getElementById("recent-leads").innerHTML = renderTable(
    ["Name", "Phone", "Status", "Score", "When"],
    recent.map((l) => [
      esc(l.renter_name || "—"),
      esc(l.renter_phone),
      `<span class="ld-status-pill">${esc(l.ops_status)}</span>`,
      String(l.qualification_score ?? 0),
      fmtDate(l.created_at)
    ])
  );
}

async function loadListings() {
  const grid = document.getElementById("listings-grid");
  grid.innerHTML = '<p class="ld-muted">Loading listings…</p>';
  const data = await api(`/api/admin/re/listings?${listingQueryString()}`);
  const listings = data.listings || [];
  const total = data.total ?? listings.length;

  document.getElementById("listings-count").textContent =
    `${total.toLocaleString()} listing${total === 1 ? "" : "s"} · showing ${listings.length}`;

  if (!listings.length) {
    grid.innerHTML = '<p class="ld-muted">No listings match your filters.</p>';
  } else {
    grid.innerHTML = listings.map(renderListingCard).join("");
    grid.querySelectorAll(".ld-card-item").forEach((el) => {
      el.addEventListener("click", () => openListingDrawer(el.dataset.listingId));
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / LISTINGS_PAGE_SIZE));
  document.getElementById("listings-page-label").textContent =
    `Page ${listingsPage + 1} of ${totalPages}`;
  document.getElementById("listings-prev").disabled = listingsPage <= 0;
  document.getElementById("listings-next").disabled = listingsPage + 1 >= totalPages;
}

function openDrawer(drawerId) {
  document.getElementById(drawerId).classList.add("open");
  document.getElementById(drawerId).setAttribute("aria-hidden", "false");
  document.getElementById("drawer-backdrop").hidden = false;
}

function closeDrawers() {
  document.querySelectorAll(".ld-drawer").forEach((d) => {
    d.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
  });
  document.getElementById("drawer-backdrop").hidden = true;
}

async function openListingDrawer(id) {
  const body = document.getElementById("drawer-listing-body");
  body.innerHTML = '<p class="ld-muted">Loading…</p>';
  openDrawer("listing-drawer");

  try {
    const { listing: l } = await api(`/api/admin/re/listings/${encodeURIComponent(id)}`);
    document.getElementById("drawer-listing-title").textContent =
      l.community || l.building || "Listing";

    const imgs = (l.images || []).slice(0, 8);
    const gallery = imgs.length
      ? `<div class="ld-drawer-gallery">${imgs
          .map((u) => `<img src="${esc(u)}" alt="" loading="lazy" />`)
          .join("")}</div>`
      : "";

    const rows = [
      ["Price", fmtPrice(l.price_aed, l.transaction_type)],
      ["Emirate", l.emirate || "—"],
      ["Community", l.community || "—"],
      ["Building", l.building || "—"],
      ["Beds", l.beds === 0 ? "Studio" : l.beds ?? "—"],
      ["Baths", l.baths ?? "—"],
      ["Size", l.size_sqft ? `${l.size_sqft} sqft` : "—"],
      ["Type", l.property_type || "—"],
      ["Transaction", l.transaction_type || "—"],
      ["Source", l.source || "—"],
      ["Status", l.listing_status || "active"],
      ["Scraped", fmtDate(l.scraped_at)]
    ];

    body.innerHTML = `
      ${gallery}
      <p class="ld-card-price">${esc(fmtPrice(l.price_aed, l.transaction_type))}</p>
      ${rows
        .map(
          ([k, v]) =>
            `<div class="ld-detail-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`
        )
        .join("")}
      ${l.description ? `<p class="ld-muted" style="margin-top:16px">${esc(l.description.slice(0, 500))}${l.description.length > 500 ? "…" : ""}</p>` : ""}
      <div class="ld-drawer-actions">
        ${
          l.source_url
            ? `<a href="${esc(l.source_url)}" target="_blank" rel="noopener" class="ld-btn ld-btn-gold">View on portal</a>`
            : ""
        }
        <button type="button" class="ld-btn ld-btn-ghost" id="deactivate-listing" data-id="${esc(l.id)}">Deactivate</button>
      </div>`;

    document.getElementById("deactivate-listing")?.addEventListener("click", async (e) => {
      if (!confirm("Deactivate this listing?")) return;
      try {
        await api(`/api/admin/re/listings/${encodeURIComponent(e.target.dataset.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ is_active: false })
        });
        closeDrawers();
        await loadListings();
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    });
  } catch (e) {
    body.innerHTML = `<p class="ld-muted">${esc(e.message)}</p>`;
  }
}

async function openLeadDrawer(id) {
  const body = document.getElementById("drawer-lead-body");
  body.innerHTML = '<p class="ld-muted">Loading…</p>';
  openDrawer("lead-drawer");

  try {
    const { lead: l } = await api(`/api/admin/re/leads/${encodeURIComponent(id)}`);
    const criteria = l.criteria || {};
    const critRows = Object.entries(criteria)
      .filter(([, v]) => v != null && v !== "")
      .map(
        ([k, v]) =>
          `<div class="ld-detail-row"><span>${esc(k)}</span><span>${esc(String(v))}</span></div>`
      )
      .join("");

    body.innerHTML = `
      <div class="ld-detail-row"><span>Name</span><span>${esc(l.renter_name || "—")}</span></div>
      <div class="ld-detail-row"><span>Phone</span><span>${esc(l.renter_phone)}</span></div>
      <div class="ld-detail-row"><span>Status</span><span><span class="ld-status-pill">${esc(l.ops_status)}</span></span></div>
      <div class="ld-detail-row"><span>Score</span><span>${l.qualification_score ?? 0}</span></div>
      <div class="ld-detail-row"><span>Created</span><span>${fmtDate(l.created_at)}</span></div>
      ${l.notes ? `<p class="ld-muted" style="margin:16px 0"><strong>Notes:</strong> ${esc(l.notes)}</p>` : ""}
      ${critRows ? `<h3 style="font-size:0.95rem;margin:16px 0 8px">Search criteria</h3>${critRows}` : ""}
      <div class="ld-drawer-actions" style="margin-top:20px">
        <select id="drawer-lead-status" class="ld-select">${LEAD_STATUSES.map(
          (s) => `<option value="${s}"${l.ops_status === s ? " selected" : ""}>${s}</option>`
        ).join("")}</select>
        <button type="button" id="drawer-lead-save" class="ld-btn ld-btn-gold" data-id="${esc(l.id)}">Save status</button>
      </div>`;

    document.getElementById("drawer-lead-save").addEventListener("click", async (e) => {
      try {
        await api(`/api/admin/re/leads/${encodeURIComponent(e.target.dataset.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ ops_status: document.getElementById("drawer-lead-status").value })
        });
        e.target.textContent = "Saved";
        await loadLeads();
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    });
  } catch (e) {
    body.innerHTML = `<p class="ld-muted">${esc(e.message)}</p>`;
  }
}

async function loadLeads() {
  const status = document.getElementById("lead-status-filter").value;
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await api(`/api/admin/re/leads${q}`);

  document.getElementById("leads-table").innerHTML = renderTable(
    ["Name", "Phone", "Status", "Score", "Notes", "When", ""],
    (data.leads || []).map((l) => [
      esc(l.renter_name || "—"),
      esc(l.renter_phone),
      `<select class="lead-status-select" data-lead-id="${esc(l.id)}">${LEAD_STATUSES.map(
        (s) => `<option value="${s}"${l.ops_status === s ? " selected" : ""}>${s}</option>`
      ).join("")}</select>`,
      String(l.qualification_score ?? 0),
      esc((l.notes || "").slice(0, 50)),
      fmtDate(l.created_at),
      `<button type="button" class="ld-link-row lead-view-btn" data-lead-id="${esc(l.id)}">View</button>`
    ])
  );

  document.querySelectorAll(".lead-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => openLeadDrawer(btn.dataset.leadId));
  });

  document.querySelectorAll(".lead-status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await api(`/api/admin/re/leads/${encodeURIComponent(sel.dataset.leadId)}`, {
          method: "PATCH",
          body: JSON.stringify({ ops_status: sel.value })
        });
        await loadDashboard();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

async function loadViewings() {
  const status = document.getElementById("viewing-status-filter")?.value || "";
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const [viewingData, dealData] = await Promise.all([
    api(`/api/admin/re/viewings${q}`),
    api("/api/admin/re/deals")
  ]);

  document.getElementById("viewings-table").innerHTML = renderTable(
    ["Renter", "Phone", "Status", "Agent MoMo", "Paid", "Redeemed", "ID"],
    (viewingData.viewings || []).map((v) => [
      esc(v.renter_name || "—"),
      esc(v.renter_phone || ""),
      `<span class="ld-status-pill">${esc(v.status)}</span>`,
      esc(v.agent_momo || "—"),
      fmtDate(v.paid_at),
      fmtDate(v.redeemed_at),
      `<button type="button" class="ld-link-row viewing-id-btn" data-viewing-id="${esc(v.id)}">${esc(String(v.id).slice(0, 8))}…</button>`
    ])
  );

  document.querySelectorAll(".viewing-id-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("deal-viewing-id");
      if (input) input.value = btn.dataset.viewingId;
    });
  });

  document.getElementById("deals-table").innerHTML = renderTable(
    ["Viewing", "Agreed GHS", "Commission", "Platform", "Agent", "Status"],
    (dealData.deals || []).map((d) => [
      esc(String(d.viewing_id || "").slice(0, 8)),
      String(d.agreed_amount_ghs ?? ""),
      String(d.commission_ghs ?? ""),
      String(d.platform_share_ghs ?? ""),
      String(d.agent_share_ghs ?? ""),
      esc(d.status || "")
    ])
  );
}

async function loadScrapes() {
  const data = await api("/api/admin/re/scrape-runs?limit=25");
  document.getElementById("scrapes-table").innerHTML = renderTable(
    ["Source", "Found", "Upserted", "Started", "Errors"],
    (data.runs || []).map((r) => [
      esc(r.source),
      String(r.listings_found ?? 0),
      String(r.listings_upserted ?? 0),
      fmtDate(r.started_at),
      esc(Array.isArray(r.errors) ? r.errors.slice(0, 2).join("; ") : "")
    ])
  );
}

document.querySelectorAll(".ld-nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("refresh-btn").addEventListener("click", async () => {
  await loadDashboard();
  const active = document.querySelector(".ld-nav-item.active")?.dataset.view;
  if (active === "leads") await loadLeads();
  if (active === "listings") await loadListings();
  if (active === "scrapes") await loadScrapes();
  if (active === "viewings") await loadViewings();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  location.href = "/login.html";
});

document.getElementById("close-listing-drawer").addEventListener("click", closeDrawers);
document.getElementById("close-lead-drawer").addEventListener("click", closeDrawers);
document.getElementById("drawer-backdrop").addEventListener("click", closeDrawers);

document.getElementById("btn-puppeteer").addEventListener("click", async () => {
  const el = document.getElementById("action-msg");
  el.textContent = "Running puppeteer ingest…";
  try {
    const data = await api("/api/admin/re/ingest/puppeteer", {
      method: "POST",
      body: JSON.stringify({ maxPages: 3 })
    });
    el.textContent = `Done — upserted ${data.upserted ?? 0} listings.`;
    await loadDashboard();
  } catch (e) {
    el.textContent = e.message;
  }
});

document.getElementById("btn-apify-pf").addEventListener("click", async () => {
  const el = document.getElementById("action-msg");
  el.textContent = "Running Apify Property Finder scrape (may take 2–5 min)…";
  try {
    const data = await api("/api/admin/re/ingest/apify", {
      method: "POST",
      body: JSON.stringify({
        source: "propertyfinder",
        emirates: ["Dubai", "Abu Dhabi"],
        maxResults: 100
      })
    });
    el.textContent = `Apify PF — found ${data.found ?? 0}, upserted ${data.upserted ?? 0}.`;
    await loadDashboard();
    listingsPage = 0;
    if (document.querySelector(".ld-nav-item.active")?.dataset.view === "listings") {
      await loadListings();
    }
  } catch (e) {
    el.textContent = e.message;
  }
});

document.getElementById("btn-stale").addEventListener("click", async () => {
  const el = document.getElementById("action-msg");
  el.textContent = "Running stale cleanup…";
  try {
    await api("/api/admin/re/ingest/stale", { method: "POST", body: "{}" });
    el.textContent = "Stale cleanup complete.";
    await loadDashboard();
  } catch (e) {
    el.textContent = e.message;
  }
});

function resetListingsPage() {
  listingsPage = 0;
  loadListings().catch(console.error);
}

["listing-source-filter", "listing-emirate-filter", "listing-beds-filter", "listing-tx-filter"].forEach(
  (id) => {
    document.getElementById(id).addEventListener("change", resetListingsPage);
  }
);

document.getElementById("listing-q").addEventListener("input", () => {
  clearTimeout(listingsSearchTimer);
  listingsSearchTimer = setTimeout(resetListingsPage, 350);
});

document.getElementById("listings-prev").addEventListener("click", () => {
  if (listingsPage > 0) {
    listingsPage -= 1;
    loadListings().catch(console.error);
  }
});

document.getElementById("listings-next").addEventListener("click", () => {
  listingsPage += 1;
  loadListings().catch(console.error);
});

document.getElementById("lead-status-filter").addEventListener("change", () => {
  loadLeads().catch(console.error);
});

document.getElementById("viewing-status-filter")?.addEventListener("change", () => {
  loadViewings().catch(console.error);
});

document.getElementById("deal-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("deal-msg");
  msg.textContent = "Saving…";
  try {
    const data = await api("/api/admin/re/deals", {
      method: "POST",
      body: JSON.stringify({
        viewingId: document.getElementById("deal-viewing-id").value.trim(),
        agreedAmountGhs: Number(document.getElementById("deal-amount").value)
      })
    });
    msg.textContent = `Deal recorded. Commission GH₵${data.deal.commission_ghs} (platform ${data.deal.platform_share_ghs} / agent ${data.deal.agent_share_ghs}).`;
    await loadViewings();
  } catch (err) {
    msg.textContent = err.message;
  }
});

async function runPull(dryRun) {
  const url = document.getElementById("pull-url").value.trim();
  const maxListings = Number(document.getElementById("pull-max").value) || 50;
  const maxPages = Number(document.getElementById("pull-pages").value) || 3;
  const out = document.getElementById("pull-result");
  out.hidden = false;
  out.textContent = dryRun ? "Previewing…" : "Pulling listings (may take 1–2 min)…";
  try {
    const data = await api("/api/admin/re/scrape-url", {
      method: "POST",
      body: JSON.stringify({ url, maxListings, maxPages, dryRun })
    });
    out.textContent = JSON.stringify(data, null, 2);
    if (!dryRun && data.upserted) {
      await loadDashboard();
      listingsPage = 0;
      await loadListings();
    }
  } catch (e) {
    out.textContent = e.message;
  }
}

document.getElementById("pull-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runPull(false);
});

document.getElementById("pull-preview").addEventListener("click", () => runPull(true));

loadDashboard().catch(console.error);
