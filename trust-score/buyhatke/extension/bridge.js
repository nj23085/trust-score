// bridge.js - Injected into localhost:5000 (our BuyHatke Clone UI)
// Bridges the frontend page with the Chrome Extension background script

function sendToBackground(message) {
    // Safely check chrome.runtime exists and is not invalidated
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.error('[Bridge] chrome.runtime not available');
        return;
    }
    try {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('[Bridge] sendMessage error:', chrome.runtime.lastError.message);
            } else {
                console.log('[Bridge] Background acknowledged:', response);
            }
        });
    } catch (err) {
        console.error('[Bridge] Exception sending message:', err);
    }
}

// Listen for postMessage events from the frontend script.js
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data) return;

    if (event.data.type === 'BUYHATKE_START_SCRAPE') {
        console.log('[Bridge] Received scrape request:', event.data);
        sendToBackground({
            action: 'start_multi_scrape',
            url: event.data.url,
            session_id: event.data.session_id
        });
    }
});

// Notify the page that the extension is available
// Small delay to ensure page JS has loaded
setTimeout(() => {
    window.postMessage({ type: 'BUYHATKE_EXTENSION_READY' }, '*');
    console.log('[Bridge] BuyHatke Clone Extension bridge loaded and ready.');
}, 500);
