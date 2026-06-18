# TrusKaro Analytics - Quick Usage Guide

## 🚀 Quick Start

Once you've set up Google Analytics (see `ANALYTICS_SETUP.md`), you can use the helper functions in `static/analytics.js`:

```javascript
// Track product analysis submission
TrusKaroAnalytics.trackAnalysisSubmit('amazon', 'https://amazon.in/...');

// Track analysis completion
TrusKaroAnalytics.trackAnalysisComplete('flipkart', 8.5, 150, 22);

// Track tab navigation
TrusKaroAnalytics.trackTabView('Price Comparison', 'myntra');

// Track errors
TrusKaroAnalytics.trackError('ScrapeError', 'Failed to load Amazon reviews');
```

---

## 📍 Where to Add Tracking in Your Code

### 1. **Form Submission** (in `static/script.js` or inline)
```javascript
// When user clicks "Analyze" button
document.getElementById('analyzeBtn').addEventListener('click', function(e) {
    const urlInput = document.getElementById('urlInput').value;
    const platform = determinePlatform(urlInput);
    
    // Track the submission
    TrusKaroAnalytics.trackAnalysisSubmit(platform, urlInput);
    
    // Then submit form...
});
```

### 2. **Results Page - Analysis Complete** (in `templates/_results.html`)
```javascript
{% if show_results %}
<script>
    // Extract data from your template
    const trustScore = {{ summary.trust_score | tojson }};
    const platform = "{{ product.platform | lower }}";
    const fakeCount = {{ summary.fake_count | tojson }};
    const totalReviews = {{ reviews|length | tojson }};
    
    // Track completion
    TrusKaroAnalytics.trackAnalysisComplete(platform, trustScore, totalReviews, fakeCount);
</script>
{% endif %}
```

### 3. **Tab Navigation** (add to existing tab click handlers)
```javascript
// Tab click handler
document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', function() {
        const tabName = this.getAttribute('aria-label') || this.textContent;
        TrusKaroAnalytics.trackTabView(tabName);
    });
});
```

### 4. **Platform Selection**
```javascript
// When user selects a platform
document.getElementById('platform-select').addEventListener('change', function() {
    TrusKaroAnalytics.trackPlatformSelect(this.value);
});
```

### 5. **Price Comparison**
```javascript
// When comparing prices
document.getElementById('compareBtn').addEventListener('click', function() {
    const selectedPlatforms = getSelectedPlatforms();
    TrusKaroAnalytics.trackPriceComparison(selectedPlatforms);
});
```

### 6. **Track External Links**
```javascript
// When user clicks link to Amazon/Flipkart/Myntra
document.querySelectorAll('a[data-platform]').forEach(link => {
    link.addEventListener('click', function() {
        const platform = this.getAttribute('data-platform');
        TrusKaroAnalytics.trackExternalLink(this.href, platform);
    });
});
```

---

## 📊 What Each Function Tracks

| Function | Purpose | Example Data |
|----------|---------|--------------|
| `trackAnalysisSubmit` | User submits product URL | Platform: amazon |
| `trackAnalysisComplete` | Analysis finishes | Trust Score: 8.5, Fake: 22 |
| `trackTabView` | User navigates between tabs | Tab: "Price Comparison" |
| `trackPlatformSelect` | User selects e-commerce site | Platform: flipkart |
| `trackChartInteraction` | User interacts with charts | Chart: volume_comparison |
| `trackTrustScoreInteraction` | User views/clicks trust score | Score: 8.5 |
| `trackPriceComparison` | User compares prices | Platforms: amazon, flipkart |
| `trackSimilarProductView` | Similar products shown | Count: 5 |
| `trackExternalLink` | Clicked link to external site | URL clicked, platform |
| `trackError` | Error occurred | Error type & message |

---

## 🎯 Key Metrics to Monitor

### In Google Analytics Dashboard:

1. **Traffic Overview**
   - Total users / sessions
   - New vs returning users
   - Geographic distribution

2. **Product Analysis Activity**
   - Most analyzed platforms (Amazon, Flipkart, Myntra)
   - Average trust scores analyzed
   - Busiest hours

3. **User Behavior**
   - Which tabs are most viewed
   - How many use price comparison
   - Average session duration

4. **Conversions**
   - Successful analyses completed
   - Share/bookmark rate
   - External link clicks

---

## 🔍 Debugging Analytics

### Enable GA Debug Mode
Add this in browser console:
```javascript
window.gtag('config', 'G-XXXXXXXXXX', {
    'debug_mode': true
});
```

### Check if GA is working
```javascript
// In console, you should see your events logged
console.log(window.dataLayer);
```

### Use Google Analytics Debugger Extension
1. Install: [GA Debugger Chrome Extension](https://chrome.google.com/webstore)
2. Open DevTools
3. Go to "Google Analytics Debugger" tab
4. All events will be logged in real-time

---

## 📋 Implementation Priority

**Phase 1 (Essential)**
- ✅ Add GA tracking code (done)
- ✅ Track analysis submissions
- ✅ Track analysis completions

**Phase 2 (Recommended)**
- Track tab navigation
- Track platform selection
- Track external links

**Phase 3 (Nice to have)**
- Track chart interactions
- Track page performance
- Track scroll depth

---

## ⚡ Performance Note

Google Analytics script is loaded async, so it won't slow down your page. The tracking calls are also non-blocking.

## 🔒 Privacy Considerations

- GA tracks anonymized user data
- No personal info (names, emails) by default
- Users can opt-out via browser extensions
- Add a privacy policy mentioning GA usage

---

**For detailed setup, see: `ANALYTICS_SETUP.md`**
