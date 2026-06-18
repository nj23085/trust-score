import sys

# Force UTF-8 encoding for stdout/stderr to prevent logging crashes on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from flask import Flask, render_template, request, redirect, url_for, jsonify, session, flash
from functools import wraps
from flask_cors import CORS
import pandas as pd
import time
import pickle
import string
import re
import os
import uuid
import threading
import numpy as np
from collections import Counter
from scipy.sparse import hstack, csr_matrix
from textblob import TextBlob




# ============================================
# INITIALIZE FLASK APP
# ============================================
# SET BASE DIRECTORY
# ============================================
base_dir = os.path.dirname(os.path.abspath(__file__))

# ============================================
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "fallback-dev-key")  # FIXED: use env variable
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ============================================
# GOOGLE ANALYTICS CONFIGURATION
# ============================================
# Replace G-XXXXXXXXXX with your real Measurement ID from analytics.google.com
GOOGLE_ANALYTICS_ID = os.environ.get("GA_ID", "G-XXXXXXXXXX")
app.config['GA_ID'] = GOOGLE_ANALYTICS_ID

# ============================================
# IN-MEMORY STORE FOR LATEST ANALYSIS (no DB)
# ============================================
latest_result = {}
latest_result_lock = threading.Lock()

# ============================================
# LOAD TRAINED MODELS & ALL 8 PKL FILES
# ============================================

model_lgbm      = pickle.load(open(os.path.join(base_dir, "model_lgbm.pkl"),       "rb"))
model_sgd       = pickle.load(open(os.path.join(base_dir, "model_sgd.pkl"),        "rb"))
model_lr_base   = pickle.load(open(os.path.join(base_dir, "model_lr_base.pkl"),    "rb"))
model_meta      = pickle.load(open(os.path.join(base_dir, "model_meta.pkl"),       "rb"))
word_vectorizer = pickle.load(open(os.path.join(base_dir, "word_vectorizer.pkl"),  "rb"))
char_vectorizer = pickle.load(open(os.path.join(base_dir, "char_vectorizer.pkl"),  "rb"))
scaler          = pickle.load(open(os.path.join(base_dir, "scaler.pkl"),           "rb"))
config          = pickle.load(open(os.path.join(base_dir, "config.pkl"),           "rb"))

# Extract config values
THRESHOLD  = config.get("threshold", 0.5)
EXTRA_COLS = config.get("extra_cols", None)



# ============================================
# ASYNC JOB STORE
# { job_id: { status, progress, message, collected, result, platform } }
# ============================================
jobs      = {}
jobs_lock = threading.Lock()

# ============================================
# PRICE COMPARISON SESSION STORE (BuyHatke)
# { session_id: { status, product_title, results, product_url } }
# ============================================
price_sessions      = {}
price_sessions_lock = threading.Lock()


# ============================================
# HELPER: update a job's fields thread-safely
# ============================================
def _update_job(job_id, **kwargs):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(kwargs)


# ============================================
# TEXT CLEANING  (must match model.py exactly)
# ============================================
indian_map = {
    r"\bvery good\b":    "verygood",
    r"\bno good\b":      "nogood",
    r"\bnot good\b":     "notgood",
    r"\bbest quality\b": "bestquality",
    r"\bgood quality\b": "goodquality",
    r"\bbad quality\b":  "badquality",
    r"\bfast delivery\b":"fastdelivery",
    r"\blate delivery\b":"latedelivery",
}

def clean_text(text):
    text = str(text).lower()
    for pat, repl in indian_map.items():
        text = re.sub(pat, repl, text)
    text = re.sub(r'\d+', '', text)
    text = re.sub(r'(.)\1{2,}', r'\1', text)
    text = re.sub(r'\b\w{1,2}\b', '', text)
    text = re.sub(r'\s+', ' ', text)
    text = text.translate(str.maketrans('', '', string.punctuation))
    return text.strip()


