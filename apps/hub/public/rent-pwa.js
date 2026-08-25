/**
 * PWA install — Install now opens the browser's native install dialog immediately.
 * HTTP origins cannot install on Android; those taps jump to the HTTPS app URL first.
 * Installed apps check for a new service worker on open/focus and reload once it activates.
 */

const DISMISS_KEY = "dar_concierge_pwa_install_dismissed";
const DEFAULT_HTTPS_ORIGIN = "https://wa.jabdigitalhub.com";

function isGhanaPwa() {
  return (
    window.__RENT_BASE === "/gh" ||
    location.pathname === "/gh" ||
    location.pathname.startsWith("/gh/")
  );
}

function httpsOrigin() {
  const fromWindow = String(window.__RENT_HTTPS_ORIGIN || "").trim();
  if (fromWindow && !/^(off|0|false)$/i.test(fromWindow)) return fromWindow.replace(/\/$/, "");
  return DEFAULT_HTTPS_ORIGIN;
}

function pwaStartPath() {
  return isGhanaPwa() ? "/gh" : "/rent";
}

function store() {
  window.__darPwa = window.__darPwa || { promptEvent: null };
  return window.__darPwa;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true
  );
}

function getPromptEvent() {
  return store().promptEvent;
}

function getInstallEls() {
  return {
    banner: document.getElementById("pwa-install-banner"),
    bannerBtn: document.getElementById("pwa-install-btn"),
    bannerDismiss: document.getElementById("pwa-install-dismiss"),
    menuBtn: document.getElementById("pwa-install-menu-btn"),
    profileBtn: document.getElementById("pwa-install-profile-btn"),
    profileCard: document.getElementById("pwa-install-profile-card"),
    iosHint: document.getElementById("pwa-ios-hint"),
    iosDialog: document.getElementById("pwa-ios-dialog")
  };
}

function setVisible(el, show) {
  if (!el) return;
  el.classList.toggle("hidden", !show);
  el.hidden = !show;
}

function needsHttpsJump() {
  if (window.isSecureContext) return false;
  try {
    return new URL(httpsOrigin()).host !== location.host;
  } catch {
    return true;
  }
}

function waitForPrompt(ms = 3500) {
  const existing = getPromptEvent();
  if (existing?.prompt) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("dar-pwa-ready", onReady);
      window.removeEventListener("beforeinstallprompt", onReady);
      resolve(getPromptEvent());
    };
    const onReady = () => finish();
    const timer = setTimeout(finish, ms);
    window.addEventListener("dar-pwa-ready", onReady);
    window.addEventListener("beforeinstallprompt", onReady);
  });
}

function updateInstallUi() {
  const els = getInstallEls();
  const installed = isStandalone();
  const dismissed = localStorage.getItem(DISMISS_KEY) === "1";
  setVisible(els.banner, !installed && !dismissed);
  setVisible(els.menuBtn, !installed);
  setVisible(els.profileCard, !installed);
  setVisible(els.iosHint, false);
  els.iosDialog?.close?.();

  if (installed) {
    setVisible(els.banner, false);
    setVisible(els.menuBtn, false);
    setVisible(els.profileCard, false);
  }
}

async function triggerInstall(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  if (needsHttpsJump()) {
    const next = new URL(pwaStartPath(), httpsOrigin());
    next.searchParams.set("install", "1");
    location.assign(next.toString());
    return "redirect";
  }

  let promptEvent = getPromptEvent();
  if (!promptEvent?.prompt) promptEvent = await waitForPrompt(800);

  if (promptEvent?.prompt) {
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    store().promptEvent = null;
    if (outcome === "accepted") localStorage.setItem(DISMISS_KEY, "1");
    updateInstallUi();
    return outcome;
  }

  if (typeof navigator.install === "function") {
    try {
      await navigator.install();
      localStorage.setItem(DISMISS_KEY, "1");
      updateInstallUi();
      return "accepted";
    } catch (error) {
      if (error?.name === "AbortError") return "dismissed";
    }
  }

  return "unavailable";
}

function setupPwaAutoUpdate(registration) {
  if (!registration) return;
  const promptWaiting = () => {
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  };
  promptWaiting();
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) promptWaiting();
    });
  });
  const check = () => registration.update().catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("focus", check);
  window.addEventListener("pageshow", check);
  setInterval(check, 5 * 60 * 1000);
  check();
}

export function initPwaInstall() {
  const els = getInstallEls();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    store().promptEvent = e;
    updateInstallUi();
  });
  window.addEventListener("dar-pwa-ready", updateInstallUi);
  window.addEventListener("appinstalled", () => {
    store().promptEvent = null;
    localStorage.setItem(DISMISS_KEY, "1");
    updateInstallUi();
  });

  for (const btn of [els.bannerBtn, els.menuBtn, els.profileBtn]) {
    btn?.addEventListener("click", (e) => void triggerInstall(e));
  }
  els.bannerDismiss?.addEventListener("click", () => {
    localStorage.setItem(DISMISS_KEY, "1");
    updateInstallUi();
  });

  document.documentElement.classList.toggle("pwa-standalone", isStandalone());
  updateInstallUi();
}

export async function registerRentServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const ghana = isGhanaPwa();
  const swUrl = ghana ? "/gh/sw.js" : "/sw.js";
  const scope = ghana ? "/gh" : "/";
  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope,
      updateViaCache: "none"
    });
    setupPwaAutoUpdate(registration);
  } catch {
    if (ghana) return;
    try {
      const registration = await navigator.serviceWorker.register("/rent-sw.js", {
        scope: "/",
        updateViaCache: "none"
      });
      setupPwaAutoUpdate(registration);
    } catch {
      /* Chrome will not install without a controlling SW */
    }
  }
}

export { isStandalone, triggerInstall, isGhanaPwa };
