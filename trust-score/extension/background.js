// ============================================
// TRUST-SCORE — BACKGROUND SERVICE WORKER
// Orchestrates scraping in foreground tabs
// ============================================

const API_BASE = "https://trust-score-59lg.onrender.com";

// ── Detect platform from URL ────────────────────────────────
function detectPlatform(url) {
  if (/amazon\.(in|com)/i.test(url)) return "amazon";
  if (/flipkart\.com/i.test(url)) return "flipkart";
  if (/myntra\.com/i.test(url)) return "myntra";
  return null;
}

// ── Listen for messages from popup.js or website_bridge ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ---------- START SCRAPE (from popup or website bridge) ----------
  if (msg.action === "startScrape") {
    const { url, platform, fromWebsite, isHomePage } = msg;
    const originTabId = msg.originTabId || (sender.tab ? sender.tab.id : null);

    console.log(`[Trust-Score] Starting ${platform} scrape for: ${url}`);
    console.log(`[Trust-Score] Origin tab: ${originTabId}`);

    let priceSessionId = null;
    fetch(`${API_BASE}/api/price/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    })
      .then(r => r.json())
      .then(d => {
        if (d.status === 'success') {
          priceSessionId = d.session_id;
          console.log('[Trust-Score-Price] Simultaneous price session started:', priceSessionId);
          priceOrchestrateAll(url, priceSessionId);
        }
      })
      .catch(err => console.warn('[Trust-Score-Price] Could not start price session:', err));

    chrome.tabs.create({ url, active: true }, (scrapeTab) => {

      let scrapeTabId = scrapeTab.id;
      let lastInjectedUrl = '';

      function injectScraper(tabId) {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.warn("[Trust-Score] Tab gone:", chrome.runtime.lastError.message);
            return;
          }
          const tabUrl = tab.url || '';
          if (tabUrl === lastInjectedUrl) {
            console.log(`[Trust-Score] Skipping duplicate injection for: ${tabUrl.substring(0, 80)}`);
            return;
          }
          lastInjectedUrl = tabUrl;

          console.log(`[Trust-Score] Injecting overlay + ${platform} scraper into tab ${tabId} (${tabUrl.substring(0, 80)})…`);

          chrome.scripting.executeScript({
            target: { tabId },
            files: ["scrapers/overlay.js"]
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("[Trust-Score] Overlay injection error:", chrome.runtime.lastError.message);
              return;
            }
            chrome.scripting.executeScript({
              target: { tabId },
              files: [`scrapers/${platform}.js`]
            }, () => {
              if (chrome.runtime.lastError) {
                console.error("[Trust-Score] Scraper injection error:", chrome.runtime.lastError.message);
              } else {
                console.log(`[Trust-Score] Scraper injected successfully`);
              }
            });
          });
        });
      }

      const tabListener = (tabId, info) => {
        if (tabId !== scrapeTabId || info.status !== "complete") return;
        injectScraper(tabId);
      };

      chrome.tabs.onUpdated.addListener(tabListener);

      chrome.tabs.get(scrapeTabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab && tab.status === "complete") {
          console.log("[Trust-Score] Tab already complete at listener attach — injecting immediately");
          injectScraper(scrapeTabId);
        }
      });

      const progressListener = (message, msgSender) => {
        if (!msgSender.tab || msgSender.tab.id !== scrapeTabId) return;

        if (message.action === "scrapeProgress") {
          console.log(`[Trust-Score] Progress: ${message.count} reviews`);
          if (originTabId) {
            chrome.tabs.sendMessage(originTabId, {
              action: "scrapeProgress",
              count: message.count,
              message: message.message || `Scraped ${message.count} reviews…`
            }).catch(() => { });
          }
        }

        if (message.action === "scrapeComplete") {
          chrome.runtime.onMessage.removeListener(progressListener);
          chrome.tabs.onUpdated.removeListener(tabListener);
          if (typeof removedListener !== 'undefined') {
            chrome.tabs.onRemoved.removeListener(removedListener);
          }

          const reviews = message.reviews || [];
          const productTitle = message.productTitle || "Product";
          const productImage = message.productImage || null;

          console.log(`[Trust-Score] Scrape done: ${reviews.length} reviews`);

          chrome.tabs.sendMessage(scrapeTabId, {
            action: "true_spot_analyzing",
            count: reviews.length
          }).catch(() => { });

          if (originTabId) {
            chrome.tabs.sendMessage(originTabId, {
              action: "scrapeProgress",
              count: reviews.length,
              message: "Running AI analysis…"
            }).catch(() => { });
          }

          // If no reviews found, still proceed so price comparison works
          const analyzeEndpoint = reviews.length === 0
            ? `${API_BASE}/api/analyze/no-reviews`
            : `${API_BASE}/api/analyze`;

          fetch(analyzeEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform,
              product_title: productTitle,
              product_image: productImage,
              product_link: url,
              reviews,
              source: "home"
            })
          })
            .then(r => r.json())
            .then(data => {
              if (data.error) {
                console.error("[Trust-Score] API error:", data.error);
                chrome.tabs.remove(scrapeTabId).catch(() => { });
                if (originTabId) {
                  chrome.tabs.sendMessage(originTabId, {
                    action: "scrapeError",
                    message: data.error
                  }).catch(() => { });
                }
                return;
              }

              const psidParam = priceSessionId ? `?psid=${priceSessionId}` : '';
              const resultUrl = `${API_BASE}/result/${data.job_id}${psidParam}`;
              console.log(`[Trust-Score] Redirecting origin tab to: ${resultUrl}`);

              chrome.tabs.remove(scrapeTabId).catch(() => { });

              if (originTabId) {
                chrome.tabs.update(originTabId, { url: resultUrl, active: true });
              } else {
                chrome.tabs.create({ url: resultUrl });
              }
            })
            .catch(err => {
              console.error("[Trust-Score] Fetch error:", err);
              chrome.tabs.remove(scrapeTabId).catch(() => { });
              if (originTabId) {
                chrome.tabs.sendMessage(originTabId, {
                  action: "scrapeError",
                  message: "Could not connect to Trust-Score server. Is it running?"
                }).catch(() => { });
              }
            });
        }
      };

      chrome.runtime.onMessage.addListener(progressListener);

      const removedListener = (tabId) => {
        if (tabId !== scrapeTabId) return;
        console.log("[Trust-Score] Scrape tab was closed — cleaning up listeners");
        chrome.runtime.onMessage.removeListener(progressListener);
        chrome.tabs.onUpdated.removeListener(tabListener);
        chrome.tabs.onRemoved.removeListener(removedListener);
      };
      chrome.tabs.onRemoved.addListener(removedListener);

      setTimeout(() => {
        chrome.tabs.get(scrapeTabId, (tab) => {
          if (chrome.runtime.lastError) return;
          console.warn("[Trust-Score] Scrape timeout — 3 minutes elapsed, forcing cleanup");
          chrome.runtime.onMessage.removeListener(progressListener);
          chrome.tabs.onUpdated.removeListener(tabListener);
          chrome.tabs.onRemoved.removeListener(removedListener);
          chrome.tabs.sendMessage(scrapeTabId, {
            action: "true_spot_error",
            message: "Scraping timed out after 3 minutes. The page may be blocking automated access."
          }).catch(() => { });
        });
      }, 180000);
    });

    sendResponse({ started: true });
    return true;
  }

  // ---------- DETECT PLATFORM (from popup) ----------
  if (msg.action === "detectPlatform") {
    sendResponse({ platform: detectPlatform(msg.url) });
    return false;
  }

  // ---------- START PRICE COMPARISON ----------
  if (msg.action === "start_price_compare") {
    console.log('[Trust-Score-Price] Starting price compare for:', msg.url, 'session:', msg.session_id);
    priceOrchestrateAll(msg.url, msg.session_id);
    sendResponse({ status: 'started' });
    return true;
  }
});

// ============================================================
// PRICE COMPARISON ENGINE
// ============================================================

const PRICE_PLATFORMS = [
  { name: 'Amazon', domain: 'amazon.in' },
  { name: 'Flipkart', domain: 'flipkart.com' },
  { name: 'Myntra', domain: 'myntra.com' },
];

const priceActiveSessions = {};

const MYNTRA_SKIP_KEYWORDS = [
  'phone', 'mobile', 'smartphone', 'iphone', 'galaxy', 'pixel', 'redmi',
  'realme', 'vivo', 'oppo', 'motorola', 'nokia', 'poco', 'iqoo', 'nothing phone',
  'laptop', 'notebook', 'macbook', 'chromebook', 'tablet', 'ipad',
  'computer', 'desktop', 'monitor', 'tv', 'television', 'led tv', 'oled',
  'camera', 'dslr', 'gopro', 'webcam', 'projector',
  'earbuds', 'tws', 'earphones', 'headphones', 'neckband', 'earphone',
  'buds', 'pods', 'soundbar', 'bluetooth speaker', 'wireless speaker',
  'speaker', 'amplifier',
  'printer', 'scanner', 'router', 'modem', 'hard disk', 'hard drive', 'ssd', 'pen drive',
  'keyboard', 'mouse', 'gamepad', 'joystick', 'controller',
  'gpu', 'graphics card', 'processor', 'cpu', 'motherboard', 'ram',
  'refrigerator', 'fridge', 'washing machine', 'dishwasher', 'dryer',
  'air conditioner', 'microwave', 'oven', 'mixer', 'grinder', 'blender', 'juicer',
  'iron box', 'fan', 'cooler', 'heater', 'purifier', 'humidifier', 'geyser',
  'trimmer', 'shaver', 'epilator',
  'console', 'playstation', 'xbox', 'nintendo', 'switch',
  'smartwatch', 'fitness band', 'powerbank', 'power bank',
  // Watches (analog/digital, not just smartwatches)
  'watch', 'wristwatch', 'wrist watch', 'analog watch', 'analogue watch',
  'chronograph', 'pocket watch',
  // General electronics/accessories not already covered above
  'charger', 'charging cable', 'cable', 'adapter', 'extension board',
  'power strip', 'surge protector', 'inverter', 'stabilizer', 'voltage',
  'memory card', 'sd card', 'micro sd', 'cctv', 'security camera',
  'action camera', 'drone', 'remote control', 'set top box', 'dth',
  'smart bulb', 'led bulb', 'smart plug', 'home theatre', 'home theater',
];

// Categories from CATEGORY_BUCKETS that are pure electronics — never sold on
// Myntra, so skip even when the title doesn't hit a keyword above (e.g. an
// unusual brand name or phrasing for a phone/laptop/watch/tv/audio device).
const MYNTRA_SKIP_CATEGORIES = new Set(['phone', 'laptop', 'tablet', 'tv', 'audio', 'watch']);

const CATEGORY_BUCKETS = [
  {
    name: 'clothing',
    keywords: [
      't-shirt', 'tshirt', 'shirt', 'trouser', 'jeans', 'kurta', 'saree', 'dress',
      'top', 'skirt', 'jacket', 'hoodie', 'sweatshirt', 'shorts', 'leggings',
      'salwar', 'kameez', 'dupatta', 'blouse', 'sweater', 'pullover', 'cardigan',
      'innerwear', 'underwear', 'bra', 'lingerie', 'nightwear', 'pyjama',
      'tracksuit', 'jogger', 'polo', 'blazer', 'suit', 'waistcoat',
      'ethnic', 'western', 'casual wear', 'formal wear',
    ],
  },
  {
    name: 'footwear',
    keywords: [
      'shoes', 'sneakers', 'sandals', 'slippers', 'boots', 'heels', 'loafers',
      'flip flops', 'moccasins', 'oxfords', 'derby', 'wedges', 'flats',
    ],
  },
  {
    name: 'audio',
    keywords: [
      'earbuds', 'tws', 'earphones', 'headphones', 'neckband', 'earphone',
      'buds', 'pods', 'soundbar', 'speaker', 'bluetooth speaker', 'wireless speaker',
      'in-ear', 'over-ear', 'on-ear', 'noise cancelling', 'anc', 'wired earphones',
    ],
  },
  {
    name: 'phone',
    keywords: [
      'smartphone', 'mobile phone', 'iphone', 'android phone', 'flip phone',
      '5g phone', '4g phone',
    ],
  },
  {
    name: 'laptop',
    keywords: [
      'laptop', 'notebook', 'macbook', 'chromebook', 'ultrabook',
    ],
  },
  {
    name: 'tablet',
    keywords: ['tablet', 'ipad', 'android tablet'],
  },
  {
    name: 'tv',
    keywords: ['television', 'led tv', 'oled tv', 'smart tv', 'qled', 'tv '],
  },
  {
    name: 'watch',
    keywords: ['smartwatch', 'smart watch', 'fitness band', 'activity tracker'],
  },
  {
    name: 'bag',
    keywords: [
      'backpack', 'handbag', 'tote', 'sling bag', 'wallet', 'clutch',
      'messenger bag', 'duffle', 'luggage', 'trolley bag',
    ],
  },
];

function priceDetectCategory(title) {
  if (!title) return null;
  const t = title.toLowerCase();
  for (const bucket of CATEGORY_BUCKETS) {
    if (bucket.keywords.some(kw => t.includes(kw))) return bucket.name;
  }
  return null;
}

function priceCheckCategoryMismatch(originalTitle, foundTitle) {
  const origCat = priceDetectCategory(originalTitle);
  const foundCat = priceDetectCategory(foundTitle);
  if (!origCat || !foundCat) return 'match';
  if (origCat !== foundCat) {
    console.log(`[Trust-Score-Price] CATEGORY MISMATCH: original="${origCat}" found="${foundCat}"`);
    return 'category_mismatch';
  }
  return 'match';
}

function priceIsPlatformRelevant(platformName, productTitle) {
  if (platformName !== 'Myntra') return true;
  const t = productTitle.toLowerCase();
  if (MYNTRA_SKIP_KEYWORDS.some(kw => t.includes(kw))) return false;
  const cat = priceDetectCategory(productTitle);
  if (cat && MYNTRA_SKIP_CATEGORIES.has(cat)) return false;
  return true;
}

const ACCESSORY_INDICATORS = [
  'cover', 'case', 'pouch', 'sleeve', 'skin', 'protector', 'guard', 'tempered glass',
  'screen protector', 'film', 'sticker', 'decal', 'wrap', 'folio',
  'bag', 'backpack', 'stand', 'holder', 'mount', 'dock', 'cradle', 'tripod',
  'strap', 'band', 'buckle', 'cable', 'adapter', 'dongle', 'hub',
  'cleaning kit', 'toolkit', 'tool kit', 'lens cap',
];

// Known brand names used to catch "same category, different company" mismatches
// (e.g. a Bata shoe being accepted as a price match for a Nike shoe just because
// both titles say "men's formal shoes"). Multi-word brands are listed before
// their shorter substrings don't matter since we match on whole words only.
const KNOWN_BRANDS = [
  // Footwear / fashion
  'nike', 'adidas', 'puma', 'reebok', 'skechers', 'woodland', 'bata', 'campus',
  'sparx', 'liberty', 'red tape', 'crocs', 'fila', 'new balance', 'converse',
  'vans', 'asian', 'lotto', 'action', 'paragon', 'relaxo', 'bacca bucci',
  'us polo', 'levis', "levi's", 'wrangler', 'pepe jeans', 'allen solly',
  'van heusen', 'peter england', 'louis philippe', 'roadster', 'hrx', 'jockey',
  'h&m', 'zara', 'flying machine', 'spykar', 'killer', 'mufti', 'numero uno',
  'woodland', 'metro', 'mochi', 'clarks', 'hush puppies', 'timberland',
  // Watches
  'titan', 'fossil', 'casio', 'fastrack', 'timex', 'sonata', 'citizen',
  'seiko', 'tissot', 'helix',
  // Electronics / audio / mobile
  'apple', 'samsung', 'oneplus', 'xiaomi', 'mi', 'redmi', 'realme', 'vivo',
  'oppo', 'motorola', 'nokia', 'poco', 'iqoo', 'nothing', 'google pixel',
  'boat', 'noise', 'jbl', 'sony', 'bose', 'sennheiser', 'skullcandy',
  'hp', 'dell', 'lenovo', 'acer', 'asus', 'msi', 'lg', 'philips', 'havells',
  'prestige', 'bajaj', 'logitech',
];

const TITLE_NOISE_WORDS = new Set([
  'with', 'for', 'and', 'the', 'in', 'on', 'of', 'by', 'from', 'pack', 'set', 'buy',
  'online', 'india', 'price', 'rs', 'inr', 'new', 'latest', 'edition', 'version',
  'best', 'premium', 'original', 'genuine', 'official', 'branded', 'combo',
  'offer', 'deal', 'sale', 'discount', 'free', 'shipping', 'delivery',
  'black', 'white', 'blue', 'red', 'green', 'grey', 'gray', 'silver', 'gold', 'pink',
  'purple', 'yellow', 'brown', 'orange', 'color', 'colour', 'multi',
  'small', 'medium', 'large', 'xl', 'xxl', 'xxxl', 'size', 'one',
  'men', 'women', 'mens', 'womens', 'unisex', 'kids', 'boys', 'girls', 'adult',
  'inch', 'inches', 'cm', 'mm', 'kg', 'gm', 'ml', 'ltr', 'litre', 'liter',
]);

function priceTokenize(title) {
  if (!title) return [];
  return title.toLowerCase()
    .replace(/[()\[\]{}|\u2013\u2014:,./\\"']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 1);
}

function priceExtractSignificantWords(title) {
  return priceTokenize(title)
    .filter(w => w.length >= 2 && !TITLE_NOISE_WORDS.has(w) && !/^\d+$/.test(w));
}

function priceExtractModelIds(title) {
  const tokens = priceTokenize(title);
  const models = [];
  const MODEL_STANDALONE_WORDS_EXTENDED = new Set([
    'pro', 'max', 'ultra', 'plus', 'lite', 'mini', 'neo', 'prime', 'turbo',
    'note', 'air', 'fold', 'flip', 'slim', 'speed', 'ace', '3r', '2r',
    'buds', 'pods', 'earbuds', 'earphones', 'headphones', 'tws', 'neckband',
    'soundbar', 'speaker',
    'watch', 'band', 'ring',
    'book', 'pad', 'tab',
  ]);
  // Numbers that appear right after one of these words are quantities/sizes,
  // not model/generation numbers (e.g. "pack of 2", "set of 4") — don't treat
  // them as model identifiers.
  const NUMBER_CONTEXT_SKIP_BEFORE = new Set([
    'pack', 'of', 'set', 'qty', 'combo', 'piece', 'pieces', 'pcs',
  ]);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/[a-z]/i.test(t) && /\d/.test(t) && t.length >= 2 && t.length <= 10) {
      models.push(t);
      continue;
    }
    if (MODEL_STANDALONE_WORDS_EXTENDED.has(t)) {
      models.push(t);
      continue;
    }
    // Plain numeric token, e.g. the "15" in "iPhone 15" or the "13" in
    // "Redmi Note 13" — these are exactly the tokens that distinguish one
    // model/generation from another, so they MUST be captured as model ids.
    if (/^\d{1,4}$/.test(t)) {
      const prev = tokens[i - 1];
      if (prev && NUMBER_CONTEXT_SKIP_BEFORE.has(prev)) continue;
      models.push(t);
    }
  }
  return models;
}

function priceAreTitlesSimilar(originalTitle, foundTitle) {
  if (!originalTitle) return 'match';
  if (!foundTitle || foundTitle.trim().length < 5) return 'low_similarity';

  const origModels = priceExtractModelIds(originalTitle);
  const foundModelsList = priceExtractModelIds(foundTitle);
  const foundModels = new Set(foundModelsList);

  if (origModels.length > 0 && foundModelsList.length > 0) {
    const overlap = origModels.filter(m => foundModels.has(m));
    if (overlap.length === 0) {
      // None of the original product's model/generation tokens (e.g. "15" in
      // "iPhone 15", or "13" in "Redmi Note 13") appear in the found title —
      // this is a different model, not the same product. Hard reject.
      console.log(`[Trust-Score-Price] MODEL MISMATCH: none of [${origModels.join(', ')}] found in "${foundTitle}"`);
      return 'model_mismatch';
    }
    if (overlap.length < origModels.length) {
      console.log(`[Trust-Score-Price] MODEL WARNING: only [${overlap.join(', ')}] of [${origModels.join(', ')}] matched — allowing (likely a variant/storage difference)`);
    }
  }

  const origWords = priceExtractSignificantWords(originalTitle);
  const foundWords = priceExtractSignificantWords(foundTitle);

  if (origWords.length === 0) return 'match';

  const foundSet = new Set(foundWords);
  let fwdMatch = 0;
  for (const w of origWords) {
    if (foundSet.has(w)) fwdMatch++;
  }
  const fwdSim = fwdMatch / origWords.length;

  console.log(`[Trust-Score-Price] Title similarity: ${(fwdSim * 100).toFixed(0)}%`);

  return fwdSim >= 0.35 ? 'match' : 'low_similarity';
}

function priceIsTitleRelevant(originalTitle, foundTitle) {
  if (!originalTitle) return 'match';
  if (!foundTitle || foundTitle.trim().length < 5) {
    console.log(`[Trust-Score-Price] Title check: foundTitle empty/too short — treating as low_similarity`);
    return 'low_similarity';
  }
  const origLower = originalTitle.toLowerCase();
  const foundLower = foundTitle.toLowerCase();

  const catCheck = priceCheckCategoryMismatch(originalTitle, foundTitle);
  if (catCheck !== 'match') return catCheck;

  for (const kw of ACCESSORY_INDICATORS) {
    if (foundLower.includes(kw) && !origLower.includes(kw)) {
      console.log(`[Trust-Score-Price] Title mismatch: found "${kw}" in result but not in original`);
      return 'accessory';
    }
  }

  const result = priceAreTitlesSimilar(originalTitle, foundTitle);
  if (result !== 'match') {
    console.log(`[Trust-Score-Price] Title mismatch (${result}): "${foundTitle}" vs "${originalTitle}"`);
  }
  return result;
}

function priceIsTitleRelevantStrict(originalTitle, foundTitle) {
  const baseCheck = priceIsTitleRelevant(originalTitle, foundTitle);
  if (baseCheck !== 'match') return baseCheck;
  if (!originalTitle || !foundTitle || foundTitle.trim().length < 5) return 'low_similarity';
  const origWords = priceExtractSignificantWords(originalTitle);
  const foundWords = priceExtractSignificantWords(foundTitle);
  if (origWords.length === 0) return 'match';
  const foundSet = new Set(foundWords);
  const overlap = origWords.filter(w => foundSet.has(w)).length / origWords.length;
  if (overlap < 0.45) {
    console.log(`[Trust-Score-Price] Strict check failed: overlap=${(overlap * 100).toFixed(0)}% < 45%`);
    return 'low_similarity';
  }
  return 'match';
}

async function priceOrchestrateAll(sourceUrl, sessionId) {
  priceActiveSessions[sessionId] = { tabs: [] };
  const session = priceActiveSessions[sessionId];

  if (!sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://')) {
    sourceUrl = 'https://www.' + sourceUrl;
  }

  try {
    const srcTab = await chrome.tabs.create({ url: sourceUrl, active: false });
    session.tabs.push(srcTab.id);
    await priceWaitForLoad(srcTab.id);

    const [titleRes, similarRes] = await Promise.all([
      chrome.scripting.executeScript({ target: { tabId: srcTab.id }, func: priceExtractTitle }),
      chrome.scripting.executeScript({ target: { tabId: srcTab.id }, func: priceExtractSimilarProducts }),
    ]);
    priceSafeClose(srcTab.id);

    const productTitle = titleRes?.[0]?.result || '';
    const similarProducts = similarRes?.[0]?.result || [];
    console.log(`[Trust-Score-Price] Product: "${productTitle}" | Similar: ${similarProducts.length}`);

    if (!productTitle) { await priceSubmitFinal(sessionId, 'Unknown Product', [], []); priceCleanup(session); return; }

    const sourcePlatformName = priceDetectPlatformName(sourceUrl);
    const searchQuery = priceCleanTitle(productTitle);
    console.log(`[Trust-Score-Price] Search query: "${searchQuery}"`);

    const promises = PRICE_PLATFORMS.map(platform => {
      if (!priceIsPlatformRelevant(platform.name, productTitle)) {
        console.log(`[Trust-Score-Price] Skipping ${platform.name} — category not sold there`);
        return Promise.resolve({ store: platform.name, price: null, title: 'Category not available', url: '', found: false });
      }
      if (platform.name === sourcePlatformName) {
        return priceScrapePagePrice(sourceUrl, session).then(async ({ price }) => {
          if (price !== null) return { store: platform.name, price, title: productTitle, url: sourceUrl, found: true };
          return priceSearchAndScrape(platform, searchQuery, productTitle, session);
        });
      }
      return priceSearchAndScrape(platform, searchQuery, productTitle, session);
    });

    const results = await Promise.all(promises);
    results.sort((a, b) => { if (a.found && !b.found) return -1; if (!a.found && b.found) return 1; return (a.price || 0) - (b.price || 0); });
    await priceSubmitFinal(sessionId, productTitle, results, similarProducts);
  } catch (err) {
    console.error('[Trust-Score-Price] Fatal error:', err);
    await priceSubmitFinal(sessionId, 'Error', [], []);
  }
  priceCleanup(session);
}

async function priceSearchAndScrape(platform, searchQuery, productTitle, session) {
  try {
    let productLink = null;

    // ── STEP 1: Search directly on the platform's own search ──────────────────
    console.log(`[Trust-Score-Price] STEP 1: Direct platform search on ${platform.name}`);
    const directResult = await priceDirectPlatformSearch(platform, searchQuery, productTitle, session);
    if (directResult) {
      const directTitleOk = directResult.title && directResult.title.trim().length >= 10;

      if (directResult.price !== null && directResult.price !== undefined && directTitleOk) {
        const check = priceIsTitleRelevant(productTitle, directResult.title.trim());
        if (check !== 'match') {
          console.log(`[Trust-Score-Price] Direct result mismatch (${check}) on ${platform.name} — continuing to Google`);
        } else {
          console.log(`[Trust-Score-Price] ACCEPTED ${platform.name} via direct search: Rs.${directResult.price}`);
          return { store: platform.name, price: directResult.price, title: productTitle, url: directResult.url, found: true };
        }
      } else if (directResult.url) {
        if (directResult.price !== null && !directTitleOk) {
          console.log(`[Trust-Score-Price] Direct result has price but empty/short title — scraping page for validation on ${platform.name}`);
        } else {
          console.log(`[Trust-Score-Price] Direct search found URL, scraping product page on ${platform.name}`);
        }
        const { price, pageTitle, available } = await priceScrapePagePrice(directResult.url, session);
        if (price !== null) {
          const check = priceIsTitleRelevant(productTitle, pageTitle);
          if (check === 'match') {
            console.log(`[Trust-Score-Price] ACCEPTED ${platform.name} via direct search page: Rs.${price}`);
            return { store: platform.name, price, title: productTitle, url: directResult.url, found: true };
          }
          console.log(`[Trust-Score-Price] Direct search page mismatch (${check}) on ${platform.name}`);
        } else if (available === false) {
          console.log(`[Trust-Score-Price] ${platform.name} page confirmed out-of-stock at ${directResult.url}`);
          return { store: platform.name, price: null, title: 'Currently unavailable', url: directResult.url, found: false };
        } else {
          productLink = directResult.url;
        }
      }
    }

    // ── STEP 2: Google site: search ───────────────────────────────────────────
    if (!productLink) {
      console.log(`[Trust-Score-Price] STEP 2: Google site: search for ${platform.name}`);
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery + ' site:' + platform.domain)}&hl=en&num=8`;
      const googleTab = await chrome.tabs.create({ url: googleUrl, active: false });
      session.tabs.push(googleTab.id);
      await priceWaitForLoad(googleTab.id);
      const linkRes = await chrome.scripting.executeScript({
        target: { tabId: googleTab.id },
        func: priceExtractFirstLink,
        args: [platform.domain]
      });
      priceSafeClose(googleTab.id);
      productLink = linkRes?.[0]?.result;
      console.log(`[Trust-Score-Price] Google site: result for ${platform.name}: ${productLink ? productLink.substring(0, 80) : 'none'}`);
    }

    // ── STEP 3: Scrape the product page we found ──────────────────────────────
    if (productLink) {
      const { price, pageTitle, available } = await priceScrapePagePrice(productLink, session);
      if (price !== null) {
        const titleCheck = priceIsTitleRelevant(productTitle, pageTitle);
        if (titleCheck !== 'match') {
          console.log(`[Trust-Score-Price] REJECT ${platform.name}: ${titleCheck} on page`);
        } else {
          console.log(`[Trust-Score-Price] ACCEPTED ${platform.name}: Rs.${price}`);
          return { store: platform.name, price, title: productTitle, url: productLink, found: true };
        }
      } else if (available === false) {
        console.log(`[Trust-Score-Price] ${platform.name} confirmed out-of-stock via page scrape — skipping Shopping`);
        return { store: platform.name, price: null, title: 'Currently unavailable', url: productLink, found: false };
      }
    }

    // ── STEP 4: Google Shopping ───────────────────────────────────────────────
    console.log(`[Trust-Score-Price] STEP 4: Google Shopping fallback for ${platform.name}`);
    const shopResult = await priceTryGoogleShopping(platform, searchQuery, productTitle, session);
    if (shopResult.found) {
      if (productLink && !shopResult.url) shopResult.url = productLink;
      return shopResult;
    }

    return { store: platform.name, price: null, title: 'Product not available', url: productLink || '', found: false };

  } catch (err) {
    console.error(`[Trust-Score-Price] Error on ${platform.name}:`, err);
    return { store: platform.name, price: null, title: 'Search failed', url: '', found: false };
  }
}

