// ============================================
// TRUST-SCORE — WEBSITE BRIDGE (Content Script)
// Runs on the Trust-Score website — intercepts analyze forms
// and communicates with the background service worker
// ============================================

(function () {
  "use strict";

  // Only run on Trust-Score website pages (local dev or live production)
  if (!location.href.includes("localhost:8010") && !location.href.includes("127.0.0.1:8010") && !location.href.includes("trust-score-59lg.onrender.com")) return;

  console.log("[Trust-Score Bridge] Active on Trust-Score website");

  // Notify the page that the extension (and price compare) is ready
  setTimeout(() => {
    window.postMessage({ type: 'TRUE_SPOT_EXTENSION_READY' }, '*');
    console.log("[Trust-Score Bridge] Posted TRUE_SPOT_EXTENSION_READY");
  }, 500);

  // ── LISTEN FOR PRICE COMPARE TRIGGER FROM PAGE ───────────
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'TRUE_SPOT_START_PRICE_COMPARE') {
      console.log('[Trust-Score Bridge] Forwarding price compare request to background:', event.data);
      try {
        chrome.runtime.sendMessage({
          action: 'start_price_compare',
          url: event.data.url,
          session_id: event.data.session_id
        });
      } catch (err) {
        console.error('[Trust-Score Bridge] sendMessage error:', err);
      }
    }

    // Handle "Analyze" button clicks on similar products
    if (event.data.type === 'TRUE_SPOT_ANALYZE_SIMILAR') {
      console.log('[Trust-Score Bridge] Forwarding analyze-similar request to background:', event.data);
      try {
        chrome.runtime.sendMessage({
          action: 'startScrape',
          url: event.data.url,
          platform: event.data.platform,
          fromWebsite: true,
          isHomePage: false,
          originTabId: null
        });
      } catch (err) {
        console.error('[Trust-Score Bridge] sendMessage error:', err);
      }
    }
  });

  // ── FIND THE ANALYZE FORM ──────────────────────────────────────
  const form = document.getElementById("analyzeForm");
  if (!form) return;

  // ── Detect platform — try input first, then form action, then URL path ──
  function detectPlatform() {
    // 1. Check the input value (highest priority, user might paste a new link)
    const input = form.querySelector("input[name='product_link']");
    if (input && input.value.trim().length > 0) {
      const val = input.value.toLowerCase();
      if (val.includes("amazon")) return "amazon";
      if (val.includes("flipkart")) return "flipkart";
      if (val.includes("myntra")) return "myntra";
    }

    // 2. Check form action (set dynamically by the home page JS)
    if (form.action) {
      const action = form.action.toLowerCase();
      if (action.includes("amazon")) return "amazon";
      if (action.includes("flipkart")) return "flipkart";
      if (action.includes("myntra")) return "myntra";
    }

    // 3. Check the page URL path as last resort
    const path = location.pathname.toLowerCase();
    if (path.includes("amazon")) return "amazon";
    if (path.includes("flipkart")) return "flipkart";
    if (path.includes("myntra")) return "myntra";

    return null;
  }

  // Determine if we're on the home page
  const isHomePage = location.pathname === "/" || location.pathname === "";

  // Get initial platform (may be null on home page — that's OK)
  let currentPlatform = detectPlatform();

  console.log(`[Trust-Score Bridge] Initial platform: ${currentPlatform || "home (auto-detect at submit)"}`);

  // ── INTERCEPT THE SUBMIT ────────────────────────────────
  form.addEventListener("submit", function (e) {
    e.preventDefault(); // Stop the normal form POST to Flask

    // Re-detect platform at submit time (important for home page)
    const platform = detectPlatform();

    if (!platform) {
      alert("Please paste a valid Amazon, Flipkart, or Myntra product URL.");
      return;
    }

    const input = form.querySelector("input[name='product_link']");
    const url = (input ? input.value : "").trim();

    if (!url) {
      alert("Please paste a product URL first.");
      return;
    }

    let fullUrl = url;
    if (!fullUrl.startsWith("http")) fullUrl = "https://" + fullUrl;

    console.log(`[Trust-Score Bridge] Intercepted analyze for: ${fullUrl} (platform: ${platform})`);

    // Disable the submit button to prevent double-clicks
    const submitBtn = form.querySelector("button[type='submit']");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening product page\u2026';
    }

    try {
      // Tell the background script to start scraping
      chrome.runtime.sendMessage({
        action: "startScrape",
        url: fullUrl,
        platform: platform,
        fromWebsite: true,
        isHomePage: isHomePage,
        originTabId: null // background.js will use sender.tab.id
      });
    } catch (e) {
      if (e.message && e.message.includes("Extension context invalidated")) {
        alert("The Trust-Score extension was just updated. Please click OK to refresh this page so the new version can connect!");
        window.location.reload();
      } else {
        alert("Extension communication error. Make sure the extension is enabled.");
        console.error(e);
      }
      // Re-enable submit button on error
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i> Analyze';
      }
    }
  });

  // ── LISTEN FOR ERROR FROM BACKGROUND ─────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "scrapeError") {
      // Re-enable submit button
      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i> Analyze';
      }
      alert("Scraping failed: " + msg.message);
    }
  });
})();