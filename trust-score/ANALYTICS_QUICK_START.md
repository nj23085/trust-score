# 🚀 TrusKaro Analytics - Quick Start Guide

## ✅ What's Already Done

Your Flask app is **90% ready for tracking**! Here's what I've implemented:

### Code Changes Made:

1. **app.py** - Added Google Analytics configuration
   ```python
   GOOGLE_ANALYTICS_ID = "G-XXXXXXXXXX"
   app.config['GA_ID'] = GOOGLE_ANALYTICS_ID
   ```

2. **templates/index.html** - Added GA tracking script (uses Jinja2 variable)
   - GA script loads asynchronously
   - Ready to track all events

3. **Auto-Tracking Implemented:**
   ✅ Form submissions (track which platform selected)
   ✅ Analysis completions (trust score, fake count, etc)
   ✅ Tab navigation (which tab user views)

---

## 📍 NEXT STEP: Get Your Google Analytics ID

### Option 1: Create New Google Analytics Account (2 min)

1. Go to: **https://analytics.google.com/**
2. Sign in with Gmail account
3. Click **"Start measuring"**
4. Fill in:
   - Account name: `TrusKaro`
   - Property name: `TrusKaro Website`
   - Website URL: `http://127.0.0.1:8010` (local) or your domain
   - Industry: `Retail`
   - Timezone: `India`
5. Accept terms & click **"Create"**
6. **Copy your Measurement ID** (looks like: `G-ABCDE1F2G3`)

### Option 2: Use Existing Google Analytics Account

- Go to: https://analytics.google.com/
- Select your property
- Go to **Admin** → **Data streams** → **Web**
- Copy the **Measurement ID**

---

## 🔑 Add Your Measurement ID to TrusKaro

### Step 1: Open `app.py`
Find this line (around line 42):
```python
GOOGLE_ANALYTICS_ID = "G-XXXXXXXXXX"
```

### Step 2: Replace with Your ID
```python
GOOGLE_ANALYTICS_ID = "G-ABC123DEF45"  # Your actual ID from GA
```

### Step 3: Save and Restart Flask

```bash
# Stop current Flask server (Ctrl+C)

# Restart
python app.py
```

**That's it!** ✅ Analytics are now active!

---

## 📊 How to Monitor in Real-Time

1. Go to: **https://analytics.google.com/**
2. Select your property (TrusKaro Website)
3. Click **"Real-time"** in left sidebar
4. You should see live users instantly!

### What You'll See:
- **Users by country/city**
- **Current page views**
- **Events happening right now**
- **Traffic sources**

---

## 📈 Events Being Tracked (Automatic)

| Event | When? | Data Captured |
|-------|-------|---------------|
| `product_analysis_submit` | User enters URL & clicks submit | Platform (amazon/flipkart/myntra) |
| `analysis_complete` | Results page loads | Trust score, fake %, reviews analyzed |
| `view_analysis_tab` | User clicks tab (Overview/Analysis/Price/Similar) | Which tab viewed |

---

## 🧪 Test It Now!

1. **Ensure Flask is running** with updated `app.py`
2. **Open your website**: http://127.0.0.1:8010
3. **Submit a product URL** (Amazon, Flipkart, or Myntra)
4. **Go to Google Analytics**:
   - Click **Real-time** → **Events**
   - You should see `product_analysis_submit` event!
5. **Wait for results** to load
   - Check Real-time again
   - You should see `analysis_complete` event!
6. **Click different tabs** (Analysis, Prices, Similar)
   - Check Real-time → Events
   - You should see `view_analysis_tab` events!

---

## 📋 Verify Tracking is Working

### In Browser Console:
Open DevTools (F12) and check console:
```
[Analytics] Tracked analysis submission for amazon
[Analytics] Analysis completed - Trust Score: 8.5, Fake: 22/150
[Analytics] Viewed tab: Overview
```

### In Google Analytics:
1. Go to: https://analytics.google.com/
2. Select your property
3. Go to **Reports** → **Real-time** → **Events**
4. You should see events listed

---

## 📊 Where to Find Key Metrics

### Dashboard (Home)
- **Acquisition** → See where users come from
- **Active Users** → Right now, today, this month

### Engagement
- **Events** → All tracked events
- **Conversions** → Custom goals (setup separate)

### User Overview
- **Users by Location** → Geography
- **Device** → Desktop/Mobile/Tablet

---

## 🎯 Recommended Views to Create

### 1. Product Analysis Funnels
- Track: URL Submit → Analysis Complete → Tab Views

### 2. Platform Performance
- Compare Amazon vs Flipkart vs Myntra usage

### 3. Trust Score Distribution
- See average trust scores users analyze

---

## ⚙️ Configuration Options

### Change GA ID Later
1. Open `app.py`
2. Update `GOOGLE_ANALYTICS_ID` value
3. Restart Flask

### Disable Analytics (if needed)
Set in `app.py`:
```python
GOOGLE_ANALYTICS_ID = None
```

---

## 🔍 Advanced: Additional Tracking

The system is setup to easily add more tracking. To add custom events:

```javascript
// In any template JavaScript:
gtag('event', 'custom_event_name', {
    'parameter_1': value1,
    'parameter_2': value2
});
```

Example - track button clicks:
```javascript
document.getElementById('myButton').addEventListener('click', () => {
    gtag('event', 'button_clicked', {
        'button_name': 'Compare Prices'
    });
});
```

---

## 📞 Troubleshooting

### "No events showing in Real-time"
1. **Verify GA ID is correct** in `app.py`
2. **Flask restarted?** (Changes require restart)
3. **Give it 30 seconds** (Real-time can have slight delay)
4. **Check browser console** for errors (F12)
5. **Clear browser cache** (Ctrl+Shift+Del)

### "Events showing but with wrong data"
1. Check browser console for error messages
2. Verify Jinja2 variables are rendering correctly
3. Check network tab (F12) for GA requests

### "Still not working?"
1. Check GA Measurement ID is 100% correct (no spaces)
2. Try in Incognito mode (avoids extensions)
3. Wait 24-48 hours (GA can take time to populate data)

---

## 🚀 Next Steps After Verification

1. **Monitor for a week** to see usage patterns
2. **Create custom reports** for product comparison
3. **Set up email alerts** for traffic anomalies
4. **Add more events** as needed (see Analytics Usage guide)

---

## 📚 Files Modified

- `app.py` - Added GA configuration & passed to template
- `templates/index.html` - Added GA script with dynamic ID
- `templates/_results.html` - Added tracking for analysis completion
- `templates/_charts_js.html` - Added tracking for tab navigation
- `static/analytics.js` - Helper functions for advanced tracking

---

**🎉 You're all set!** Start monitoring your TrusKaro traffic now!