# ============================================
# EXTRACT ASIN FROM AMAZON URL
# ============================================
def extract_asin(url):
    match = re.search(r"/(?:dp|product)/([A-Z0-9]{10})", url)
    return match.group(1) if match else None


# ============================================
# SHARED ML ANALYSIS PIPELINE
# ============================================
def analyze_reviews(review_texts, product_title, product_image=None):
    if not review_texts:
        return None

    df= pd.DataFrame(review_texts, columns=["review"])
    df["clean"] = df["review"].apply(clean_text)

    try:
        # ---- TF-IDF TEXT FEATURES ----
        X_word = word_vectorizer.transform(df["clean"])
        X_char = char_vectorizer.transform(df["clean"])
        X_text = hstack([X_word, X_char])

        # ---- 22 HANDCRAFTED FEATURES (must match model.py exactly) ----
        positive_words = ["best", "amazing", "awesome", "perfect", "excellent",
                          "fantastic", "love", "great", "superb", "outstanding"]
        negative_words = ["worst", "terrible", "horrible", "useless", "garbage",
                          "waste", "fake", "fraud", "broken", "pathetic"]
        first_person   = {"i", "me", "my", "myself", "mine"}

        df["word_count"]          = df["review"].apply(lambda x: len(x.split()))
        df["review_length"]       = df["review"].apply(len)
        df["sentiment_score"]     = df["review"].apply(lambda x: TextBlob(str(x)).sentiment.polarity)
        df["subjectivity_score"]  = df["review"].apply(lambda x: TextBlob(str(x)).sentiment.subjectivity)
        df["exclamation_count"]   = df["review"].apply(lambda x: x.count("!"))
        df["caps_words"]          = df["review"].apply(lambda x: sum(1 for w in x.split() if w.isupper()))
        df["avg_word_length"]     = df["review"].apply(
            lambda x: np.mean([len(w) for w in x.split()]) if x.split() else 0)
        df["repeated_words"]      = df["review"].apply(lambda x: len(x.split()) - len(set(x.split())))
        df["positive_word_count"] = df["review"].apply(
            lambda x: sum(w in x.lower().split() for w in positive_words))
        df["negative_word_count"] = df["review"].apply(
            lambda x: sum(w in x.lower().split() for w in negative_words))
        df["unique_word_ratio"]   = df["review"].apply(
            lambda x: len(set(x.lower().split())) / max(len(x.split()), 1))
        df["pronoun_ratio"]       = df["review"].apply(
            lambda x: sum(w in first_person for w in x.lower().split()) / max(len(x.split()), 1))
        df["punct_density"]       = df["review"].apply(
            lambda x: sum(1 for c in x if c in string.punctuation) / max(len(x), 1))
        df["question_count"]      = df["review"].apply(lambda x: x.count("?"))
        df["caps_ratio"]          = df["review"].apply(
            lambda x: sum(1 for c in x if c.isupper()) / max(len(x), 1))
        df["platform_feature"]    = 0  # Default: unknown platform from scraping

        # Metadata defaults (not available from scraping)
        df["verified_purchase"] = 0
        df["helpful_vote_log"]  = 0.0
        df["burst_flag"]        = 0
        df["is_very_short"]     = (df["word_count"] < 10).astype(int)
        df["is_very_long"]      = (df["word_count"] > 300).astype(int)
        df["rating_extreme"]    = 0

        # Use extra_cols from config.pkl so column order always matches training
        extra_cols = EXTRA_COLS if EXTRA_COLS else [
            "word_count", "review_length", "sentiment_score", "subjectivity_score",
            "exclamation_count", "caps_words", "avg_word_length", "repeated_words",
            "positive_word_count", "negative_word_count", "unique_word_ratio",
            "pronoun_ratio", "punct_density", "question_count", "caps_ratio",
            "platform_feature", "verified_purchase", "helpful_vote_log", "burst_flag",
            "is_very_short", "is_very_long", "rating_extreme"
        ]

        extra_scaled = scaler.transform(df[extra_cols])
        X_final      = hstack([X_text, csr_matrix(extra_scaled)])

        # ---- 3-LEARNER STACKING ENSEMBLE ----
        prob_lgbm  = model_lgbm.predict_proba(X_final)[:, 1]
        prob_sgd   = model_sgd.predict_proba(X_final)[:, 1]
        prob_lr    = model_lr_base.predict_proba(X_final)[:, 1]
        meta_X     = np.column_stack([prob_lgbm, prob_sgd, prob_lr])
        meta_probs = model_meta.predict_proba(meta_X)[:, 1]
        predictions = (meta_probs > THRESHOLD).astype(int)

    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": f"Model error: {str(e)}"}

    normalized_predictions = pd.Series(predictions).map({0: "genuine", 1: "fake"})
    total            = len(normalized_predictions)
    fake_count       = int((normalized_predictions == "fake").sum())
    genuine_count    = total - fake_count
    fake_percentage  = round((fake_count    / total) * 100, 2)
    genuine_percentage = round((genuine_count / total) * 100, 2)

    df["prediction"] = normalized_predictions.values
    df["confidence"] = np.round(
        np.where(predictions == 1, meta_probs, 1 - meta_probs) * 100, 1)

    # ---- KEYWORD ANALYSIS (top terms in fake reviews) ----
    stop_words = {
        "this", "that", "with", "have", "very", "from", "they", "them", "your", "about",
        "there", "would", "could", "should", "been", "were", "when", "what", "will",
        "also", "just", "only", "really", "after", "before", "than", "then", "into",
        "because", "amazon", "product", "review", "reviews", "good", "best"
    }
    fake_tokens = []
    for text in df[df["prediction"] == "fake"]["clean"]:
        fake_tokens.extend(
            w for w in text.split()
            if len(w) > 3 and w.isalpha() and w not in stop_words
        )
    keyword_counts  = Counter(fake_tokens).most_common(8)
    keyword_labels  = [k[0] for k in keyword_counts] if keyword_counts else ["No terms"]
    keyword_values  = [k[1] for k in keyword_counts] if keyword_counts else [0]

    review_table = df[["review", "prediction", "confidence", "sentiment_score", "subjectivity_score", "exclamation_count"]].to_dict(orient="records")

    # ---- PRODUCT SUMMARY GENERATION ----
    genuine_df = df[df["prediction"] == "genuine"]
    fake_df    = df[df["prediction"] == "fake"]

    # Usefulness: based on avg sentiment of genuine reviews
    avg_genuine_sentiment = genuine_df["sentiment_score"].mean() if len(genuine_df) > 0 else 0
    if avg_genuine_sentiment >= 0.3:
        usefulness = "Highly Useful"
        usefulness_detail = "Genuine reviewers express strong satisfaction. The product appears to deliver on its promises and meets customer expectations well."
    elif avg_genuine_sentiment >= 0.1:
        usefulness = "Moderately Useful"
        usefulness_detail = "Genuine reviews show a generally positive experience, though some users have mixed feelings. The product works but may not exceed expectations."
    elif avg_genuine_sentiment >= -0.1:
        usefulness = "Average"
        usefulness_detail = "Genuine reviews are neutral overall. The product appears functional but doesn't strongly impress or disappoint buyers."
    else:
        usefulness = "Below Expectations"
        usefulness_detail = "Genuine reviewers express dissatisfaction. The product may not meet the quality or functionality buyers expect."

    usefulness_score = max(0, min(100, int((avg_genuine_sentiment + 1) / 2 * 100)))

    # Risk: based on fake percentage
    if fake_percentage <= 10:
        risk_level = "Low Risk"
        risk_detail = f"Only {fake_percentage}% of reviews were flagged as fake. This product's reviews are largely trustworthy and you can rely on the overall sentiment."
    elif fake_percentage <= 30:
        risk_level = "Moderate Risk"
        risk_detail = f"{fake_percentage}% of reviews were flagged as potentially fake. Exercise some caution — check the genuine reviews carefully before buying."
    elif fake_percentage <= 60:
        risk_level = "High Risk"
        risk_detail = f"{fake_percentage}% of reviews appear to be fake. The overall rating may be artificially inflated. Be very cautious and look for detailed, verified reviews."
    else:
        risk_level = "Very High Risk"
        risk_detail = f"A significant {fake_percentage}% of reviews are flagged as fake. The product's reputation is heavily manufactured. We strongly recommend caution."

    risk_score = max(0, min(100, int(fake_percentage)))

    # Value for Money: analyze price-related keywords in genuine reviews
    value_keywords_pos = ["worth", "value", "affordable", "cheap", "bargain", "great price", "reasonable", "budget"]
    value_keywords_neg = ["expensive", "overpriced", "not worth", "waste of money", "rip off", "ripoff", "costly", "too much"]
    pos_value_hits = 0
    neg_value_hits = 0
    for text in genuine_df["review"].str.lower():
        for kw in value_keywords_pos:
            if kw in text:
                pos_value_hits += 1
        for kw in value_keywords_neg:
            if kw in text:
                neg_value_hits += 1

    total_value_mentions = pos_value_hits + neg_value_hits
    if total_value_mentions == 0:
        value_verdict = "Inconclusive"
        value_detail = "Not enough genuine reviewers mentioned pricing or value to form a conclusion. Consider checking the price against similar products."
        value_score = 50
    elif pos_value_hits > neg_value_hits * 2:
        value_verdict = "Great Value"
        value_detail = f"Genuine reviewers frequently praise the product's value for money. {pos_value_hits} positive price mentions vs {neg_value_hits} negative — buyers feel the price is well justified."
        value_score = min(95, 60 + int((pos_value_hits / max(total_value_mentions, 1)) * 40))
    elif pos_value_hits > neg_value_hits:
        value_verdict = "Fair Value"
        value_detail = f"Most genuine reviewers consider the price reasonable, though some disagree. {pos_value_hits} positive vs {neg_value_hits} negative mentions."
        value_score = 50 + int((pos_value_hits - neg_value_hits) / max(total_value_mentions, 1) * 30)
    else:
        value_verdict = "Overpriced"
        value_detail = f"Genuine reviewers tend to feel the product is overpriced. {neg_value_hits} negative price mentions vs {pos_value_hits} positive — the price may not be justified."
        value_score = max(10, 50 - int((neg_value_hits / max(total_value_mentions, 1)) * 40))

    # Trust Score: out of 10 based on ratio of genuine to fake reviews
    trust_score = round((genuine_count / max(total, 1)) * 10, 1) if total > 0 else 0

    product_summary = {
        "usefulness": usefulness,
        "usefulness_detail": usefulness_detail,
        "usefulness_score": usefulness_score,
        "risk_level": risk_level,
        "risk_detail": risk_detail,
        "risk_score": risk_score,
        "value_verdict": value_verdict,
        "value_detail": value_detail,
        "value_score": value_score,
        "trust_score": trust_score,
    }

    return {
        "product":             product_title,
        "total":               total,
        "fake":                fake_count,
        "genuine":             genuine_count,
        "fake_percentage":     fake_percentage,
        "genuine_percentage":  genuine_percentage,
        "keyword_labels":      keyword_labels,
        "keyword_values":      keyword_values,
        "reviews":             review_table,
        "product_image":       product_image,
        "show_results":        True,
        "summary":             product_summary,
    }


