// background.js v6 - Google site-search → Real product page scraping
// Flow: Extract title → Google "site:amazon.in [title]" → Get real product URL → Open & scrape price

const BACKEND_URL = 'http://localhost:5000';
const activeSessions = {};

const PLATFORMS = [
    { name: 'Amazon', domain: 'amazon.in', icon: '' },
    { name: 'Flipkart', domain: 'flipkart.com', icon: '' },
    { name: 'Myntra', domain: 'myntra.com', icon: '' }
];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'start_multi_scrape') {
        console.log('[BG] Starting scrape for:', request.url, 'session:', request.session_id);
        orchestrateScrape(request.url, request.session_id);
        sendResponse({ status: 'started' });
        return true;
    }
});

async function orchestrateScrape(sourceUrl, sessionId) {
    activeSessions[sessionId] = { tabs: [] };
    const session = activeSessions[sessionId];

    // Normalize URL - add https:// if missing
    if (!sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://')) {
        sourceUrl = 'https://www.' + sourceUrl;
    }
    console.log('[BG] Normalized URL:', sourceUrl);

    try {
        // ===== STEP 1: Get product title from source page =====
        console.log('[BG] Step 1: Extracting product title...');
        const sourceTab = await chrome.tabs.create({ url: sourceUrl, active: false });
        session.tabs.push(sourceTab.id);
        await waitForTabLoad(sourceTab.id);

        const titleResults = await chrome.scripting.executeScript({
            target: { tabId: sourceTab.id },
            func: extractProductTitle
        });
        safeCloseTab(sourceTab.id);

        const productTitle = titleResults?.[0]?.result || '';
        if (!productTitle) {
            console.log('[BG] Could not extract title');
            await submitFinal(sessionId, 'Unknown Product', []);
            cleanup(session);
            return;
        }
        console.log('[BG] Title:', productTitle);

        const sourcePlatform = detectPlatform(sourceUrl);
        const searchQuery = cleanTitle(productTitle);
        console.log('[BG] Search query:', searchQuery);

        // ===== STEP 2: Search ALL platforms in PARALLEL =====
        console.log('[BG] Step 2: Searching all platforms in parallel...');

        const promises = PLATFORMS.map(platform => {
            if (platform.name === sourcePlatform) {
                // Source platform — try direct scrape first, fallback to Google
                return scrapeProductPrice(sourceUrl, session).then(async price => {
                    if (price !== null) {
                        return { store: platform.name, price, title: productTitle, url: sourceUrl, found: true };
                    }
                    // Direct scrape failed (e.g. clothing page needing size selection)
                    // Fall back to Google search for this platform
                    console.log(`[BG] ${platform.name}: Direct scrape failed, trying Google...`);
                    return searchAndScrape(platform, searchQuery, productTitle, session);
                });
            }
            // Other platforms — Google site-search → find link → scrape price
            return searchAndScrape(platform, searchQuery, productTitle, session);
        });

        const results = await Promise.all(promises);

        // Sort: found first (by price), then not found
        results.sort((a, b) => {
            if (a.found && !b.found) return -1;
            if (!a.found && b.found) return 1;
            return (a.price || 0) - (b.price || 0);
        });

        console.log('[BG] All done! Results:', results.length);
        await submitFinal(sessionId, productTitle, results);

    } catch (err) {
        console.error('[BG] Fatal error:', err);
        await submitFinal(sessionId, 'Error occurred', []);
    }

    cleanup(session);
}

