// ============================================
// TRUST-SCORE — MYNTRA SCRAPER (Content Script)
// Injected into Myntra product/review pages
// ============================================

(async function () {
  "use strict";

  const MAX_REVIEWS = 100;

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

  // ── Step 1: Navigate to reviews page if needed ──────────
  let reviewsLink = document.querySelector("a[href*='/reviews/']");

  if (reviewsLink && !location.href.includes("/reviews/")) {
    reportProgress(0, "Navigating to reviews page…");
    window.location.assign(reviewsLink.href);
    return; // Page will reload, and this script will be re-injected by background.js
  }

  // ── Step 2: Extract product info ────────────────────────
  let productTitle = "Myntra Product";
  let productImage = null;

  try {
    const titleEl = document.querySelector("h1, .pdp-title, [class*='title']");
    if (titleEl) productTitle = titleEl.innerText.trim().substring(0, 120);
  } catch (e) { }

  try {
    const imgEl = document.querySelector(".image-grid-image, img.img-responsive, img[class*='image-grid']");
    if (imgEl) {
      const style = imgEl.getAttribute("style") || "";
      const match = style.match(/url\("?([^"]+)"?\)/);
      if (match) {
        productImage = match[1];
      } else {
        productImage = imgEl.src || null;
      }
    }
  } catch (e) { }

  // ── Step 3: Scroll and extract reviews ──────────────────
  reportProgress(0, "Starting review scrape…");

  let reviews = new Set();

  function extract() {
    // Primary selector
    let elements = document.querySelectorAll("div.user-review-reviewTextWrapper");

    // Fallback selectors
    if (!elements.length) {
      elements = document.querySelectorAll(
        "div[class*='userReviewTextWrapper'], div[class*='reviewTextWrapper'], div[class*='ReviewText']"
      );
    }

    for (let el of elements) {
      let text = (el.innerText || "").trim();
      if (text && text.length > 25) {
        reviews.add(text);
      }
    }
  }

  function waitForNewReviews(prevCount, timeout) {
    timeout = timeout || 3000;
    return new Promise(resolve => {
      let start = Date.now();
      let interval = setInterval(() => {
        extract();
        if (reviews.size > prevCount || Date.now() - start > timeout) {
          clearInterval(interval);
          resolve();
        }
      }, 200);
    });
  }

  let lastCount = 0;
  let stalls = 0;

  while (reviews.size < MAX_REVIEWS && stalls < 5) {
    // Aggressive scroll
    window.scrollTo(0, document.body.scrollHeight);
    window.scrollBy(0, -200);

    await waitForNewReviews(lastCount);

    // Report progress
    if (reviews.size > lastCount) {
      reportProgress(reviews.size, `Scraped ${reviews.size} reviews…`);
      stalls = 0;
    } else {
      stalls++;

      // Try clicking "Load More" buttons
      let loadMoreBtns = document.querySelectorAll(
        "[class*='loadMore'], [class*='LoadMore'], button"
      );
      for (let btn of loadMoreBtns) {
        let btnText = (btn.innerText || "").toLowerCase();
        if (btnText.includes("load more") || btnText.includes("show more") || btnText.includes("view more")) {
          btn.click();
          await new Promise(r => setTimeout(r, 1500));
          break;
        }
      }
    }

    if (reviews.size === lastCount && stalls >= 3) {
      reportProgress(reviews.size, "No more reviews found, finishing…");
      break;
    }

    lastCount = reviews.size;
  }

  // ── Step 4: Send results back ───────────────────────────
  let finalReviews = Array.from(reviews).slice(0, MAX_REVIEWS);

  console.log(`[Trust-Score Myntra] Done: ${finalReviews.length} reviews`);

  chrome.runtime.sendMessage({
    action: "scrapeComplete",
    reviews: finalReviews,
    productTitle: productTitle,
    productImage: productImage
  });

})();
