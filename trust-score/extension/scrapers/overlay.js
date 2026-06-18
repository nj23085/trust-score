// ============================================
// TRUST-SCORE — SCRAPE PROGRESS OVERLAY
// Injected on product pages during scraping.
// Provides a full-screen overlay with live progress.
// ============================================

(function () {
  "use strict";

  // Don't re-create if already exists
  if (window.__tsOverlay) return;

  // ── Inject Styles ──────────────────────────────────────────
  const style = document.createElement("style");
  style.id = "trust-score-overlay-css";
  style.textContent = `
    #ts-scrape-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 2147483647;
      background: rgba(10, 10, 30, 0.82);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      animation: tsFadeIn 0.35s ease;
    }
    @keyframes tsFadeIn { from{opacity:0} to{opacity:1} }
    @keyframes tsSpin  { to{transform:rotate(360deg)} }
    @keyframes tsShimmer {
      0%{background-position:-200% 0}
      100%{background-position:200% 0}
    }

    .ts-card {
      background: linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 22px;
      padding: 44px 52px;
      max-width: 480px;
      width: 90%;
      text-align: center;
      color: #fff;
      box-shadow: 0 30px 60px rgba(0,0,0,0.55);
    }

    .ts-brand {
      font-size: 42px;
      font-weight: 800;
      margin-bottom: 4px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .ts-tagline {
      font-size: 12px;
      color: rgba(255,255,255,0.4);
      margin-bottom: 32px;
      letter-spacing: 1px;
    }

    .ts-spinner {
      width: 44px; height: 44px;
      border: 3px solid rgba(255,255,255,0.08);
      border-top-color: #667eea;
      border-radius: 50%;
      animation: tsSpin 0.75s linear infinite;
      margin: 0 auto 22px;
    }

    .ts-message {
      font-size: 15px;
      font-weight: 500;
      color: rgba(255,255,255,0.88);
      margin-bottom: 22px;
      min-height: 22px;
    }

    .ts-progress-track {
      width: 100%; height: 7px;
      background: rgba(255,255,255,0.08);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 10px;
    }
    .ts-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2, #667eea);
      background-size: 200% 100%;
      border-radius: 4px;
      transition: width 0.45s ease;
      width: 3%;
      animation: tsShimmer 2s linear infinite;
    }

    .ts-stats {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: rgba(255,255,255,0.5);
      margin-bottom: 26px;
    }
    .ts-count { color: #667eea; font-weight: 600; }

    .ts-stages {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .ts-stg {
      display: flex; align-items: center; gap: 5px;
      font-size: 11px;
      color: rgba(255,255,255,0.3);
      transition: all 0.3s ease;
    }
    .ts-stg.active { color: #667eea; }
    .ts-stg.active .ts-dot {
      background: #667eea;
      box-shadow: 0 0 8px rgba(102,126,234,0.5);
    }
    .ts-stg.complete { color: #34d399; }
    .ts-stg.complete .ts-dot { background: #34d399; }
    .ts-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: rgba(255,255,255,0.18);
      transition: all 0.3s ease;
    }
    .ts-line {
      width: 20px; height: 2px;
      background: rgba(255,255,255,0.12);
    }

    .ts-error-msg {
      color: #f87171;
      font-size: 14px;
      margin-top: 14px;
    }
    .ts-home-btn {
      margin-top: 18px;
      padding: 10px 28px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      border: none; border-radius: 10px;
      color: #fff; font-size: 14px; font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    .ts-home-btn:hover { opacity: 0.9; }
  `;
  document.documentElement.appendChild(style);

  // ── Create Overlay DOM ─────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "ts-scrape-overlay";
  overlay.innerHTML = `
    <div class="ts-card">
      <div class="ts-brand">Trust-Score</div>
      <div class="ts-tagline">CHECK KARO PHIR BUY KARO</div>
      <div class="ts-spinner" id="tsSpinner"></div>
      <div class="ts-message" id="tsMsg">Initializing scraper…</div>
      <div class="ts-progress-track">
        <div class="ts-progress-bar" id="tsBar"></div>
      </div>
      <div class="ts-stats">
        <span id="tsPct">3%</span>
        <span><span class="ts-count" id="tsCount">0</span> reviews scraped</span>
      </div>
      <div class="ts-stages">
        <div class="ts-stg active" id="tsStgScrape"><div class="ts-dot"></div>Scraping</div>
        <div class="ts-line"></div>
        <div class="ts-stg" id="tsStgAI"><div class="ts-dot"></div>AI Analysis</div>
        <div class="ts-line"></div>
        <div class="ts-stg" id="tsStgDone"><div class="ts-dot"></div>Done</div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(overlay);

  // ── Refs ────────────────────────────────────────────────────
  const elMsg = document.getElementById("tsMsg");
  const elBar = document.getElementById("tsBar");
  const elPct = document.getElementById("tsPct");
  const elCount = document.getElementById("tsCount");
  const elStgScrape = document.getElementById("tsStgScrape");
  const elStgAI = document.getElementById("tsStgAI");
  const elStgDone = document.getElementById("tsStgDone");
  const elSpinner = document.getElementById("tsSpinner");
  const elCard = overlay.querySelector(".ts-card");

  // ── API ─────────────────────────────────────────────────────
  function update(count, message) {
    const pct = Math.min(5 + Math.floor((count / 100) * 65), 75);
    if (elMsg) elMsg.textContent = message || `Scraped ${count} reviews…`;
    if (elBar) elBar.style.width = pct + "%";
    if (elPct) elPct.textContent = pct + "%";
    if (elCount) elCount.textContent = count;
  }

  // Stage transitions
  function setStage(stage) {
    [elStgScrape, elStgAI, elStgDone].forEach(s => {
      if (s) { s.classList.remove("active", "complete"); }
    });

    if (stage === "scraping") {
      elStgScrape?.classList.add("active");
    } else if (stage === "analyzing") {
      elStgScrape?.classList.add("complete");
      elStgAI?.classList.add("active");
      if (elBar) elBar.style.width = "82%";
      if (elPct) elPct.textContent = "82%";
      if (elMsg) elMsg.textContent = "Running AI analysis…";
    } else if (stage === "done") {
      elStgScrape?.classList.add("complete");
      elStgAI?.classList.add("complete");
      elStgDone?.classList.add("active");
      if (elBar) elBar.style.width = "100%";
      if (elPct) elPct.textContent = "100%";
      if (elMsg) elMsg.textContent = "Redirecting to results…";
      if (elSpinner) elSpinner.style.borderTopColor = "#34d399";
    }
  }

  function showError(message) {
    if (elSpinner) elSpinner.style.display = "none";
    if (elMsg) elMsg.textContent = "Scraping Failed";
    if (elBar) elBar.style.background = "#f87171";

    const errDiv = document.createElement("div");
    errDiv.innerHTML = `
      <div class="ts-error-msg">${message}</div>
      <a class="ts-home-btn" href="https://your-app-name.onrender.com/">← Go Home</a>
    `;
    elCard?.appendChild(errDiv);
  }

  // Expose globally for scraper scripts
  window.__tsOverlay = { update, setStage, showError };

  // ── Listen for messages from background.js ──────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "true_spot_analyzing") {
      setStage("analyzing");
      update(msg.count || 0, "Running AI analysis…");
    }
    if (msg.action === "true_spot_done") {
      setStage("done");
    }
    if (msg.action === "true_spot_error") {
      showError(msg.message || "An unknown error occurred.");
    }
  });

})();