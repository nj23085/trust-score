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

  // ── LIVE LOADING OVERLAY ─────────────────────────────────
  // Uses the EXACT same formula as overlay.js on the scrape tab:
  //   pct = Math.min(5 + Math.floor((count / 100) * 65), 75)  → during scraping
  //   pct = 82%  → AI analysis stage
  //   pct = 100% → done
  // This makes the home page bar mirror the extension overlay 1:1.

  const homeOverlay = document.getElementById("homeLoadingOverlay");
  const homeBar = document.getElementById("homeProgressBar");
  const homePct = document.getElementById("homeProgressPct");
  const homeMsg = document.getElementById("homeProgressMsg");
  const homeTitle = document.getElementById("homeProgressTitle");
  const homeCountBadge = document.getElementById("homeReviewCount");
  const homeCountNum = document.getElementById("homeReviewCountNum");
  const homeStageScrape = document.getElementById("home-stage-scrape");
  const homeStageAI = document.getElementById("home-stage-ai");
  const homeStageDone = document.getElementById("home-stage-done");

  function setHomeStage(stage) {
    if (!homeStageScrape) return;
    [homeStageScrape, homeStageAI, homeStageDone].forEach(s => s.classList.remove("active", "complete"));
    if (stage === "scraping") {
      homeStageScrape.classList.add("active");
    } else if (stage === "analyzing") {
      homeStageScrape.classList.add("complete");
      homeStageAI.classList.add("active");
    } else if (stage === "done") {
      homeStageScrape.classList.add("complete");
      homeStageAI.classList.add("complete");
      homeStageDone.classList.add("active");
    }
  }

  function setHomeProgress(pct, message, stage) {
    if (!homeBar) return;
    homeBar.style.width = pct + "%";
    if (homePct) homePct.textContent = pct + "%";
    if (homeMsg && message) homeMsg.textContent = message;
    if (stage) setHomeStage(stage);
  }

  function showHomeOverlay() {
    if (!homeOverlay) return;
    homeOverlay.style.display = "flex";
    // Start at 5% (same as overlay.js initial state)
    setHomeProgress(5, "Initialising scraper\u2026", "scraping");
  }

  function showHomeOverlayError(message) {
    if (!homeOverlay) return;
    homeOverlay.innerHTML =
      '<div class="loading-card glass-panel" style="border-left:4px solid var(--danger); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">' +
      '<i class="fa-solid fa-circle-exclamation" style="font-size:2.5rem;color:var(--danger);margin-bottom:16px;"></i>' +
      '<h4 style="color:var(--danger);">Scraping Failed</h4>' +
      '<p style="margin:12px 0 24px;">' + message + '</p>' +
      '<button onclick="window.location.reload()" class="primary-btn"><i class="fa-solid fa-arrow-left"></i> Go Back</button>' +
      '</div>';
  }

  // Show overlay immediately in capture phase (fires BEFORE bubble phase listeners)
  form.addEventListener("submit", function () {
    showHomeOverlay();
  }, true);

  // ── RECEIVE PROGRESS FROM BACKGROUND.JS ──────────────────
  chrome.runtime.onMessage.addListener((msg) => {

    if (msg.action === "scrapeProgress") {
      const count = msg.count || 0;
      const message = msg.message || ("Scraped " + count + " reviews\u2026");
      const isAI = message.toLowerCase().includes("ai analysis") ||
        message.toLowerCase().includes("running ai");

      if (isAI) {
        // Exact match to overlay.js stage "analyzing"
        setHomeProgress(82, "Running AI analysis\u2026", "analyzing");
        if (homeTitle) homeTitle.textContent = "Running AI Analysis\u2026";
      } else {
        // Exact same formula as overlay.js update()
        const pct = Math.min(5 + Math.floor((count / 100) * 65), 75);
        setHomeProgress(pct, message, "scraping");
        if (homeTitle) homeTitle.textContent = "Processing Request";
      }

      // Show review count badge
      if (count > 0 && homeCountBadge) {
        homeCountBadge.style.display = "inline-flex";
        if (homeCountNum) homeCountNum.textContent = count;
      }
    }

    if (msg.action === "scrapeError") {
      const submitBtnErr = form.querySelector("button[type='submit']");
      if (submitBtnErr) {
        submitBtnErr.disabled = false;
        submitBtnErr.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i> Analyze';
      }
      if (homeOverlay && homeOverlay.style.display === "flex") {
        showHomeOverlayError(msg.message);
      } else {
        alert("Scraping failed: " + msg.message);
      }
    }
  });

  // Snap to 100% just before tab navigates to results
  window.addEventListener("beforeunload", () => {
    if (homeOverlay && homeOverlay.style.display === "flex") {
      setHomeProgress(100, "Redirecting to results\u2026", "done");
      if (homeTitle) homeTitle.textContent = "Analysis Complete!";
    }
  });
})();