// Search Google for a platform, find product link, scrape price — all in one
async function searchAndScrape(platform, searchQuery, productTitle, session) {
    try {
        const googleQuery = `${searchQuery} site:${platform.domain}`;
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}&hl=en&num=5`;

        const googleTab = await chrome.tabs.create({ url: googleUrl, active: false });
        session.tabs.push(googleTab.id);
        await waitForTabLoad(googleTab.id);

        const linkResults = await chrome.scripting.executeScript({
            target: { tabId: googleTab.id },
            func: extractFirstProductLink,
            args: [platform.domain]
        });
        safeCloseTab(googleTab.id);

        const productLink = linkResults?.[0]?.result;
        if (!productLink) {
            console.log(`[BG] ${platform.name}: No product found on Google`);
            // Try Google Shopping as last resort
            return await tryGoogleShopping(platform, searchQuery, productTitle, session);
        }

        console.log(`[BG] ${platform.name}: Found URL:`, productLink);
        const price = await scrapeProductPrice(productLink, session);

        if (price !== null) {
            console.log(`[BG] ${platform.name}: Price = Rs.${price}`);
            return { store: platform.name, price, title: productTitle, url: productLink, found: true };
        }

        // Product page scrape failed — try Google Shopping
        console.log(`[BG] ${platform.name}: Page scrape failed, trying Google Shopping...`);
        const shoppingResult = await tryGoogleShopping(platform, searchQuery, productTitle, session);
        // Keep the real product URL even if price comes from Shopping
        if (shoppingResult.found) {
            shoppingResult.url = productLink;
        }
        return shoppingResult;

    } catch (err) {
        console.error(`[BG] ${platform.name} error:`, err);
        return { store: platform.name, price: null, title: 'Search failed', url: '', found: false };
    }
}

// Fallback: Get price from Google Shopping results
async function tryGoogleShopping(platform, searchQuery, productTitle, session) {
    try {
        const shoppingUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&tbm=shop&hl=en`;
        const shopTab = await chrome.tabs.create({ url: shoppingUrl, active: false });
        session.tabs.push(shopTab.id);
        await waitForTabLoad(shopTab.id);

        const results = await chrome.scripting.executeScript({
            target: { tabId: shopTab.id },
            func: scrapeGoogleShoppingForStore,
            args: [platform.name]
        });
        safeCloseTab(shopTab.id);

        const price = results?.[0]?.result;
        if (price && price > 0) {
            console.log(`[BG] ${platform.name}: Got price from Google Shopping = Rs.${price}`);
            return { store: platform.name, price, title: productTitle, url: '', found: true };
        }
    } catch (err) {
        console.error(`[BG] Google Shopping fallback failed for ${platform.name}:`, err);
    }
    return { store: platform.name, price: null, title: 'Product not found', url: '', found: false };
}

// ===== Scrape price from a real product page =====
async function scrapeProductPrice(url, session) {
    try {
        const tab = await chrome.tabs.create({ url, active: false });
        session.tabs.push(tab.id);
        await waitForTabLoad(tab.id);

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractPriceFromPage
        });
        safeCloseTab(tab.id);

        return results?.[0]?.result || null;
    } catch (err) {
        console.error('[BG] Price scrape failed:', url, err);
        return null;
    }
}

// =====================================================
// INJECTED: Extract product title from source page
// =====================================================
function extractProductTitle() {
    const host = window.location.hostname;

    if (host.includes('amazon')) {
        const el = document.querySelector('#productTitle') || document.querySelector('#title');
        if (el) return el.innerText.trim();
    }
    if (host.includes('flipkart')) {
        const el = document.querySelector('span.VU-ZEz')
            || document.querySelector('span.B_NuCI')
            || document.querySelector('h1._9E25nV');
        if (el) return el.innerText.trim();
    }
    if (host.includes('myntra')) {
        const brand = document.querySelector('.pdp-title');
        const name = document.querySelector('.pdp-name');
        if (brand && name) return brand.innerText.trim() + ' ' + name.innerText.trim();
        if (name) return name.innerText.trim();
    }
    // Generic fallback
    const og = document.querySelector('meta[property="og:title"]');
    if (og) return og.getAttribute('content').trim();
    return document.title.replace(/ - Amazon.*$/, '').replace(/ \| Flipkart.*$/, '').replace(/ - Buy.*$/, '').trim();
}

