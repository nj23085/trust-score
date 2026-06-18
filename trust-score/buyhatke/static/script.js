document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('search-form');
    const urlInput = document.getElementById('product-url');
    const statusMessage = document.getElementById('status-message');
    const resultsContainer = document.getElementById('results-container');

    let extensionReady = false;

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'BUYHATKE_EXTENSION_READY') {
            extensionReady = true;
            console.log('[UI] Extension bridge ready');
        }
    });

    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (!url) return;

        if (!extensionReady) {
            showStatus('Chrome Extension not detected. Please install and enable the BuyHatke Clone extension.', 'warning');
            return;
        }

        showStatus('Initializing price comparison...', 'info');
        resultsContainer.classList.add('hidden');
        resultsContainer.innerHTML = '';

        try {
            const response = await fetch('/api/start_scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await response.json();
            if (data.status !== 'success') {
                showStatus('Failed to start session.', 'error');
                return;
            }

            const sessionId = data.session_id;
            showStatus('Extracting product info & searching Google Shopping...', 'info');

            window.postMessage({
                type: 'BUYHATKE_START_SCRAPE',
                url: url,
                session_id: sessionId
            }, '*');

            pollForResults(sessionId);
        } catch (err) {
            showStatus('Server error. Make sure Flask is running.', 'error');
        }
    });

    async function pollForResults(sessionId) {
        let attempt = 0;
        const maxAttempts = 120; // 2 minutes max

        const interval = setInterval(async () => {
            attempt++;
            try {
                const res = await fetch(`/api/poll/${sessionId}`);
                const data = await res.json();

                if (data.status === 'done') {
                    clearInterval(interval);
                    showStatus('', 'hidden');
                    displayResults(data.results, data.product_title);
                    return;
                }

                // Show progress updates
                if (attempt === 15) showStatus('Searching Google for product pages...', 'info');
                if (attempt === 30) showStatus('Opening product pages & scraping prices...', 'info');
                if (attempt === 60) showStatus('Almost done, please wait...', 'info');

                if (attempt >= maxAttempts) {
                    clearInterval(interval);
                    showStatus('Timed out. Please try again.', 'error');
                }
            } catch (err) { /* keep polling */ }
        }, 1000);
    }

    function displayResults(results, productTitle) {
        if (!results || results.length === 0) {
            showStatus('No prices found on Google Shopping. Try a different product.', 'error');
            return;
        }

        // Filter results with actual prices for min/max calculation
        const foundResults = results.filter(r => r.found && r.price !== null && r.price > 0);
        const lowestPrice = foundResults.length > 0 ? Math.min(...foundResults.map(r => r.price)) : 0;
        const highestPrice = foundResults.length > 0 ? Math.max(...foundResults.map(r => r.price)) : 0;

        let html = '';

        // Product title bar
        if (productTitle) {
            html += `<div class="product-title-bar">
                <h2>${esc(productTitle)}</h2>
                <p class="results-count">${results.length} store${results.length > 1 ? 's' : ''} found</p>
            </div>`;
        }

        // Savings banner
        if (results.length >= 2) {
            const savings = highestPrice - lowestPrice;
            if (savings > 0) {
                html += `<div class="savings-bar">
                    <span>You can save up to <strong>Rs.${savings.toLocaleString('en-IN')}</strong> by choosing the cheapest store!</span>
                </div>`;
            }
        }

        // Sliding carousel
        html += `<div class="carousel-wrapper">
            <button class="carousel-btn carousel-prev" onclick="slideCarousel(-1)">&#10094;</button>
            <div class="carousel-track-container">
                <div class="carousel-track" id="carousel-track">`;

        for (const r of results) {
            const hasPrice = r.price !== null && r.price > 0;
            const isLowest = hasPrice && r.price === lowestPrice && foundResults.length > 1;
            const storeIcon = getStoreIcon(r.store);

            html += `
                <div class="slide-card ${isLowest ? 'lowest-card' : ''} ${!hasPrice ? 'unavailable-card' : ''}">
                    ${isLowest ? '<div class="lowest-badge">Lowest Price</div>' : ''}
                    <div class="card-header">
                        <span class="store-icon">${storeIcon}</span>
                        <h3>${esc(r.store)}</h3>
                    </div>
                    <p class="card-title">${esc(r.title || productTitle || '')}</p>
                    <p class="price ${isLowest ? 'price-lowest' : ''}">${hasPrice ? 'Rs.' + r.price.toLocaleString('en-IN') : 'Not Available'}</p>
                    ${r.url ? `<a href="${esc(r.url)}" target="_blank" class="card-link">Visit Store</a>` : ''}
                </div>`;
        }

        html += `</div></div>
            <button class="carousel-btn carousel-next" onclick="slideCarousel(1)">&#10095;</button>
        </div>`;

        // Dot indicators
        html += `<div class="carousel-dots" id="carousel-dots">`;
        const totalPages = Math.ceil(results.length / getVisibleCards());
        for (let i = 0; i < totalPages; i++) {
            html += `<span class="dot ${i === 0 ? 'active' : ''}" onclick="goToSlide(${i})"></span>`;
        }
        html += `</div>`;

        resultsContainer.innerHTML = html;
        resultsContainer.classList.remove('hidden');

        // Initialize carousel
        window.currentSlide = 0;
        updateCarousel();
    }

    // Make carousel functions global
    window.getVisibleCards = function() {
        const w = window.innerWidth;
        if (w < 600) return 1;
        if (w < 900) return 2;
        return 3;
    };

    window.slideCarousel = function(direction) {
        const track = document.getElementById('carousel-track');
        if (!track) return;
        const cards = track.querySelectorAll('.slide-card');
        const visible = getVisibleCards();
        const maxSlide = Math.max(0, Math.ceil(cards.length / visible) - 1);

        window.currentSlide = Math.max(0, Math.min(maxSlide, (window.currentSlide || 0) + direction));
        updateCarousel();
    };

    window.goToSlide = function(index) {
        window.currentSlide = index;
        updateCarousel();
    };

    window.updateCarousel = function() {
        const track = document.getElementById('carousel-track');
        if (!track) return;
        const visible = getVisibleCards();
        const cardWidth = track.querySelector('.slide-card')?.offsetWidth || 320;
        const gap = 20;
        const offset = window.currentSlide * visible * (cardWidth + gap);
        track.style.transform = `translateX(-${offset}px)`;

        // Update dots
        const dots = document.querySelectorAll('.dot');
        dots.forEach((d, i) => d.classList.toggle('active', i === window.currentSlide));

        // Update buttons
        const prevBtn = document.querySelector('.carousel-prev');
        const nextBtn = document.querySelector('.carousel-next');
        const cards = track.querySelectorAll('.slide-card');
        const maxSlide = Math.max(0, Math.ceil(cards.length / visible) - 1);
        if (prevBtn) prevBtn.style.opacity = window.currentSlide === 0 ? '0.3' : '1';
        if (nextBtn) nextBtn.style.opacity = window.currentSlide >= maxSlide ? '0.3' : '1';
    };

    window.addEventListener('resize', () => {
        window.currentSlide = 0;
        updateCarousel();
        // Rebuild dots
        const track = document.getElementById('carousel-track');
        const dotsContainer = document.getElementById('carousel-dots');
        if (track && dotsContainer) {
            const cards = track.querySelectorAll('.slide-card');
            const totalPages = Math.ceil(cards.length / getVisibleCards());
            dotsContainer.innerHTML = '';
            for (let i = 0; i < totalPages; i++) {
                const dot = document.createElement('span');
                dot.className = `dot ${i === 0 ? 'active' : ''}`;
                dot.onclick = () => goToSlide(i);
                dotsContainer.appendChild(dot);
            }
        }
    });

    function getStoreIcon(store) {
        const s = store.toLowerCase();
        if (s.includes('amazon')) return '📦';
        if (s.includes('flipkart')) return '🛒';
        if (s.includes('myntra')) return '👗';
        if (s.includes('ajio')) return '👔';
        if (s.includes('meesho')) return '🛍️';
        if (s.includes('nykaa')) return '💄';
        if (s.includes('croma')) return '📱';
        if (s.includes('reliance')) return '🏪';
        if (s.includes('jiomart')) return '🏬';
        if (s.includes('snapdeal')) return '💰';
        if (s.includes('tata')) return '🏷️';
        return '🏪';
    }

    function showStatus(message, type) {
        if (type === 'hidden' || !message) {
            statusMessage.classList.add('hidden');
            return;
        }
        const icons = { info: '🔍', warning: '⚠️', error: '❌' };
        statusMessage.textContent = (icons[type] || '') + ' ' + message;
        statusMessage.className = `status-msg status-${type}`;
        statusMessage.classList.remove('hidden');
    }

    function esc(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