# ============================================
# AUTH DECORATOR
# ============================================
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated_function

# ============================================
# ROUTES
# ============================================

@app.route("/")
def home():
    return render_template("index.html", ga_id=app.config['GA_ID'])

@app.route("/about")
def about_page():
    return render_template("about.html", ga_id=app.config['GA_ID'])  # FIXED: added ga_id

# ============================================
# PRIVACY & TERMS ROUTES  (NEW)
# ============================================
@app.route("/privacy")
def privacy():
    return render_template("_privacy_policy.html", ga_id=app.config['GA_ID'])

@app.route("/terms")
def terms():
    return render_template("_terms_conditions.html", ga_id=app.config['GA_ID'])

# Redirect old platform pages to home
@app.route("/amazon")
@app.route("/flipkart")
@app.route("/myntra")
def platform_redirect():
    return redirect(url_for("home"))

# ---- ADMIN ROUTES ----
@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        if username == "admin" and password == os.environ.get("ADMIN_PASSWORD", "changeme"):  # FIXED
            session['logged_in'] = True
            return redirect(url_for('admin_dashboard'))
        else:
            return render_template("admin_login.html", error="Invalid credentials")
    return render_template("admin_login.html")

@app.route("/admin/logout")
def admin_logout():
    session.pop('logged_in', None)
    return redirect(url_for('admin_login'))