async function priceDirectPlatformSearch(platform, searchQuery, productTitle, session) {
  try {
    let searchUrl = null;
    let extractFunc = null;
    let extraWait = 2000;

    if (platform.name === 'Amazon') {
      searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(searchQuery)}`;
      extractFunc = priceExtractFirstFromAmazonSearch;
      extraWait = 2000;
    } else if (platform.name === 'Flipkart') {
      searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(searchQuery)}&sort=relevance`;
      extractFunc = priceExtractFirstFromFlipkartSearch;
      extraWait = 5000;
    } else if (platform.name === 'Myntra') {
      searchUrl = `https://www.myntra.com/search?q=${encodeURIComponent(searchQuery)}&plaEnabled=false`;
      extractFunc = priceExtractFirstFromMyntraSearch;
      extraWait = 6000;
    }

    if (!searchUrl) return null;

    console.log(`[Trust-Score-Price] Direct search ${platform.name}: ${searchUrl.substring(0, 100)}`);
    const searchTab = await chrome.tabs.create({ url: searchUrl, active: false });
    session.tabs.push(searchTab.id);
    await priceWaitForLoad(searchTab.id);
    await new Promise(r => setTimeout(r, extraWait));

    const res = await chrome.scripting.executeScript({
      target: { tabId: searchTab.id },
      func: extractFunc,
      args: [productTitle]
    });
    priceSafeClose(searchTab.id);

    const result = res?.[0]?.result;
    if (!result) {
      console.log(`[Trust-Score-Price] Direct search found nothing on ${platform.name}`);
      return null;
    }
    if (typeof result === 'string') return { url: result, price: null, title: null };
    console.log(`[Trust-Score-Price] Direct search result on ${platform.name}: url=${result.url ? result.url.substring(0, 60) : 'none'} price=${result.price}`);
    return result;

  } catch (err) {
    console.warn(`[Trust-Score-Price] Direct search error on ${platform.name}:`, err);
    return null;
  }
}

