// ============================================
// TRUST-SCORE — AMAZON SCRAPER (Content Script)
// Logic mirrors Python scraper exactly:
//   1. Go to clean review URL
//   2. Wait for span[data-hook='review-body']
//   3. Extract all visible reviews (dedup by key)
//   4. Scroll down (scrollBy chunks like Python)
//   5. Find "Show * review" button by TEXT (XPATH equivalent)
//      Fallback: li.a-last a  (next page button)
//   6. Break ONLY when: button not found AND no new reviews since last loop
// ============================================

(async function () {
  "use strict";

  const MAX_REVIEWS = 100;
  const STORAGE_KEY = "true_spot_amazon_reviews";
  const STORAGE_META = "true_spot_amazon_meta";

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function reportProgress(count, message) {
    // Update the on-page overlay (injected by overlay.js)
    if (window.__tsOverlay) {
      window.__tsOverlay.update(count, message || `Scraped ${count} reviews…`);
    }
    // Also send to background.js for origin tab updates
    try {
      chrome.runtime.sendMessage({
        action: "scrapeProgress",
        count,
        message: message || `Scraped ${count} reviews…`
      });
    } catch (e) { }
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function waitForElement(selector, timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  async function waitForMoreReviews(countBefore, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const now = document.querySelectorAll("span[data-hook='review-body']").length;
      if (now > countBefore) return true;
      await sleep(300);
    }
    return false;
  }

  // ── Build clean review URL (no filters) ─────────────────────────────────────
  function buildCleanUrl(hostname, asin) {
    return `https://${hostname}/product-reviews/${asin}/?reviewerType=all_reviews&sortBy=recent`;
  }

  // ── Amazon login detection ───────────────────────────────────
  // Returns true if the user appears to be signed in to Amazon.
  function isAmazonLoggedIn() {
    // Method 1: Hard redirect to Amazon sign-in page
    if (location.hostname.includes("amazon") &&
      (location.pathname.startsWith("/ap/signin") || location.pathname.startsWith("/gp/sign-in"))) {
      return false;
    }

    // Method 2: sign-in form present on this page
    if (document.getElementById("ap_email") || document.getElementById("ap_password")) {
      return false;
    }

    // Method 3: nav greeting says "Hello, Sign in" (not signed in)
    const greet = document.querySelector("#nav-link-accountList .nav-line-1") ||
      document.getElementById("nav-line-1");
    if (greet) {
      const t = (greet.innerText || greet.textContent || "").toLowerCase().trim();
      if (t.includes("sign in")) return false;
      if (t.startsWith("hello,") && !t.includes("sign in")) return true;
    }

    // Method 4: full account link text
    const acctLink = document.getElementById("nav-link-accountList");
    if (acctLink) {
      const t = (acctLink.innerText || acctLink.textContent || "").toLowerCase();
      if (t.includes("sign in") && !t.match(/hello,\s+\w/)) return false;
    }

    // Default: assume signed in (scraper will fail naturally if not)
    return true;
  }

  // ── Find "Show X more reviews" button by text — mirrors Python XPATH ────────
  // Python: //*[contains(text(),'Show') and contains(text(),'review')]
  function findShowMoreButton() {
    // Method 1: data-hook attribute
    const byHook = document.querySelector("a[data-hook='show-more-button']");
    if (byHook && byHook.offsetParent !== null) return byHook;

    // Method 2: text content match (mirrors Python XPATH exactly)
    const candidates = Array.from(document.querySelectorAll("a, button, span"));
    for (const el of candidates) {
      const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (txt.includes("show") && txt.includes("review") && el.offsetParent !== null) {
        return el;
      }
    }

    return null;
  }

  // ── Find next-page button — mirrors Python: li.a-last a ─────────────────────
  function findNextPageButton() {
    const el = document.querySelector("li.a-last a");
    if (el && el.offsetParent !== null) return el;
    return null;
  }

  // ── Scroll down in chunks — mirrors Python scrollBy logic ───────────────────
  // Python: scrollBy(0, 1000) x3, then scrollBy(0, 800)
  async function scrollDown() {
    for (let i = 0; i < 3; i++) {
      window.scrollBy(0, 1000);
      await sleep(200);
    }
    window.scrollBy(0, 800);
    await sleep(300);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 0: Check Amazon login status — if not signed in, ask background.js
  //         to open a dedicated sign-in tab, wait for the user, then reload us.
  // ─────────────────────────────────────────────────────────────────────────────
  const currentUrl = location.href;

  // Wait a moment for the page nav to render before checking login
  await sleep(800);

  if (!isAmazonLoggedIn()) {
    console.log("[Trust-Score] Amazon not signed in — requesting login tab from background");

    // Show a clean "please sign in" waiting state on the overlay
    if (window.__tsOverlay) {
      window.__tsOverlay.showLoginWaiting();
    } else {
      reportProgress(0, "Please sign in to Amazon — a sign-in tab will open…");
    }

    // Tell background.js to open the sign-in tab and handle everything
    try {
      chrome.runtime.sendMessage({ action: "needsAmazonLogin" });
    } catch (e) {
      console.error("[Trust-Score] Could not send needsAmazonLogin:", e);
    }

    // This script stops here. background.js will reload this tab after sign-in,
    // which re-injects overlay.js + amazon.js and the scrape runs normally.
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Product page → navigate to clean reviews URL
  // ─────────────────────────────────────────────────────────────────────────────

  if (!currentUrl.includes("product-reviews")) {
    let productTitle = "Amazon Product";
    let productImage = null;

    const titleEl = await waitForElement("#productTitle", 8000);
    if (titleEl) {
      productTitle = (titleEl.innerText || titleEl.textContent || "").trim().substring(0, 120);
    }

    try {
      const img = document.getElementById("landingImage");
      if (img) productImage = img.src;
    } catch (e) { }

    const asinMatch = currentUrl.match(/\/(?:dp|product)\/([A-Z0-9]{10})/);
    const asin = asinMatch ? asinMatch[1] : null;

    if (!asin) {
      chrome.runtime.sendMessage({
        action: "scrapeComplete", reviews: [], productTitle, productImage
      });
      return;
    }

    chrome.storage.local.set({
      [STORAGE_KEY]: [],
      [STORAGE_META]: { productTitle, productImage, asin }
    });

    reportProgress(0, `Found: ${productTitle.substring(0, 40)}… going to reviews`);
    window.location.assign(buildCleanUrl(location.hostname, asin));
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: We are on the reviews page — restore state
  // ─────────────────────────────────────────────────────────────────────────────
  const stored = await new Promise(r =>
    chrome.storage.local.get([STORAGE_KEY, STORAGE_META], r)
  );

  let allReviews = stored[STORAGE_KEY] || [];
  let meta = stored[STORAGE_META] || {
    productTitle: "Amazon Product", productImage: null, asin: null
  };

  const asinFromUrl = currentUrl.match(/product-reviews\/([A-Z0-9]{10})/);
  if (asinFromUrl) meta.asin = asinFromUrl[1];

  const asin = meta.asin;
  const hostname = location.hostname;
  let { productTitle, productImage } = meta;

  const seenKeys = new Set(allReviews.map(r => r.substring(0, 500)));

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Wait for reviews to appear in DOM
  // ─────────────────────────────────────────────────────────────────────────────
  reportProgress(allReviews.length, "Waiting for reviews to load…");

  const firstReview = await waitForElement("span[data-hook='review-body']", 15000);
  if (!firstReview) {
    console.log("[Trust-Score] No reviews found — CAPTCHA or empty product");
    chrome.runtime.sendMessage({
      action: "scrapeComplete", reviews: allReviews, productTitle, productImage
    });
    return;
  }

  await sleep(500);

  if (productTitle === "Amazon Product") {
    try {
      const t = document.querySelector("a[data-hook='product-link']");
      if (t) productTitle = t.innerText.trim().substring(0, 120);
    } catch (e) { }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Extract all currently visible unseen reviews into allReviews
  // ─────────────────────────────────────────────────────────────────────────────
  function extractNewReviews() {
    let added = 0;
    document.querySelectorAll("span[data-hook='review-body']").forEach(el => {
      const text = (el.innerText || "").trim();
      if (!text || text.length < 5) return;
      const key = text.substring(0, 500);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allReviews.push(text);
        added++;
      }
    });
    return added;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Main loop — mirrors Python while loop exactly
  //
  // Python:
  //   while len(all_reviews) < max_reviews:
  //     wait for reviews in DOM
  //     extract reviews
  //     scroll down
  //     find "Show * review" btn → click
  //     fallback: find li.a-last a → click
  //     if not clicked AND no new reviews → break
  //     prev_count = new_count
  let prevCount = 0;
  let stalls = 0;

  while (allReviews.length < MAX_REVIEWS) {

    // Wait for at least one review-body to be present
    await waitForElement("span[data-hook='review-body']", 8000);

    // Extract whatever is visible
    extractNewReviews();

    reportProgress(allReviews.length, `Scraped ${allReviews.length} reviews…`);
    console.log(`[Trust-Score] Total so far: ${allReviews.length}`);

    if (allReviews.length >= MAX_REVIEWS) break;

    // Scroll down (mirrors Python)
    await scrollDown();

    // Extract after scroll — catches lazy-loaded reviews
    extractNewReviews();

    // Save accumulated reviews to storage to persist state across full page reloads (pagination)
    chrome.storage.local.set({
      [STORAGE_KEY]: allReviews
    });

    let clicked = false;

    // ── Try "Show more reviews" button (text match mirrors Python XPATH) ──────
    const showMoreBtn = findShowMoreButton();
    if (showMoreBtn) {
      showMoreBtn.scrollIntoView({ block: "center" });
      await sleep(2000);                          // Python: time.sleep(2)
      const countBefore = document.querySelectorAll("span[data-hook='review-body']").length;
      try {
        showMoreBtn.click();
      } catch (e) {
        showMoreBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
      await sleep(800);                           // Python: time.sleep(0.8)
      await waitForMoreReviews(countBefore, 8000);
      clicked = true;
      console.log("[Trust-Score] Clicked show-more button");
    }

    // ── Fallback: next page button li.a-last a ────────────────────────────────
    if (!clicked) {
      const nextBtn = findNextPageButton();
      if (nextBtn) {
        // Save state before navigating
        chrome.storage.local.set({ [STORAGE_KEY]: allReviews });

        const nextUrl = nextBtn.href || nextBtn.getAttribute("href");
        if (nextUrl) {
          console.log("[Trust-Score] Navigating to next page: " + nextUrl);
          window.location.assign(nextUrl);
          return; // Exit script, wait for re-injection
        } else {
          nextBtn.scrollIntoView({ block: "center" });
          await sleep(500);
          try {
            nextBtn.click();
          } catch (e) {
            nextBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }
          await sleep(5000);
          return; // Exit script, wait for re-injection
        }
      }
    }

    const newCount = allReviews.length;

    // ── Break condition — mirrors Python exactly ──────────────────────────────
    // Python: if not clicked and new_count == prev_count: break
    if (!clicked && newCount === prevCount) {
      console.log("[Trust-Score] No button + no new reviews — stopping");
      break;
    }

    if (newCount === prevCount) {
      stalls++;
      console.log(`[Trust-Score] Stalled (${stalls}/3) — no new reviews after action`);
      if (stalls >= 3) {
        console.log("[Trust-Score] Stalled 3 times — stopping");
        break;
      }
    } else {
      stalls = 0;
    }

    prevCount = newCount;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5: Done
  // ─────────────────────────────────────────────────────────────────────────────
  const finalReviews = allReviews.slice(0, MAX_REVIEWS);
  console.log(`[Trust-Score] DONE — ${finalReviews.length} reviews`);

  chrome.storage.local.remove([STORAGE_KEY, STORAGE_META]);
  chrome.runtime.sendMessage({
    action: "scrapeComplete",
    reviews: finalReviews,
    productTitle,
    productImage
  });

})();