@app.route("/admin")
@login_required
def admin_dashboard():
    with latest_result_lock:
        data = latest_result.copy()
    return render_template("admin.html",
        reviews=data.get("reviews", []),
        product=data.get("product", "No product analyzed yet"),
        platform=data.get("platform", ""),
        total=data.get("total", 0),
        fake=data.get("fake", 0),
        genuine=data.get("genuine", 0)
    )

# ---- PROGRESS POLLING ENDPOINT ----
@app.route("/progress/<job_id>")
def get_progress(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"status": "error", "message": "Job not found"}), 404
    return jsonify({
        "status":    job.get("status",    "pending"),
        "progress":  job.get("progress",  0),
        "message":   job.get("message",   ""),
        "collected": job.get("collected", 0),
    })

# ---- RESULT PAGE (called by JS after job completes) ----
@app.route("/result/<job_id>")
def get_result(job_id):
    with jobs_lock:
        job = jobs.pop(job_id, None)   # consume — frees memory
    if not job or job.get("status") != "done":
        return redirect(url_for("home"))
    results  = job["result"]
    platform = job.get("platform", "flipkart")
    source   = job.get("source", "platform")

    if platform == "amazon":
        results["logged_in"] = True

    # Inject product_link so the Price Comparison tab can trigger a search
    results.setdefault("product_link", job.get("product_link", ""))

    results["price_session_id"] = request.args.get("psid", "")

    # Always render results via the unified home page
    return render_template("index.html", ga_id=app.config['GA_ID'], **results)