async function priceTryGoogleShopping(platform, searchQuery, productTitle, session) {
  try {
    const shopTab = await chrome.tabs.create({
      url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&tbm=shop&hl=en`,
      active: false
    });
    session.tabs.push(shopTab.id);
    await priceWaitForLoad(shopTab.id);
    const res = await chrome.scripting.executeScript({
      target: { tabId: shopTab.id },
      func: priceGoogleShoppingForStoreWithTitle,
      args: [platform.name]
    });
    priceSafeClose(shopTab.id);
    const result = res?.[0]?.result;
    if (result && result.price && result.price > 0) {
      const titleCheck = result.title && result.title.trim().length >= 5
        ? priceIsTitleRelevantStrict(productTitle, result.title)
        : 'low_similarity';
      if (titleCheck !== 'match') {
        console.log(`[Trust-Score-Price] Shopping REJECTED ${platform.name}: ${titleCheck} "${result.title || '(no title)'}"`);
      } else {
        console.log(`[Trust-Score-Price] Shopping ACCEPTED ${platform.name}: Rs.${result.price}`);
        return { store: platform.name, price: result.price, title: productTitle, url: result.url || '', found: true };
      }
    }
  } catch (err) {
    console.warn(`[Trust-Score-Price] Shopping error for ${platform.name}:`, err);
  }
  return { store: platform.name, price: null, title: 'Product not found', url: '', found: false };
}

async function priceScrapePagePrice(url, session) {
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    session.tabs.push(tab.id);
    await priceWaitForLoad(tab.id);

    if (url.includes('flipkart')) {
      await new Promise(r => setTimeout(r, 8000));
    } else if (url.includes('myntra')) {
      await new Promise(r => setTimeout(r, 5000));
    } else {
      await new Promise(r => setTimeout(r, 2000));
    }

    if (url.includes('flipkart')) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: priceFlipkartDismissPopup
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    const [priceRes, titleRes] = await Promise.all([
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: priceExtractFromPage }),
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: priceExtractTitle }),
    ]);
    priceSafeClose(tab.id);

    const extracted = priceRes?.[0]?.result;
    let price = null;
    let available = null;
    if (extracted !== null && extracted !== undefined) {
      if (typeof extracted === 'object') {
        price = extracted.price || null;
        available = extracted.available;
      } else {
        price = extracted || null;
      }
    }

    return {
      price,
      pageTitle: titleRes?.[0]?.result || '',
      available,
    };
  } catch (err) {
    return { price: null, pageTitle: '', available: null };
  }
}

function priceFlipkartDismissPopup() {
  const closeSelectors = [
    'button._2KpZ6l._2doB4z',
    'button._2AkmmA',
    '._3QuA0A button',
    'button[class*="close"]',
    'button[class*="Close"]',
    '[class*="loginOverlay"] button',
    '._2AkmmA._29YdH8',
    '._1LKTO3 button',
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    '._7UHT_c button',
    '.DfX3oA button',
    'span._30XB9v',
    '._2mErFt button',
    '.q9uuEs button',
    '[class*="overlay"] button[class*="close"]',
    '[class*="modal"] button[class*="close"]',
    '[class*="popup"] button[class*="close"]',
    'button[data-dismiss]',
  ];
  for (const sel of closeSelectors) {
    try {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        console.log(`[FK-Dismiss] Closed popup with: ${sel}`);
        return true;
      }
    } catch (e) { }
  }
  return false;
}

function priceExtractTitle() {
  const host = window.location.hostname;
  if (host.includes('amazon')) {
    const el = document.querySelector('#productTitle') || document.querySelector('#title');
    if (el) return el.innerText.trim();
  }
  if (host.includes('flipkart')) {
    for (const sel of [
      'span.VU-ZEz', 'span.B_NuCI', 'h1._9E25nV', '.x-product-title h1',
      'h1[class*="title"]', '.pdp-title h1', 'h1.yhB1nd', 'span[class*="title"]',
      'h1.wjcEIp', 'h1.atkRp2', '.C7fEHH h1', 'h1.G6XhRU', 'h1._6EBuvT',
    ]) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 3) return el.innerText.trim();
    }
    for (const el of document.querySelectorAll('h1')) {
      const text = el.innerText.trim();
      if (text.length > 10 && text.length < 400) return text;
    }
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent);
        const items = Array.isArray(d) ? d : [d];
        for (const item of items) { if (item['@type'] === 'Product' && item.name) return item.name; }
      } catch (e) { }
    }
  }
  if (host.includes('myntra')) {
    const b = document.querySelector('.pdp-title'), n = document.querySelector('.pdp-name');
    if (b && n) return b.innerText.trim() + ' ' + n.innerText.trim();
    if (n) return n.innerText.trim();
    for (const sel of [
      'h1.pdp-title', '[class*="pdp-title"]', '[class*="product-title"]', 'h1[class*="title"]',
    ]) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 3) return el.innerText.trim();
    }
  }
  const og = document.querySelector('meta[property="og:title"]');
  if (og) return og.getAttribute('content').trim();
  return document.title.replace(/ - Amazon.*$/, '').replace(/ \| Flipkart.*$/, '').replace(/ - Buy.*$/, '').trim();
}

function priceExtractFirstLink(domain) {
  const selectors = '#search a[href], #rso a[href], .g a[href], div[data-hveid] a[href], #res a[href]';
  for (const link of document.querySelectorAll(selectors)) {
    const href = link.href;
    if (!href || !href.includes(domain)) continue;
    if (href.includes('google.com/') && !href.includes('url?')) continue;
    if (href.includes('webcache.') || href.includes('translate.google')) continue;
    if (href.includes('/search?') || href.includes('/find/')) continue;
    if (domain === 'amazon.in' && (href.includes('/dp/') || href.includes('/gp/'))) return href;
    if (domain === 'flipkart.com' && (href.includes('/p/') || href.includes('/product/') || /\/itm[A-Za-z0-9]/.test(href))) return href;
    if (domain === 'myntra.com' && (/\/\d+\/buy/.test(href) || /\/\d+$/.test(href) || /\/\d+[?#]/.test(href))) return href;
  }
  return null;
}

function priceGoogleShoppingForStoreWithTitle(storeName) {
  const aliases = {
    Amazon: ['amazon', 'amazon.in'],
    Flipkart: ['flipkart', 'flipkart.com'],
    Myntra: ['myntra', 'myntra.com']
  };
  const list = aliases[storeName] || [storeName.toLowerCase()];
  const MIN_PRICE = 300;

  function extractTitle(el) {
    let parent = el;
    for (let i = 0; i < 10; i++) {
      if (!parent.parentElement) break;
      parent = parent.parentElement;
      const heading = parent.querySelector('h3, h4, [role="heading"], a[aria-label]');
      if (heading) {
        const title = (heading.getAttribute('aria-label') || heading.innerText || '').trim();
        if (title.length >= 5) return title;
      }
    }
    return '';
  }

  function extractUrl(el) {
    let parent = el;
    for (let i = 0; i < 8; i++) {
      if (!parent) break;
      for (const link of parent.querySelectorAll('a[href]')) {
        const href = link.href || '';
        if (list.some(a => href.includes(a)) && href.length > 20) return href;
      }
      parent = parent.parentElement;
    }
    return '';
  }

  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 5) continue;
    const text = (el.innerText || '').trim();
    if (text.length > 500 || text.length < 5) continue;
    if (!list.some(a => text.toLowerCase().includes(a))) continue;
    const m = text.match(/\u20b9\s?([0-9,]+)/);
    if (m) {
      const p = parseInt(m[1].replace(/,/g, ''), 10);
      if (p >= MIN_PRICE) return { price: p, title: extractTitle(el), url: extractUrl(el) };
    }
  }

  for (const alias of list) {
    for (const link of document.querySelectorAll(`a[href*="${alias}"]`)) {
      let parent = link.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!parent) break;
        const m = (parent.innerText || '').match(/\u20b9\s?([0-9,]+)/);
        if (m) {
          const p = parseInt(m[1].replace(/,/g, ''), 10);
          if (p >= MIN_PRICE) {
            const heading = parent.querySelector('h3, h4, [role="heading"], a[aria-label]');
            const title = heading ? (heading.getAttribute('aria-label') || heading.innerText || '').trim() : '';
            return { price: p, title, url: link.href || '' };
          }
        }
        parent = parent.parentElement;
      }
    }
  }
  return null;
}

function priceExtractFirstFromAmazonSearch(productTitle) {
  function modelTokensMatch(original, candidate) {
    if (!original) return true;
    if (!candidate || candidate.trim().length < 3) return false;
    const origTokens = original.toLowerCase().split(/\s+/);
    const candLower = candidate.toLowerCase();
    const standaloneWords = new Set([
      'pro', 'max', 'ultra', 'plus', 'lite', 'mini', 'neo', 'prime', 'turbo',
      'note', 'air', 'fold', 'flip', 'slim', 'speed', 'ace',
      'buds', 'pods', 'earbuds', 'earphones', 'headphones', 'tws', 'neckband',
      'soundbar', 'speaker', 'watch', 'band', 'ring', 'book', 'pad', 'tab',
    ]);
    const modelTokens = origTokens.filter(t =>
      (/[a-z]/.test(t) && /\d/.test(t) && t.length >= 2 && t.length <= 10) ||
      standaloneWords.has(t)
    );
    if (modelTokens.length === 0) return true;
    return modelTokens.every(m => candLower.includes(m));
  }

  function parsePrice(text) {
    if (!text) return null;
    const n = parseInt((text || '').replace(/[^0-9]/g, ''), 10);
    return (isNaN(n) || n <= 0) ? null : n;
  }

  const cards = document.querySelectorAll('[data-asin]:not([data-asin=""])');
  for (const card of cards) {
    if (card.querySelector('[data-component-type="sp-sponsored-result"]')) continue;
    const link = card.querySelector('a[href*="/dp/"]');
    if (!link) continue;
    const nameEl = card.querySelector('h2 span, .a-size-base-plus, .a-size-medium, .a-text-normal');
    const cardTitle = nameEl ? nameEl.innerText.trim() : '';
    if (cardTitle && productTitle && !modelTokensMatch(productTitle, cardTitle)) continue;
    let href = link.href;
    const dpMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
    if (dpMatch) href = 'https://www.amazon.in/dp/' + dpMatch[1];
    const priceEl = card.querySelector('.a-price .a-offscreen, .a-price-whole');
    const price = priceEl ? parsePrice((priceEl.innerText || priceEl.textContent || '').trim()) : null;
    return { url: href, price, title: cardTitle };
  }

  const anyLink = document.querySelector('a[href*="/dp/"]');
  if (anyLink) {
    let href = anyLink.href;
    const dpMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
    if (dpMatch) return { url: 'https://www.amazon.in/dp/' + dpMatch[1], price: null, title: null };
    return { url: href, price: null, title: null };
  }
  return null;
}

function priceExtractFirstFromFlipkartSearch(productTitle) {
  try {
    const closeSelectors = [
      'button._2KpZ6l._2doB4z', 'button._2AkmmA', '._3QuA0A button',
      'button[class*="close"]', 'button[class*="Close"]',
      '[class*="loginOverlay"] button', '._2AkmmA._29YdH8', '._1LKTO3 button',
      'button[aria-label="Close"]', 'button[aria-label="close"]',
      '._7UHT_c button', '.DfX3oA button', 'span._30XB9v',
    ];
    for (const sel of closeSelectors) {
      const btn = document.querySelector(sel);
      if (btn) { btn.click(); break; }
    }
  } catch (e) { }

  function parsePrice(text) {
    if (!text) return null;
    const n = parseInt((text || '').replace(/[^0-9]/g, ''), 10);
    return (isNaN(n) || n <= 0) ? null : n;
  }

  function modelScore(original, candidate) {
    if (!original) return 1;
    if (!candidate || candidate.trim().length < 3) return 0;
    const cLower = candidate.toLowerCase();
    const standaloneWords = new Set([
      'pro', 'max', 'ultra', 'plus', 'lite', 'mini', 'neo', 'prime', 'turbo',
      'note', 'air', 'fold', 'flip', 'slim', 'speed', 'ace',
      'buds', 'pods', 'earbuds', 'earphones', 'headphones', 'tws', 'neckband',
      'soundbar', 'speaker', 'watch', 'band', 'ring', 'book', 'pad', 'tab',
    ]);
    const modelTokens = original.toLowerCase().split(/\s+/).filter(t =>
      (/[a-z]/.test(t) && /\d/.test(t) && t.length >= 2 && t.length <= 10) ||
      standaloneWords.has(t)
    );
    if (modelTokens.length === 0) return 1;
    const matched = modelTokens.filter(m => cLower.includes(m)).length;
    return matched / modelTokens.length;
  }

  const KNOWN_BRANDS = [
    'oneplus', 'samsung', 'apple', 'sony', 'boat', 'noise', 'realme', 'jbl',
    'sennheiser', 'bose', 'skullcandy', 'mi', 'redmi', 'xiaomi', 'oppo', 'vivo',
    'motorola', 'nokia', 'lg', 'philips', 'havells', 'prestige', 'bajaj', 'asus',
    'hp', 'dell', 'lenovo', 'acer', 'msi', 'gigabyte', 'corsair', 'logitech',
  ];

  function getBrand(title) {
    if (!title) return null;
    const t = title.toLowerCase();
    return KNOWN_BRANDS.find(b => t.startsWith(b) || t.includes(' ' + b + ' ') || t.includes(' ' + b)) || null;
  }

  function brandPenalty(original, candidate) {
    const origBrand = getBrand(original);
    const candBrand = getBrand(candidate);
    if (!origBrand || !candBrand) return 0;
    if (origBrand !== candBrand) {
      console.log(`[FK-Search] Brand mismatch: original="${origBrand}" card="${candBrand}" — penalising`);
      return -2;
    }
    return 0;
  }

  const cardSelectors = [
    'div[data-id]', '._1AtVbE', '.CGtC98', '._2kHMtA',
    '._13oc-S', '.col.col-7-12', '._4ddWXP',
    '.cPHDOP', '.KzDlHZ', '._75nlfW', '.tUxRFH',
    '.DOjaWF', '._2B099N',
  ];

  const candidates = [];

  for (const cardSel of cardSelectors) {
    for (const card of document.querySelectorAll(cardSel)) {
      const link = card.querySelector('a[href*="/p/"]');
      if (!link) continue;
      let href = link.href;
      if (href.startsWith('/')) href = 'https://www.flipkart.com' + href;
      if (href.includes('/search?') || href.includes('/find/')) continue;
      if (!href.includes('flipkart.com')) continue;

      if (candidates.some(c => c.url === href)) continue;

      const titleEl = card.querySelector(
        '.KzDlHZ, .s1Q9rs, .IRpwTa, ._2WkVRV, a[title], ._4rR01T, ' +
        '.wjcEIp, .atkRp2, [class*="product-title"], [class*="productTitle"]'
      );
      const cardTitle = titleEl ? (titleEl.title || titleEl.innerText || '').trim() : '';

      const priceEl = card.querySelector(
        '.Nx9bqj, ._30jeq3, ._16Jk6d, .CEmiEU, ._1vC4OE, ' +
        '.wVG9lP, ._3I9_wc, .aliInE, .hl05eU .Nx9bqj, ' +
        'div[class*="price"]:not([class*="strike"]):not([class*="mrp"])'
      );
      const price = priceEl ? parsePrice(priceEl.innerText) : null;

      const score = modelScore(productTitle, cardTitle) + brandPenalty(productTitle, cardTitle);
      console.log(`[FK-Search] Candidate: score=${score.toFixed(2)} title="${cardTitle}" price=${price} url=${href.substring(0, 60)}`);

      candidates.push({ url: href, price, title: cardTitle, score });

      if (candidates.length >= 8) break;
    }
    if (candidates.length >= 8) break;
  }

  if (candidates.length === 0) {
    for (const link of document.querySelectorAll('a[href*="/p/"]')) {
      let href = link.href;
      if (href.startsWith('/')) href = 'https://www.flipkart.com' + href;
      if (href.includes('/search?') || href.includes('/find/') || !href.includes('flipkart.com')) continue;
      return { url: href, price: null, title: null };
    }
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (best.score <= 0) {
    console.log(`[FK-Search] Best candidate has low/negative score — returning URL only for page validation`);
    return { url: best.url, price: null, title: null };
  }

  if (!best.title || best.title.trim().length < 10) {
    return { url: best.url, price: null, title: null };
  }

  console.log(`[FK-Search] SELECTED: score=${best.score.toFixed(2)} title="${best.title}" price=${best.price}`);
  return { url: best.url, price: best.price, title: best.title };
}

function priceExtractFirstFromMyntraSearch(productTitle) {
  function parsePrice(text) {
    if (!text) return null;
    const n = parseInt((text || '').replace(/[^0-9]/g, ''), 10);
    return (isNaN(n) || n <= 0) ? null : n;
  }

  function modelMatch(original, candidate) {
    if (!original) return true;
    if (!candidate || candidate.trim().length < 3) return false;
    const cLower = candidate.toLowerCase();
    const standaloneWords = new Set([
      'pro', 'max', 'ultra', 'plus', 'lite', 'mini', 'neo', 'prime', 'turbo',
      'note', 'air', 'fold', 'flip', 'slim', 'speed', 'ace',
      'buds', 'pods', 'earbuds', 'earphones', 'headphones', 'tws', 'neckband',
      'soundbar', 'speaker', 'watch', 'band', 'ring', 'book', 'pad', 'tab',
    ]);
    const modelTokens = original.toLowerCase().split(/\s+/).filter(t =>
      (/[a-z]/.test(t) && /\d/.test(t) && t.length >= 2 && t.length <= 10) ||
      standaloneWords.has(t)
    );
    if (modelTokens.length === 0) return true;
    return modelTokens.every(m => cLower.includes(m));
  }

  const cardSelectors = [
    '.product-base',
    '[class*="product-card"]', '[class*="productCard"]',
    '.results-base li', 'ul.results-base > li',
    'li[class*="product"]', '[class*="search-result"]',
  ];

  for (const cardSel of cardSelectors) {
    for (const card of document.querySelectorAll(cardSel)) {
      const link = card.querySelector('a[href]');
      if (!link) continue;
      let href = link.href;
      if (href.startsWith('/')) href = 'https://www.myntra.com' + href;
      if (!(/\/\d{5,}/.test(href))) continue;
      if (href.includes('/search') || href.includes('/gateway')) continue;

      const brandEl = card.querySelector('.product-brand, [class*="brand"]');
      const nameEl = card.querySelector('.product-product, [class*="product-name"], [class*="productName"]');
      const cardTitle = ((brandEl ? brandEl.innerText.trim() + ' ' : '') + (nameEl ? nameEl.innerText.trim() : '')).trim();
      if (cardTitle && productTitle && !modelMatch(productTitle, cardTitle)) continue;

      const priceEl = card.querySelector(
        '.product-discountedPrice, .product-price, ' +
        '[class*="discounted"]:not([class*="strike"]), [class*="selling"], ' +
        '[class*="price"]:not([class*="strike"]):not([class*="mrp"]):not([class*="original"])'
      );
      const price = priceEl ? parsePrice(priceEl.innerText) : null;

      console.log(`[Myntra-Search] Found: "${cardTitle}" price=${price} url=${href.substring(0, 60)}`);
      return { url: href, price, title: cardTitle };
    }
  }

  for (const link of document.querySelectorAll('a[href]')) {
    let href = link.href;
    if (href.startsWith('/')) href = 'https://www.myntra.com' + href;
    if (!href.includes('myntra.com')) continue;
    if (!(/\/\d{5,}/.test(href))) continue;
    if (href.includes('/search') || href.includes('/gateway') || href.includes('?')) {
      if (!(/\/\d{5,}\/buy/.test(href))) continue;
    }
    return { url: href, price: null, title: null };
  }
  return null;
}

// ── Injected: Extract price from a product page ──────────────────────────────
function priceExtractFromPage() {
  const host = window.location.hostname;

  function parsePrice(t) {
    if (!t) return null;
    const n = parseInt(t.replace(/\.\d{1,2}/, '').replace(/[^0-9]/g, ''), 10);
    return (isNaN(n) || n <= 0) ? null : n;
  }

  // ── AMAZON ──
  if (host.includes('amazon')) {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent);
        for (const item of (Array.isArray(d) ? d : [d])) {
          if (item['@type'] === 'Product' && item.offers) {
            for (const o of (Array.isArray(item.offers) ? item.offers : [item.offers])) {
              if (o.availability && o.availability.includes('OutOfStock')) continue;
              const p = parseInt(o.price || o.lowPrice || '0', 10);
              if (p > 0) return { price: p, available: true };
            }
          }
        }
      } catch (e) { }
    }

    const avail = document.querySelector('#availability');
    const availText = (avail && avail.innerText || '').toLowerCase();
    if (availText.includes('currently unavailable') && !availText.includes('in stock') &&
      !document.querySelector('#add-to-cart-button, #buy-now-button')) {
      return { price: null, available: false };
    }

    for (const sel of [
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '.priceToPay .a-offscreen',
      '#corePrice_desktop .a-price .a-offscreen',
      '#priceblock_ourprice', '#priceblock_dealprice',
      '.a-price .a-offscreen',
      '.reinventPricePriceToPayMargin .a-offscreen',
      '#apex_offerDisplay_desktop .a-price .a-offscreen',
      '.apexPriceToPay .a-offscreen',
    ]) {
      const el = document.querySelector(sel);
      if (el) {
        const p = parsePrice((el.innerText || el.textContent || '').trim());
        if (p) return { price: p, available: true };
      }
    }

    const col = document.querySelector('#rightCol,#desktop_buybox,#buybox,#centerCol');
    if (col) {
      const m = col.innerText.match(/\u20b9\s?([0-9,]+)/);
      if (m) { const p = parseInt(m[1].replace(/,/g, ''), 10); if (p > 0) return { price: p, available: true }; }
    }

    return { price: null, available: null };
  }

  // ── FLIPKART ──
  if (host.includes('flipkart')) {

    function parsePrice(t) {
      if (!t) return null;
      const n = parseInt(t.replace(/\.\d{1,2}/, '').replace(/[^0-9]/g, ''), 10);
      return (isNaN(n) || n <= 0) ? null : n;
    }

    // 1. ULTIMATE FAST-PATH: Extract price directly from the "Buy at ₹..." button
    const actionElements = document.querySelectorAll('button, a, div[role="button"], div[class*="btn"]');
    for (const el of actionElements) {
      const text = (el.innerText || '').toLowerCase().trim();
      const match = text.match(/buy\s+at\s*(?:\u20b9|rs\.?)?\s*([0-9,]+)/i);

      if (match) {
        const p = parsePrice(match[1]);
        if (p && p > 0) {
          console.log(`[FK-Page] Price extracted directly from dynamic Buy Button: Rs.${p}`);
          return { price: p, available: true };
        }
      }
    }

    // 2. Check for explicit Out of Stock signals safely
    function flipkartIsOutOfStock() {
      const pageText = document.body.innerText.toLowerCase();

      if (
        pageText.includes('add to cart') ||
        pageText.includes('buy now') ||
        pageText.includes('go to cart') ||
        pageText.includes('buy with emi') ||
        /buy\s+at\s+(?:\u20b9|rs\.?)/i.test(pageText)
      ) {
        return false;
      }

      if (
        pageText.includes('currently out of stock') ||
        pageText.includes('this item is currently out of stock') ||
        pageText.includes('sold out')
      ) {
        const buyForm = document.querySelector('form, ._1YokD2, .DOjaWF, .right-column');
        if (buyForm) {
          const formText = buyForm.innerText.toLowerCase();
          if (formText.includes('sold out') || formText.includes('out of stock')) {
            return true;
          }
        } else {
          return true;
        }
      }
      return false;
    }

    // 3. Try grabbing price from LD+JSON
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent);
        for (const item of (Array.isArray(d) ? d : [d])) {
          if (item['@type'] === 'Product' && item.offers) {
            for (const o of (Array.isArray(item.offers) ? item.offers : [item.offers])) {
              const p = parseInt(o.price || o.lowPrice || '0', 10);
              if (p > 0) return { price: p, available: true };
            }
          }
        }
      } catch (e) { }
    }

    // 4. Try grabbing price from React's Initial State
    try {
      for (const s of document.querySelectorAll('script:not([src])')) {
        const text = s.textContent || '';
        if (text.includes('window.__INITIAL_STATE__') || text.includes('sellingPrice')) {
          const match = text.match(/"sellingPrice"\s*:\s*\{"value"\s*:\s*(\d+)/) ||
            text.match(/"finalPrice"\s*:\s*\{"value"\s*:\s*(\d+)/) ||
            text.match(/"price"\s*:\s*(\d+)/) ||
            text.match(/"discountedPrice"\s*:\s*(\d+)/);
          if (match) {
            const p = parseInt(match[1], 10);
            if (p > 0) return { price: p, available: true };
          }
        }
      }
    } catch (e) { }

    // 5. Brute-force generic text scan
    const priceCandidates = [];
    document.querySelectorAll('div, span').forEach(el => {
      if (el.children.length <= 1) {
        const t = (el.innerText || '').trim();
        const match = t.match(/^\u20b9\s?([0-9,]{3,})/);
        if (match) {
          const p = parsePrice(match[1]);
          if (p && p > 100 && p < 500000) {
            priceCandidates.push(p);
          }
        }
      }
    });

    if (priceCandidates.length > 0) {
      priceCandidates.sort((a, b) => a - b);
      console.log(`[FK-Page] Price brute-forced: Rs.${priceCandidates[0]}`);
      return { price: priceCandidates[0], available: true };
    }

    // 6. Final safety check
    if (flipkartIsOutOfStock()) {
      return { price: null, available: false };
    }

    return { price: null, available: null };
  }

  // ── MYNTRA ──
  if (host.includes('myntra')) {
    const path = window.location.pathname;
    if (path === '/') return { price: null, available: null };
    if (!(/\/\d+/.test(path))) return { price: null, available: null };

    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent);
        for (const item of (Array.isArray(d) ? d : [d])) {
          if (item['@type'] === 'Product' && item.offers) {
            for (const o of (Array.isArray(item.offers) ? item.offers : [item.offers])) {
              const p = parseInt(o.price || o.lowPrice || '0', 10);
              if (p > 0) return { price: p, available: true };
            }
          }
        }
      } catch (e) { }
    }

    const metaPrice = document.querySelector('meta[property="product:price:amount"],meta[property="og:price:amount"]');
    if (metaPrice) {
      const p = parseInt(metaPrice.getAttribute('content'), 10);
      if (p > 0) return { price: p, available: true };
    }

    for (const sel of [
      '.pdp-price strong', '.pdp-discount-container .pdp-price', '.pdp-mrp .pdp-price',
      '.pdp-price', '[class*="pdp-price"]', '[class*="discountedPrice"]', '[class*="sellingPrice"]',
      '.pdp-price-info', '.index-discountedPrice', '.index-sellingPrice',
      'span[class*="price"]:not([class*="strike"]):not([class*="mrp"])',
      'div[class*="price"]:not([class*="strike"]):not([class*="mrp"]):not([class*="cross"])',
    ]) {
      const el = document.querySelector(sel);
      if (el) {
        const p = parsePrice(el.innerText.trim());
        if (p) return { price: p, available: true };
      }
    }

    try {
      if (window.__myx) {
        const raw = JSON.stringify(window.__myx);
        const m = raw.match(/"discountedPrice"\s*:\s*(\d+)/) ||
          raw.match(/"sellingPrice"\s*:\s*(\d+)/) ||
          raw.match(/"price"\s*:\s*(\d+)/);
        if (m) {
          const p = parseInt(m[1], 10);
          if (p > 0) return { price: p, available: true };
        }
      }
    } catch (e) { }

    for (const s of document.querySelectorAll('script:not([src])')) {
      const text = s.textContent || '';
      if (!text.includes('discountedPrice') && !text.includes('sellingPrice')) continue;
      const m = text.match(/"discountedPrice"\s*:\s*(\d+)/) || text.match(/"sellingPrice"\s*:\s*(\d+)/);
      if (m) {
        const p = parseInt(m[1], 10);
        if (p > 0 && p < 1000000) return { price: p, available: true };
      }
    }

    return { price: null, available: null };
  }

  return { price: null, available: null };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function priceDetectPlatformName(url) {
  if (url.includes('amazon')) return 'Amazon';
  if (url.includes('flipkart')) return 'Flipkart';
  if (url.includes('myntra')) return 'Myntra';
  return 'Unknown';
}

function priceWaitForLoad(tabId) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 25000);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 3000);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function priceSafeClose(tabId) { try { chrome.tabs.remove(tabId); } catch (e) { } }

function priceCleanup(session) {
  setTimeout(() => { for (const id of session.tabs) priceSafeClose(id); }, 3000);
}

function priceCleanTitle(title) {
  return title
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[|\u2013\u2014:]/g, ' ')
    .replace(/\b(buy|online|india|price|rs|inr|pack|set|with|for|and|the|in|on|of|by|from)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function priceSubmitFinal(sessionId, productTitle, results, similarProducts = []) {
  try {
    await fetch(`${API_BASE}/api/price/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        product_title: productTitle,
        results,
        similar_products: similarProducts
      })
    });
    console.log(`[Trust-Score-Price] Submitted (${similarProducts.length} similar products)`);
  } catch (err) {
    console.error('[Trust-Score-Price] Submit failed:', err);
  }
}

