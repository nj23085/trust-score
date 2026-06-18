# Analytics Setup Guide for TrusKaro

## 🔧 Google Analytics 4 Setup

### Step 1: Get Your Measurement ID
1. Visit [Google Analytics](https://analytics.google.com/)
2. Create a new property (name: "TrusKaro" or similar)
3. Copy your **Measurement ID** (looks like: `G-XXXXXXXXXX`)

### Step 2: Add to Flask Config
Create a file `config.py` or update your existing one:

```python
# config.py
GOOGLE_ANALYTICS_ID = "G-XXXXXXXXXX"  # Replace with your ID
```

### Step 3: Update Templates
Replace `G-XXXXXXXXXX` in `templates/index.html` (line ~20) with your actual Measurement ID.

### Step 4: Test Installation
1. Visit your website
2. Open Google Analytics dashboard
3. Go to **Real-time** → You should see live users

---

## 📊 Custom Event Tracking

### Track Product Analysis Submissions
Add this to your JavaScript (in `templates/index.html`):

```javascript
function trackAnalysisSubmit(platform) {
    gtag('event', 'product_analysis', {
        'platform': platform,  // amazon, flipkart, myntra
        'timestamp': new Date().toISOString()
    });
}
```

Trigger on form submission:
```javascript
document.getElementById('analyzeBtn').addEventListener('click', function() {
    const platform = document.getElementById('platform-select').value;
    trackAnalysisSubmit(platform);
});
```

### Track Analysis Completion
Add to results page (`templates/_results.html`):

```javascript
function trackAnalysisComplete(platform, trustScore, fakeCount) {
    gtag('event', 'analysis_complete', {
        'platform': platform,
        'trust_score': trustScore,
        'fake_reviews': fakeCount,
        'duration': Date.now() - startTime
    });
}
```

### Track Tab Navigation
```javascript
function trackTabView(tabName) {
    gtag('event', 'page_view', {
        'page_title': 'Analysis - ' + tabName,
        'page_location': '/analysis#' + tabName
    });
}

// Track when tabs are clicked
document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', function() {
        trackTabView(this.textContent);
    });
});
```

---

## 📈 What You Can Track

### Key Metrics to Monitor:
1. **User Sessions**: Total visits, returning users
2. **Conversion**: Product analyses submitted
3. **Engagement**: Time on page, tab clicks
4. **Performance**: Page load times
5. **Platform Usage**: Which e-commerce site is analyzed most
6. **Trust Scores**: Average trust score distribution

### Create Goals/Conversions in GA4:
1. Go to **Admin** → **Events**
2. Click **Create event**
3. Name: `product_analysis` or `analysis_complete`
4. Set it as a conversion

---

## 🚀 Alternative Analytics Solutions

### 1. **Plausible Analytics** (Privacy-Friendly, Paid)
- No cookie banner needed (GDPR compliant)
- Simpler dashboard than GA
- Cost: ~$9/month
- Setup: One line of code
```html
<script defer data-domain="yoursite.com" src="https://plausible.io/js/script.js"></script>
```

### 2. **Fathom Analytics** (Privacy-Focused, Paid)
- GDPR compliant
- Beautiful dashboard
- Cost: ~$14/month
- Setup: Copy one script tag
```html
<script src="https://cdn.usefathom.com/script.js" data-site="XXXXX" defer></script>
```

### 3. **Matomo** (Self-Hosted, Free)
- Full control, self-hosted
- Privacy compliant
- Setup: Download and host on your server
- Best for: Complete control, no third-party data

### 4. **Mixpanel** (Event-Based, Free tier available)
- Advanced event tracking
- Better for product analytics
- Free tier: 100K events/month
- Good for: Understanding user behavior

### 5. **Simple Custom Analytics** (DIY)
- Log pageviews to your database
- Track events via Flask endpoints
- Cost: Only server costs
- Example:
```python
@app.route('/track-event', methods=['POST'])
def track_event():
    event_data = request.json
    # Save to database
    Analytics.create(
        event_type=event_data['event'],
        platform=event_data.get('platform'),
        user_ip=request.remote_addr,
        timestamp=datetime.now()
    )
    return {'status': 'ok'}
```

---

## 🛠️ Recommended Setup for TrusKaro

### Best Option: **Google Analytics + Custom Events**
- **Why**: Free, industry standard, detailed reports
- **Setup Time**: 10 minutes
- **Learning Curve**: Medium
- **Tracking Options**: Unlimited

### Alternative: **Plausible (if GDPR important)**
- **Why**: Privacy-first, no cookie banner, simpler
- **Cost**: $9/month
- **Setup Time**: 5 minutes
- **Learning Curve**: Easy

### DIY: **Custom Analytics Dashboard**
- Create a simple database table to log events
- Build a Flask dashboard to view stats
- Cost: Free
- Setup Time: 2-3 hours

---

## 📋 Implementation Checklist

- [ ] Create Google Analytics account
- [ ] Get Measurement ID
- [ ] Replace `G-XXXXXXXXXX` in index.html
- [ ] Test with Real-time tracking
- [ ] Add custom event tracking for form submission
- [ ] Add tracking for analysis completion
- [ ] Create conversion goals in GA4
- [ ] Set up email alerts for anomalies
- [ ] Review reports weekly

---

## 🔗 Useful Links

- [Google Analytics Setup Guide](https://support.google.com/analytics/answer/1008015)
- [GA4 Event Tracking](https://support.google.com/analytics/answer/9234069)
- [Plausible Docs](https://plausible.io/docs)
- [Fathom Analytics Setup](https://usefathom.com/docs)

---

## ⚠️ Important Notes

1. **Privacy**: Make sure you have a privacy policy mentioning analytics
2. **GDPR**: If EU users, consider privacy-friendly options (Plausible/Fathom)
3. **Data Retention**: Set GA4 to keep data for 14 days minimum
4. **Testing**: Use Google Analytics Debugger extension to test events

---

**Quick Start**: Replace `G-XXXXXXXXXX` with your Measurement ID in `templates/index.html` and you're good to go! 🎉