# ---- LEGACY FORM FALLBACKS ----
@app.route("/analyze/amazon", methods=["POST"])
@app.route("/analyze/flipkart", methods=["POST"])
@app.route("/analyze/myntra", methods=["POST"])
def analyze_legacy():
    return render_template("index.html", error="Please install the TrusKaro Chrome Extension to analyze products. Server-side scraping is disabled.")

# ============================================
# API: EXTENSION-POWERED ANALYSIS
# ============================================
@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    reviews       = data.get("reviews", [])
    platform      = data.get("platform", "flipkart")
    product_title = data.get("product_title", "Product")
    product_image = data.get("product_image", None)
    product_link  = data.get("product_link", "")
    source        = data.get("source", "platform")

    if not reviews or len(reviews) == 0:
        return jsonify({"error": "No reviews provided"}), 400

    results = analyze_reviews(reviews, product_title, product_image)

    if not results:
        return jsonify({"error": "Analysis returned no results"}), 500
    if "error" in results:
        return jsonify({"error": results["error"]}), 500

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "status":       "done",
            "progress":      100,
            "message":       "Analysis complete!",
            "result":        results,
            "platform":      platform,
            "source":        source,
            "collected":     len(reviews),
            "product_link":  product_link,
        }

    with latest_result_lock:
        latest_result.clear()
        latest_result.update({
            "reviews":  results["reviews"],
            "product":  product_title,
            "platform": platform,
            "total":    results["total"],
            "fake":     results["fake"],
            "genuine":  results["genuine"],
        })

    return jsonify({"job_id": job_id, "total": len(reviews)})