// =====================================================
// INJECTED: Extract first real product link from Google
// =====================================================
function extractFirstProductLink(domain) {
    // Get all search result links
    const links = document.querySelectorAll('#search a[href], #rso a[href]');

    for (const link of links) {
        const href = link.href;

        // Must contain the target domain
        if (!href.includes(domain)) continue;

        // Skip Google redirect URLs, keep real URLs
        // Skip cache/similar/translate links
        if (href.includes('google.com/') && !href.includes('url?')) continue;
        if (href.includes('webcache.') || href.includes('translate.google')) continue;

        // For Amazon: must be a product page (contains /dp/ or /gp/)
        if (domain === 'amazon.in') {
            if (href.includes('/dp/') || href.includes('/gp/')) {
                console.log('[Google] Amazon product link:', href);
                return href;
            }
        }
        // For Flipkart: must contain /p/ (product page indicator)
        else if (domain === 'flipkart.com') {
            if (href.includes('/p/')) {
                console.log('[Google] Flipkart product link:', href);
                return href;
            }
        }
        // For Myntra: product pages have numeric IDs
        else if (domain === 'myntra.com') {
            if (/\/\d+\/buy/.test(href) || /\/\d+$/.test(href)) {
                console.log('[Google] Myntra product link:', href);
                return href;
            }
        }
    }

    // NO fallback — only return verified product page links
    // Returning homepage/search URLs causes wrong prices
    console.log('[Google] No product page found for', domain);
    return null;
}

// =====================================================
// INJECTED: Extract price for a store from Google Shopping
// =====================================================
function scrapeGoogleShoppingForStore(storeName) {
    // Google Shopping shows product cards with store names and prices
    // We need to find the card that matches our store and extract its price
    const storeAliases = {
        'Amazon': ['amazon', 'amazon.in'],
        'Flipkart': ['flipkart', 'flipkart.com'],
        'Myntra': ['myntra', 'myntra.com']
    };
    const aliases = storeAliases[storeName] || [storeName.toLowerCase()];
    
    // Strategy 1: Scan all text on the page for "[store] ... ₹price" patterns
    const allElements = document.querySelectorAll('*');
    
    for (const el of allElements) {
        // Only check leaf-ish elements (small text blocks)
        if (el.children.length > 5) continue;
        const text = (el.innerText || '').trim();
        if (text.length > 500 || text.length < 5) continue;
        
        const textLower = text.toLowerCase();
        const hasStore = aliases.some(a => textLower.includes(a));
        if (!hasStore) continue;
        
        // Found an element mentioning the store — extract price
        const priceMatch = text.match(/₹\s?([0-9,]+)/);
        if (priceMatch) {
            const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            if (p > 0) {
                console.log(`[Shopping] Found ${storeName} price:`, p, 'in:', text.substring(0, 80));
                return p;
            }
        }
    }
    
    // Strategy 2: Look for links containing the store domain, find price nearby
    for (const alias of aliases) {
        const links = document.querySelectorAll(`a[href*="${alias}"]`);
        for (const link of links) {
            // Walk up to find a container with a price
            let parent = link.parentElement;
            for (let i = 0; i < 8; i++) {
                if (!parent) break;
                const parentText = parent.innerText || '';
                const priceMatch = parentText.match(/₹\s?([0-9,]+)/);
                if (priceMatch) {
                    const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
                    if (p > 0) {
                        console.log(`[Shopping] Found ${storeName} price via link:`, p);
                        return p;
                    }
                }
                parent = parent.parentElement;
            }
        }
    }
    
    console.log(`[Shopping] No price found for ${storeName}`);
    return null;
}

