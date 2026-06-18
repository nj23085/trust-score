// ============================================
// TRUST-SCORE — Extension Popup Logic
// ============================================

document.addEventListener("DOMContentLoaded", () => {

  const statusDetect = document.getElementById("statusDetect");
  const statusSupported = document.getElementById("statusSupported");
  const statusUnsupported = document.getElementById("statusUnsupported");
  const statusScraping = document.getElementById("statusScraping");
  const platformBadge = document.getElementById("platformBadge");
  const platformIcon = document.getElementById("platformIcon");
  const platformName = document.getElementById("platformName");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const progressBar = document.getElementById("progressBar");
  const scrapeMsg = document.getElementById("scrapeMsg");
  const scrapeCount = document.getElementById("scrapeCount");

  const PLATFORM_INFO = {
    amazon: { icon: "🛒", name: "Amazon", color: "#ff9900" },
    flipkart: { icon: "🛍️", name: "Flipkart", color: "#2874f0" },
    myntra: { icon: "👕", name: "Myntra", color: "#ff3e6c" }
  };

  let currentPlatform = null;
  let currentUrl = null;
  let currentTabId = null;

  // ── Detect the active tab ───────────────────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]) {
      showUnsupported();
      return;
    }

    currentUrl = tabs[0].url;
    currentTabId = tabs[0].id;

    // Detect platform
    if (/amazon\.(in|com)/i.test(currentUrl)) currentPlatform = "amazon";
    else if (/flipkart\.com/i.test(currentUrl)) currentPlatform = "flipkart";
    else if (/myntra\.com/i.test(currentUrl)) currentPlatform = "myntra";

    if (currentPlatform) {
      showSupported(currentPlatform);
    } else {
      showUnsupported();
    }
  });

  // ── Show supported state ────────────────────────────────
  function showSupported(platform) {
    statusDetect.style.display = "none";
    statusUnsupported.style.display = "none";
    statusSupported.style.display = "flex";

    const info = PLATFORM_INFO[platform];
    platformIcon.textContent = info.icon;
    platformName.textContent = info.name;
    platformBadge.style.borderColor = info.color;
    platformBadge.style.color = info.color;
  }

  function showUnsupported() {
    statusDetect.style.display = "none";
    statusSupported.style.display = "none";
    statusUnsupported.style.display = "flex";
  }

  function showScraping() {
    statusSupported.style.display = "none";
    statusScraping.style.display = "flex";
  }

  // ── Analyze button click ────────────────────────────────
  analyzeBtn.addEventListener("click", () => {
    if (!currentPlatform || !currentUrl) return;

    showScraping();

    // Tell background to start scraping
    chrome.runtime.sendMessage({
      action: "startScrape",
      url: currentUrl,
      platform: currentPlatform,
      fromWebsite: false,
      originTabId: currentTabId
    });
  });

  // ── Listen for progress updates ─────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "scrapeProgress") {
      scrapeMsg.textContent = msg.message || `Scraped ${msg.count} reviews…`;
      scrapeCount.textContent = `${msg.count} reviews`;
      let pct = Math.min(5 + Math.floor((msg.count / 100) * 90), 95);
      progressBar.style.width = pct + "%";
    }

    if (msg.action === "scrapeComplete" || msg.action === "scrapeError") {
      // Popup will close when tab navigates to results
      if (msg.action === "scrapeError") {
        scrapeMsg.textContent = "Error: " + (msg.message || "Unknown error");
        progressBar.style.background = "#ef4444";
      } else {
        scrapeMsg.textContent = "Analysis complete! Opening results…";
        progressBar.style.width = "100%";
      }
    }
  });
});