# ============================================
# API: NO-REVIEWS FALLBACK
# When extension finds 0 reviews, still create a job so
# price comparison and similar products work normally.
# The result page will show "No reviews found" on overview/analysis tabs.
# ============================================
@app.route("/api/analyze/no-reviews", methods=["POST"])
def api_analyze_no_reviews():
    """Called by extension when product has 0 reviews. Skips ML, still enables price compare."""
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400

    platform      = data.get("platform", "flipkart")
    product_title = data.get("product_title", "Product")
    product_image = data.get("product_image", None)
    product_link  = data.get("product_link", "")
    source        = data.get("source", "platform")

    # Build a zero-reviews result — price compare still works via job_id
    results = {
        "product":            product_title,
        "total":              0,
        "fake":               0,
        "genuine":            0,
        "fake_percentage":    0.0,
        "genuine_percentage": 0.0,
        "keyword_labels":     [],
        "keyword_values":     [],
        "reviews":            [],
        "product_image":      product_image,
        "show_results":       True,
        "no_reviews":         True,   # flag used by template to show the empty state
        "summary": {
            "usefulness":        "N/A",
            "usefulness_detail": "No reviews were found for this product.",
            "usefulness_score":  0,
            "risk_level":        "N/A",
            "risk_detail":       "Cannot assess risk — no reviews to analyse.",
            "risk_score":        0,
            "value_verdict":     "N/A",
            "value_detail":      "No reviews available to judge value for money.",
            "value_score":       0,
            "trust_score":       0,
        },
    }

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "status":      "done",
            "progress":     100,
            "message":      "No reviews found.",
            "result":       results,
            "platform":     platform,
            "source":       source,
            "collected":    0,
            "product_link": product_link,
        }

    return jsonify({"job_id": job_id, "total": 0})


# ============================================
# PRICE COMPARISON APIs  (BuyHatke integration)
# ============================================

@app.route("/api/price/start", methods=["POST"])
def price_start():
    data       = request.get_json(force=True) or {}
    product_url = data.get("url", "")
    session_id  = str(uuid.uuid4())[:8]

    with price_sessions_lock:
        price_sessions[session_id] = {
            "status":        "pending",
            "product_url":   product_url,
            "product_title": "",
            "results":       [],
            "similar_products": [],
        }

    print(f"[PriceSession {session_id}] Started for: {product_url}")
    return jsonify({"status": "success", "session_id": session_id})


@app.route("/api/price/submit", methods=["POST"])
def price_submit():
    data       = request.get_json(force=True) or {}
    session_id = data.get("session_id", "")

    with price_sessions_lock:
        if session_id not in price_sessions:
            return jsonify({"status": "error", "message": "Invalid session ID"}), 400
        sess = price_sessions[session_id]
        sess["product_title"]    = data.get("product_title", "")
        sess["results"]          = data.get("results", [])
        sess["similar_products"] = data.get("similar_products", [])
        sess["status"]           = "done"

    print(f"[PriceSession {session_id}] Done. "
          f"Title: {sess['product_title']} | "
          f"Results: {len(sess['results'])} | "
          f"Similar: {len(sess['similar_products'])}")
    return jsonify({"status": "success"})


@app.route("/api/price/poll/<session_id>", methods=["GET"])
def price_poll(session_id):
    with price_sessions_lock:
        sess = price_sessions.get(session_id)
    if not sess:
        return jsonify({"status": "error", "message": "Invalid session ID"}), 404

    return jsonify({
        "status":           sess["status"],
        "product_title":    sess["product_title"],
        "results":          sess["results"] if sess["status"] == "done" else [],
        "similar_products": sess.get("similar_products", []) if sess["status"] == "done" else [],
    })


# ============================================
# RUN
# ============================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=False, port=8010, use_reloader=False)  # FIXED: debug=False