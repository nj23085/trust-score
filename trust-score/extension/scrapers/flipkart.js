// ============================================
// TRUST-SCORE — FLIPKART SCRAPER (Content Script)
// Strategy:
//   1. Transform /p/ → /product-reviews/ (direct URL nav)
//   2. Extract reviews from current page
//   3. Navigate to ?page=N for pagination
//   4. Accumulate reviews across pages via chrome.storage.session
// ============================================

(async function () {
  "use strict";

  const MAX_REVIEWS = 100;
  const STORAGE_KEY = "true_spot_flipkart_reviews";
  const STORAGE_META = "true_spot_flipkart_meta";

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
    } catch (e) {}
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  console.log("[Trust-Score Flipkart] Scraper loaded on:", location.href);

  // ── Step 1: Check if on product page → redirect to reviews ──
  let currentUrl = location.href;

  if (!currentUrl.includes("/product-reviews/")) {
    // Extract product info before navigating away
    let productTitle = "Flipkart Product";
    let productImage = null;

    try {
      let titleEl = document.querySelector("span.VU-ZEz, h1.yhB1nd, h1 span, .B_NuCI");
      if (!titleEl) titleEl = document.querySelector("h1, [class*='title']");
      if (titleEl) productTitle = titleEl.innerText.trim().substring(0, 120);
    } catch (e) {}

    try {
      let imgs = document.querySelectorAll("img");
      let best = null, bestArea = 0;
      for (let img of imgs) {
        let src = img.src || "";
        if (!src || src.includes("data:") || src.includes("svg")) continue;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        let area = w * h;
        if (area > bestArea && w > 100 && h > 100) {
          bestArea = area;
          best = src;
        }
      }
      productImage = best;
    } catch (e) {}

    // Save product info + empty review list for accumulation
    chrome.storage.local.set({
      [STORAGE_KEY]: [],
      [STORAGE_META]: {
        productTitle,
        productImage,
        page: 1,
        emptyPages: 0
      }
    });

    reportProgress(0, "Navigating to reviews page…");

    // Transform URL: /p/ → /product-reviews/
    if (currentUrl.includes("/p/")) {
      let reviewsUrl = currentUrl.replace(/\/p\//, "/product-reviews/");
      reviewsUrl = reviewsUrl.split("?")[0]; // Clean query params
      console.log("[Trust-Score Flipkart] Redirecting to:", reviewsUrl);
      window.location.assign(reviewsUrl);
      return; // background.js will re-inject on load
    }

    // Fallback: look for review link in DOM
    let reviewLink = document.querySelector("a[href*='product-reviews']");
    if (reviewLink) {
      let href = reviewLink.getAttribute("href");
      if (href.startsWith("/")) href = location.origin + href;
      window.location.assign(href);
      return;
    }

    // Can't find reviews page — report error
    chrome.runtime.sendMessage({
      action: "scrapeComplete",
      reviews: [],
      productTitle,
      productImage
    });
    return;
  }

  // ── Step 2: We're on /product-reviews/ — load accumulated state ──
  await sleep(2000); // Wait for page content to render

  let stored = await new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY, STORAGE_META], resolve);
  });

  let accumulatedReviews = stored[STORAGE_KEY] || [];
  let meta = stored[STORAGE_META] || {
    productTitle: "Flipkart Product",
    productImage: null,
    page: 1,
    emptyPages: 0
  };

  let productTitle = meta.productTitle;
  let productImage = meta.productImage;
  let currentPage = meta.page;
  let emptyPages = meta.emptyPages;

  // Also try to grab title from reviews page if we don't have one
  if (productTitle === "Flipkart Product") {
    try {
      let titleEl = document.querySelector("span.VU-ZEz, h1.yhB1nd, h1 span, .B_NuCI, [class*='title']");
      if (titleEl) productTitle = titleEl.innerText.trim().substring(0, 120);
    } catch (e) {}
  }

  console.log(`[Trust-Score Flipkart] Page ${currentPage}, accumulated: ${accumulatedReviews.length} reviews`);
  reportProgress(accumulatedReviews.length, `Extracting page ${currentPage}…`);

  // ── Step 3: Extract reviews from this page ──────────────
  let newReviews = [];
  let existingKeys = new Set(accumulatedReviews.map(r => r.substring(0, 150)));

  // Flipkart review cards: each contains rating + review text + user info
  // The review body is the longest text block, typically 40+ chars
  let allElements = document.querySelectorAll("div, p, span");

  for (let el of allElements) {
    if (el.children.length > 5) continue;

    // Get text
    let text = "";
    for (let node of el.childNodes) {
      if (node.nodeType === 3) text += node.textContent;
    }
    text = text.trim();
    if (text.length < 40) {
      text = (el.innerText || "").trim();
    }

    // Must be review-length
    if (text.length < 40 || text.length > 3000) continue;
    if (text.split(" ").length < 5) continue;

    // Filter noise
    let lower = text.toLowerCase();
    if (lower === "read more" || lower.startsWith("read more")) continue;
    if (lower.includes("certified buyer")) continue;
    if (lower.includes("report abuse")) continue;
    if (lower.includes("add to cart") || lower.includes("buy now")) continue;
    if (lower.includes("all reviews") && text.length < 60) continue;
    if (/^\d+\s*(month|day|year|week|hour)s?\s*ago$/i.test(text)) continue;
    if (/^(color|ram|storage|size|type|model)\s*:/i.test(text)) continue;
    if (text.split("\n").length > 6) continue;

    // Dedup
    let key = text.substring(0, 150);
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      newReviews.push(text);
    }
  }

  console.log(`[Trust-Score Flipkart] Found ${newReviews.length} new reviews on page ${currentPage}`);

  // Add to accumulated list
  accumulatedReviews = accumulatedReviews.concat(newReviews);

  // Track empty pages
  if (newReviews.length === 0) {
    emptyPages++;
  } else {
    emptyPages = 0;
  }

  reportProgress(accumulatedReviews.length, `Scraped ${accumulatedReviews.length} reviews (page ${currentPage})…`);

  // ── Step 4: Decide whether to continue or finish ────────
  let shouldStop = (
    accumulatedReviews.length >= MAX_REVIEWS ||
    emptyPages >= 2 ||
    currentPage >= 15
  );

  if (shouldStop) {
    // ── DONE — send results back ──
    let finalReviews = accumulatedReviews
      .filter(r => r.length > 40 && r.split(" ").length >= 5)
      .slice(0, MAX_REVIEWS);

    console.log(`[Trust-Score Flipkart] DONE: ${finalReviews.length} reviews`);

    // Clean up storage
    chrome.storage.local.remove([STORAGE_KEY, STORAGE_META]);

    chrome.runtime.sendMessage({
      action:       "scrapeComplete",
      reviews:      finalReviews,
      productTitle: productTitle,
      productImage: productImage
    });
  } else {
    // ── Go to next page ──
    let nextPage = currentPage + 1;

    // Save state for the next page injection
    chrome.storage.local.set({
      [STORAGE_KEY]: accumulatedReviews,
      [STORAGE_META]: {
        productTitle,
        productImage,
        page: nextPage,
        emptyPages
      }
    });

    // Navigate to next page via URL
    let baseUrl = location.href.split("?")[0];
    let nextUrl = baseUrl + `?page=${nextPage}`;
    console.log(`[Trust-Score Flipkart] → Next page: ${nextUrl}`);

    reportProgress(accumulatedReviews.length, `Going to page ${nextPage}…`);
    window.location.assign(nextUrl);
    // background.js will re-inject this script on the new page
  }

})();