// =====================================================
// INJECTED: Extract price from actual product page
// =====================================================
function extractPriceFromPage() {
    const host = window.location.hostname;

    function parsePrice(text) {
        if (!text) return null;
        const cleaned = text.replace(/\.\d{1,2}/, '').replace(/[^0-9]/g, '');
        const num = parseInt(cleaned, 10);
        return (isNaN(num) || num <= 0) ? null : num;
    }

    // ---- AMAZON ----
    if (host.includes('amazon')) {
        // CHECK: Is product unavailable? (only check the specific availability section)
        const availEl = document.querySelector('#availability, #outOfStock');
        if (availEl) {
            const availText = availEl.innerText.toLowerCase();
            if (availText.includes('currently unavailable') || availText.includes('out of stock')) {
                console.log('[Price] Amazon: Product is currently unavailable');
                return null;
            }
        }

        // Try JSON-LD first (most reliable)
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of ldScripts) {
            try {
                const data = JSON.parse(script.textContent);
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (item['@type'] === 'Product' && item.offers) {
                        const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                        for (const offer of offers) {
                            // Skip if availability says OutOfStock
                            if (offer.availability && offer.availability.includes('OutOfStock')) continue;
                            const p = parseInt(offer.price || offer.lowPrice || '0', 10);
                            if (p > 0) { console.log('[Price] Amazon (JSON-LD):', p); return p; }
                        }
                    }
                }
            } catch(e) {}
        }

        // Fallback: CSS selectors (expanded for clothing/variant pages)
        const selectors = [
            '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
            '.priceToPay .a-offscreen',
            '#corePrice_desktop .a-price .a-offscreen',
            '#priceblock_ourprice',
            '#priceblock_dealprice',
            '#price_inside_buybox',
            '#newBuyBoxPrice',
            '#tp_price_block_total_price_wc .a-offscreen',
            // Clothing/variant pages (price shown before size selection)
            '.a-price .a-offscreen',
            '#apex_offerDisplay_desktop .a-price .a-offscreen',
            '#corePrice_feature_div .a-price .a-offscreen',
            '.reinventPricePriceToPayMargin .a-offscreen',
            '#sns-base-price .a-offscreen',
            '.swatchMinimalPrice .a-offscreen',
            '#price .a-offscreen',
            '#twister-plus-price-data-price',
            // Deal/sale price
            '#priceblock_saleprice',
            '.apexPriceToPay .a-offscreen'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const txt = (el.innerText || el.textContent || el.getAttribute('value') || '').trim();
                if (txt && /\d/.test(txt)) {
                    const p = parsePrice(txt);
                    if (p) { console.log('[Price] Amazon (CSS):', p, 'sel:', sel); return p; }
                }
            }
        }

        // Last resort: search for price pattern in the right-side product info area
        const rightCol = document.querySelector('#rightCol, #desktop_buybox, #buybox, #centerCol');
        if (rightCol) {
            const text = rightCol.innerText;
            const priceMatch = text.match(/₹\s?([0-9,]+)/);
            if (priceMatch) {
                const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
                if (p > 0) { console.log('[Price] Amazon (text scan):', p); return p; }
            }
        }
    }

    // ---- FLIPKART ----
    if (host.includes('flipkart')) {
        // CHECK: Is product unavailable?
        const fpText = document.body.innerText || '';
        if (fpText.includes('Sold Out') || fpText.includes('Coming Soon') || fpText.includes('currently unavailable')) {
            console.log('[Price] Flipkart: Product is unavailable');
            return null;
        }
        // METHOD 1 (BEST): JSON-LD structured data — ads NEVER have this
        // Flipkart embeds: <script type="application/ld+json">{"@type":"Product","offers":{"price":"1999"}}</script>
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of ldScripts) {
            try {
                const data = JSON.parse(script.textContent);
                // Can be a single object or an array
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (item['@type'] === 'Product' && item.offers) {
                        const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                        for (const offer of offers) {
                            const p = parseInt(offer.price || offer.lowPrice || '0', 10);
                            if (p > 0) {
                                console.log('[Price] Flipkart (JSON-LD):', p);
                                return p;
                            }
                        }
                    }
                }
            } catch(e) { /* invalid JSON, skip */ }
        }

        // METHOD 2: meta tag og:price or product:price
        const metaPrice = document.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]');
        if (metaPrice) {
            const p = parseInt(metaPrice.getAttribute('content'), 10);
            if (p > 0) {
                console.log('[Price] Flipkart (meta tag):', p);
                return p;
            }
        }

        // METHOD 3: "Buy at ₹X,XXX" button text
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
            const txt = btn.innerText || '';
            const match = txt.match(/(?:Buy\s*(?:at|now)?|₹)\s*₹?\s*([0-9,]+)/i);
            if (match && txt.toLowerCase().includes('buy')) {
                const p = parseInt(match[1].replace(/,/g, ''), 10);
                if (p > 0) {
                    console.log('[Price] Flipkart (Buy button):', p);
                    return p;
                }
            }
        }

        console.log('[Price] Flipkart: could not extract price');
    }

    // ---- MYNTRA ----
    if (host.includes('myntra')) {
        // CHECK: Are we on an actual product page? (not homepage/search)
        const url = window.location.href;
        const path = window.location.pathname;
        if (path === '/' || path === '' || url.includes('/shop/') || !(/\/\d+/.test(path))) {
            console.log('[Price] Myntra: Not a product page (homepage/search)');
            return null;
        }

        // Check if product page elements exist
        const pdpName = document.querySelector('.pdp-name, .pdp-title');
        if (!pdpName) {
            console.log('[Price] Myntra: No product info found on page');
            return null;
        }

        // JSON-LD first
        const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of ldScripts) {
            try {
                const data = JSON.parse(script.textContent);
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                    if (item['@type'] === 'Product' && item.offers) {
                        const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
                        for (const offer of offers) {
                            const p = parseInt(offer.price || offer.lowPrice || '0', 10);
                            if (p > 0) { console.log('[Price] Myntra (JSON-LD):', p); return p; }
                        }
                    }
                }
            } catch(e) {}
        }

        // CSS selectors fallback
        const selectors = [
            '.pdp-price strong',
            '.pdp-discount-container .pdp-price',
            '.pdp-mrp .pdp-price'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const txt = el.innerText.trim();
                if (txt && /\d/.test(txt)) {
                    const p = parsePrice(txt);
                    if (p) { console.log('[Price] Myntra:', p); return p; }
                }
            }
        }
    }

    // NO generic fallback — only return prices from verified product pages
    // Generic fallback caused wrong prices from homepages/search pages
    console.log('[Price] No price found on this page');
    return null;
}