// ── Injected: Extract similar/recommended products ────────────────────────────

function priceExtractSimilarProducts() {
  const host = window.location.hostname;
  const products = [];
  const seenUrls = new Set();
  const MAX = 8;

  function parsePrice(text) {
    if (!text) return null;
    const m = text.replace(/,/g, '').match(/(\d+)/);
    if (m) { const n = parseInt(m[1], 10); return n > 0 ? n : null; }
    return null;
  }

  function addProduct(name, price, image, url) {
    if (!name || !url || seenUrls.has(url) || products.length >= MAX) return;
    name = name.trim().substring(0, 120);
    if (name.length < 5) return;
    seenUrls.add(url);
    products.push({ name, price, image: image || '', url });
  }

  if (host.includes('amazon')) {
    const carouselSelectors = [
      '#anonCarousel1 .a-carousel-card', '#anonCarousel2 .a-carousel-card',
      '#anonCarousel3 .a-carousel-card', '#anonCarousel4 .a-carousel-card',
      '#anonCarousel5 .a-carousel-card', '[data-a-carousel-options] .a-carousel-card',
      '.a-carousel-card', '.p13n-sc-uncoverable-faceout',
    ];
    for (const sel of carouselSelectors) {
      if (products.length >= MAX) break;
      for (const card of document.querySelectorAll(sel)) {
        if (products.length >= MAX) break;
        const linkEl = card.querySelector('a[href*="/dp/"]') || card.querySelector('a[href*="/gp/"]');
        if (!linkEl) continue;
        let href = linkEl.href;
        if (href.startsWith('/')) href = 'https://www.amazon.in' + href;
        const dpMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
        if (dpMatch) href = 'https://www.amazon.in/dp/' + dpMatch[1];
        const nameEl = card.querySelector('.p13n-sc-truncate, .p13n-sc-truncate-desktop-type2, .a-truncate-full, .a-size-base, a[title]');
        let name = nameEl ? (nameEl.title || nameEl.innerText || '').trim() : (linkEl.title || linkEl.innerText || '').trim();
        if (!name || name.length < 5) {
          for (const t of card.querySelectorAll('.a-size-base, .a-size-small, .a-link-normal')) {
            const txt = (t.innerText || '').trim();
            if (txt.length >= 10 && txt.length < 200) { name = txt; break; }
          }
        }
        const priceEl = card.querySelector('.a-price .a-offscreen, ._cDEzb_p13n-sc-price_3mJ9Z, .a-color-price, .p13n-sc-price');
        const price = priceEl ? parsePrice(priceEl.innerText || priceEl.textContent) : null;
        const imgEl = card.querySelector('img');
        addProduct(name, price, imgEl ? imgEl.src : '', href);
      }
    }
    const compareTable = document.querySelector('#HLCXComparisonTable, .comparison_table');
    if (compareTable && products.length < MAX) {
      for (const cell of compareTable.querySelectorAll('td[data-asin]')) {
        if (products.length >= MAX) break;
        const asin = cell.getAttribute('data-asin');
        if (!asin) continue;
        const linkEl = cell.querySelector('a[href*="/dp/"]');
        const href = linkEl ? linkEl.href : 'https://www.amazon.in/dp/' + asin;
        const nameEl = cell.querySelector('.a-size-base, .a-link-normal');
        const name = nameEl ? nameEl.innerText.trim() : '';
        const priceEl = cell.querySelector('.a-price .a-offscreen, .a-color-price');
        const price = priceEl ? parsePrice(priceEl.innerText || priceEl.textContent) : null;
        const imgEl = cell.querySelector('img');
        addProduct(name, price, imgEl ? imgEl.src : '', href);
      }
    }
  }

  if (host.includes('flipkart')) {
    const allLinks = new Set();
    for (const sel of ['div[data-id] a[href*="/p/"]', 'a[href*="/p/itm"]', '._75nlfW a[href*="/p/"]']) {
      for (const el of document.querySelectorAll(sel)) allLinks.add(el);
    }
    for (const linkEl of allLinks) {
      if (products.length >= MAX) break;
      let href = linkEl.href;
      if (href.startsWith('/')) href = 'https://www.flipkart.com' + href;
      if (href === window.location.href) continue;
      let card = linkEl;
      for (let i = 0; i < 6; i++) { if (card.parentElement) card = card.parentElement; else break; }
      let name = '';
      for (const ns of ['a[title]', '.KzDlHZ', '.s1Q9rs', '.IRpwTa', '._2WkVRV', '.css-1bjia47']) {
        const nel = card.querySelector(ns);
        if (nel) { name = (nel.title || nel.innerText || '').trim(); if (name.length >= 5) break; }
      }
      if (!name) name = (linkEl.title || linkEl.innerText || '').trim();
      const priceEl = card.querySelector('.Nx9bqj, ._30jeq3, ._1_WHN1');
      const price = priceEl ? parsePrice(priceEl.innerText) : null;
      const imgEl = card.querySelector('img');
      addProduct(name, price, imgEl ? imgEl.src : '', href);
    }
  }

  if (host.includes('myntra')) {
    for (const card of document.querySelectorAll('.product-base')) {
      if (products.length >= MAX) break;
      const linkEl = card.querySelector('a[href]');
      if (!linkEl) continue;
      let href = linkEl.href;
      if (href.startsWith('/')) href = 'https://www.myntra.com' + href;
      if (href === window.location.href || !(/\/\d+/.test(href))) continue;
      const brandEl = card.querySelector('.product-brand');
      const nameEl = card.querySelector('.product-product');
      const name = ((brandEl ? brandEl.innerText + ' ' : '') + (nameEl ? nameEl.innerText : '')).trim();
      const priceEl = card.querySelector('.product-discountedPrice, .product-price, .product-strike');
      const price = priceEl ? parsePrice(priceEl.innerText) : null;
      const imgEl = card.querySelector('img');
      addProduct(name, price, imgEl ? (imgEl.src || imgEl.dataset.src || '') : '', href);
    }

    for (const sel of ['.similar-products-container a[href]', '[class*="recommend"] a[href]', '[class*="similar"] a[href]', '[class*="carousel"] a[href]']) {
      if (products.length >= MAX) break;
      for (const linkEl of document.querySelectorAll(sel)) {
        if (products.length >= MAX) break;
        let href = linkEl.href;
        if (href.startsWith('/')) href = 'https://www.myntra.com' + href;
        if (href === window.location.href || seenUrls.has(href) || !href.includes('myntra.com') || !(/\/\d+/.test(href))) continue;
        let card = linkEl;
        for (let i = 0; i < 5; i++) { if (card.parentElement) card = card.parentElement; else break; }
        let name = (linkEl.title || linkEl.innerText || '').trim();
        if (!name || name.length < 5) {
          const brandEl = card.querySelector('.product-brand, [class*="brand"]');
          const nameEl = card.querySelector('.product-product, [class*="product-name"]');
          name = ((brandEl ? brandEl.innerText + ' ' : '') + (nameEl ? nameEl.innerText : '')).trim();
        }
        const priceEl = card.querySelector('.product-discountedPrice, .product-price, [class*="price"]');
        const price = priceEl ? parsePrice(priceEl.innerText) : null;
        const imgEl = card.querySelector('img');
        addProduct(name, price, imgEl ? (imgEl.src || imgEl.dataset.src || '') : '', href);
      }
    }
  }

  console.log(`[Trust-Score] Extracted ${products.length} similar products`);
  return products;
}