// =====================================================
// UTILITIES
// =====================================================
function detectPlatform(url) {
    if (url.includes('amazon')) return 'Amazon';
    if (url.includes('flipkart')) return 'Flipkart';
    if (url.includes('myntra')) return 'Myntra';
    return 'Unknown';
}

function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 12000);
        function listener(id, info) {
            if (id === tabId && info.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 2500); // 2.5s for dynamic content
            }
        }
        chrome.tabs.onUpdated.addListener(listener);
    });
}

function safeCloseTab(tabId) {
    try { chrome.tabs.remove(tabId); } catch(e) {}
}

function cleanup(session) {
    setTimeout(() => {
        for (const tabId of session.tabs) {
            safeCloseTab(tabId);
        }
    }, 3000);
}

function cleanTitle(title) {
    return title
        .replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '')
        .replace(/[|–—:]/g, ' ')
        .replace(/\b(with|for|and|the|in|on|of|by|from|pack|set|buy|online|india|price|rs|inr)\b/gi, '')
        .replace(/\s+/g, ' ').trim()
        .split(' ').slice(0, 8).join(' ');
}

async function submitFinal(sessionId, productTitle, results) {
    try {
        await fetch(`${BACKEND_URL}/api/submit_all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, product_title: productTitle, results })
        });
        console.log('[BG] Results submitted to backend');
    } catch (err) {
        console.error('[BG] Submit failed:', err);
    }
}
