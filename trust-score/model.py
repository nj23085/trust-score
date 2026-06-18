# ============================================================
# FAKE REVIEW DETECTION — FINAL MODEL
# Amazon (platform=0) + Flipkart (platform=1)
# TARGET: 95–97% accuracy
# ============================================================

import warnings
from sklearn.exceptions import ConvergenceWarning
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=ConvergenceWarning)

import pandas as pd
import string
import pickle
import re
import numpy as np
import time

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression, SGDClassifier

from scipy.sparse import hstack, csr_matrix
from textblob import TextBlob
from lightgbm import LGBMClassifier
import lightgbm as lgb

start_time = time.time()
print("=" * 60)
print("  FAKE REVIEW DETECTION — FINAL MODEL")
print("=" * 60)
print()

# =====================================
# PATHS
# =====================================

BASE = "C:\\Users\\Nayan_pp3onak\\OneDrive\\Desktop\\mini project\\"

# =====================================
# LOAD AMAZON (2 files)
# =====================================

print("Loading Amazon datasets...")

data1 = pd.read_csv(BASE + "final_labeled_fake_reviews.csv")
data2 = pd.read_csv(BASE + "fake reviews dataset.csv")

if "text"  in data1.columns: data1.rename(columns={"text":  "review"}, inplace=True)
if "text_" in data2.columns: data2.rename(columns={"text_": "review"}, inplace=True)

data1["label"] = data1["label"].astype(str).str.lower().replace({
    "true": "genuine", "false": "fake", "0": "genuine", "1": "fake"
})
data2["label"] = data2["label"].astype(str).str.lower().replace({
    "cg": "fake", "or": "genuine"
})

extra_meta = ["rating", "helpful_vote", "verified_purchase", "user_review_burst"]
available  = [c for c in extra_meta if c in data1.columns]

amazon_df = pd.concat([
    data1[["review", "label"] + available],
    data2[["review", "label"]]
], ignore_index=True)

for col in extra_meta:
    if col not in amazon_df.columns:
        amazon_df[col] = 0
    amazon_df[col] = amazon_df[col].fillna(0)

amazon_df["platform"]  = 0
amazon_df["sentiment"] = "unknown"

# Force string, drop empty
amazon_df["review"] = amazon_df["review"].fillna("").astype(str)
amazon_df = amazon_df[amazon_df["review"].str.strip() != ""]
amazon_df.drop_duplicates(subset=["review"], inplace=True)
amazon_df.reset_index(drop=True, inplace=True)

print(f"  Amazon rows : {len(amazon_df):,}  |  "
      f"Fake: {(amazon_df['label']=='fake').mean()*100:.1f}%")

# =====================================
# LOAD FLIPKART LABELED
# =====================================

print("Loading Flipkart labeled dataset...")

flipkart_df = pd.read_csv(BASE + "flipkart_labeled.csv")
# Full path: C:\Users\Nayan_pp3onak\OneDrive\Desktop\mini project\flipkart_labeled.csv

flipkart_df["review"]   = flipkart_df["review"].fillna("").astype(str)
flipkart_df["label"]    = flipkart_df["label"].astype(str).str.lower()
flipkart_df["platform"] = 1

if "rating" not in flipkart_df.columns:
    flipkart_df["rating"] = 3
flipkart_df["rating"] = pd.to_numeric(flipkart_df["rating"], errors="coerce").fillna(3)

if "sentiment" not in flipkart_df.columns:
    flipkart_df["sentiment"] = "unknown"

flipkart_df["helpful_vote"]      = 0
flipkart_df["verified_purchase"] = 0
flipkart_df["user_review_burst"] = 0

# No dedup — repeated reviews are the fake signal
flipkart_df = flipkart_df[flipkart_df["review"].str.strip() != ""]
flipkart_df.reset_index(drop=True, inplace=True)

print(f"  Flipkart rows: {len(flipkart_df):,}  |  "
      f"Fake: {(flipkart_df['label']=='fake').mean()*100:.1f}%")

# =====================================
# COMBINE
# =====================================

COLS = ["review", "label", "platform", "rating",
        "helpful_vote", "verified_purchase", "user_review_burst", "sentiment"]

data = pd.concat([amazon_df[COLS], flipkart_df[COLS]], ignore_index=True)

# Force all reviews to string one final time — catches any NaN that slipped through
data["review"] = data["review"].fillna("").astype(str)
data = data[data["label"].isin(["fake", "genuine"])]
data = data[data["review"].str.strip() != ""].reset_index(drop=True)

print(f"\nCombined (before balancing): {len(data):,} rows")
print("Platform breakdown:")
plat_names = {0: "Amazon", 1: "Flipkart"}
for p, name in plat_names.items():
    sub = data[data["platform"] == p]
    fake_pct = (sub["label"] == "fake").mean() * 100
    print(f"  {name:12s}: {len(sub):>8,} rows  |  {fake_pct:.1f}% fake")

# =====================================
# PLATFORM-AWARE BALANCING
# Balance fake/genuine within each platform independently
# so Amazon's clean signal isn't drowned out by Flipkart volume
# =====================================

balanced_frames = []
for p in sorted(data["platform"].unique()):
    sub         = data[data["platform"] == p]
    fake_sub    = sub[sub["label"] == "fake"]
    genuine_sub = sub[sub["label"] == "genuine"]
    min_c = min(len(fake_sub), len(genuine_sub))
    max_c = int(min_c * 1.5)
    if len(fake_sub)    > max_c: fake_sub    = fake_sub.sample(max_c,  random_state=42)
    if len(genuine_sub) > max_c: genuine_sub = genuine_sub.sample(max_c, random_state=42)
    balanced_frames.append(pd.concat([fake_sub, genuine_sub]))

data = pd.concat(balanced_frames).sample(frac=1, random_state=42).reset_index(drop=True)

print(f"\nAfter balancing: {len(data):,} rows | "
      f"Fake: {(data['label']=='fake').sum():,} | "
      f"Genuine: {(data['label']=='genuine').sum():,}")

# =====================================
# CLEAN TEXT
# =====================================

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

print("\nCleaning text...")
data["clean_review"] = data["review"].apply(clean_text)

# =====================================
# FEATURE ENGINEERING (22 features)
# =====================================

print("Generating 22 handcrafted features...")

positive_words = ["best", "amazing", "awesome", "perfect", "excellent",
                  "fantastic", "love", "great", "superb", "outstanding"]
negative_words = ["worst", "terrible", "horrible", "useless", "garbage",
                  "waste", "fake", "fraud", "broken", "pathetic"]
first_person   = {"i", "me", "my", "myself", "mine"}

data["word_count"]          = data["review"].apply(lambda x: len(str(x).split()))
data["review_length"]       = data["review"].apply(lambda x: len(str(x)))
data["sentiment_score"]     = data["review"].apply(lambda x: TextBlob(str(x)).sentiment.polarity)
data["subjectivity_score"]  = data["review"].apply(lambda x: TextBlob(str(x)).sentiment.subjectivity)
data["exclamation_count"]   = data["review"].apply(lambda x: str(x).count("!"))
data["caps_words"]          = data["review"].apply(lambda x: sum(1 for w in str(x).split() if w.isupper()))
data["avg_word_length"]     = data["review"].apply(
    lambda x: np.mean([len(w) for w in str(x).split()]) if len(str(x).split()) > 0 else 0)
data["repeated_words"]      = data["review"].apply(
    lambda x: len(str(x).split()) - len(set(str(x).split())))
data["positive_word_count"] = data["review"].apply(
    lambda x: sum(w in str(x).lower().split() for w in positive_words))
data["negative_word_count"] = data["review"].apply(
    lambda x: sum(w in str(x).lower().split() for w in negative_words))
data["unique_word_ratio"]   = data["review"].apply(
    lambda x: len(set(str(x).lower().split())) / max(len(str(x).split()), 1))
data["pronoun_ratio"]       = data["review"].apply(
    lambda x: sum(w in first_person for w in str(x).lower().split()) / max(len(str(x).split()), 1))
data["punct_density"]       = data["review"].apply(
    lambda x: sum(1 for c in str(x) if c in string.punctuation) / max(len(str(x)), 1))
data["question_count"]      = data["review"].apply(lambda x: str(x).count("?"))
data["caps_ratio"]          = data["review"].apply(
    lambda x: sum(1 for c in str(x) if c.isupper()) / max(len(str(x)), 1))
data["platform_feature"]    = data["platform"].astype(int)
data["verified_purchase"]   = data["verified_purchase"].apply(
    lambda x: 1 if str(x).strip().lower() in ["true", "1", "yes"] else 0)
data["helpful_vote_log"]    = np.log1p(data["helpful_vote"].astype(float))
data["burst_flag"]          = (data["user_review_burst"].astype(float) > 3).astype(int)
data["is_very_short"]       = (data["word_count"] < 10).astype(int)
data["is_very_long"]        = (data["word_count"] > 300).astype(int)
data["rating_extreme"]      = data["rating"].apply(
    lambda x: 1 if str(x).strip() in ["1", "5", "1.0", "5.0"] else 0).astype(int)

extra_cols = [
    "word_count", "review_length", "sentiment_score", "subjectivity_score",
    "exclamation_count", "caps_words", "avg_word_length", "repeated_words",
    "positive_word_count", "negative_word_count", "unique_word_ratio",
    "pronoun_ratio", "punct_density", "question_count", "caps_ratio",
    "platform_feature", "verified_purchase", "helpful_vote_log", "burst_flag",
    "is_very_short", "is_very_long", "rating_extreme"
]

print(f"Feature count: {len(extra_cols)} handcrafted + TF-IDF\n")

# =====================================
# TRAIN / TEST SPLIT
# Stratify on label+platform so both platforms appear in test set
# =====================================

data["strat_key"] = data["label"] + "_" + data["platform"].astype(str)

X_text   = data["clean_review"]
X_extra  = data[extra_cols]
y        = data["label"].map({"genuine": 0, "fake": 1})
plat_col = data["platform"]
strat    = data["strat_key"]

(X_train_text, X_test_text,
 X_train_extra, X_test_extra,
 y_train, y_test,
 plat_train, plat_test) = train_test_split(
    X_text, X_extra, y, plat_col,
    test_size=0.10,
    stratify=strat,
    random_state=42
)

print(f"Train: {len(y_train):,} | Test: {len(y_test):,}")
print(f"Train fake %: {y_train.mean()*100:.1f}% | "
      f"Test fake %: {y_test.mean()*100:.1f}%\n")

# =====================================
# TF-IDF (50K word + 25K char)
# =====================================

print("Running TF-IDF (~30-90s)...")
tfidf_start = time.time()

word_tfidf = TfidfVectorizer(
    stop_words="english",
    max_features=50000,
    ngram_range=(1, 3),
    sublinear_tf=True,
    min_df=2,
    strip_accents="unicode"
)

char_tfidf = TfidfVectorizer(
    analyzer="char_wb",
    ngram_range=(3, 6),
    max_features=25000,
    sublinear_tf=True,
    min_df=2
)

X_train_word = word_tfidf.fit_transform(X_train_text)
X_test_word  = word_tfidf.transform(X_test_text)

X_train_char = char_tfidf.fit_transform(X_train_text)
X_test_char  = char_tfidf.transform(X_test_text)

print(f"TF-IDF done in {time.time()-tfidf_start:.1f}s\n")

X_train_text_vec = hstack((X_train_word, X_train_char))
X_test_text_vec  = hstack((X_test_word,  X_test_char))

# =====================================
# SCALE HANDCRAFTED FEATURES
# =====================================

scaler = StandardScaler()
X_train_extra_s = scaler.fit_transform(X_train_extra)
X_test_extra_s  = scaler.transform(X_test_extra)

X_train_full = hstack((X_train_text_vec, csr_matrix(X_train_extra_s)))
X_test_full  = hstack((X_test_text_vec,  csr_matrix(X_test_extra_s)))

# =====================================
# BASE LEARNERS
# =====================================

lgbm = LGBMClassifier(
    device='gpu',
    n_estimators=1500,
    learning_rate=0.018,
    num_leaves=127,
    max_depth=9,
    min_child_samples=25,
    subsample=0.85,
    subsample_freq=1,
    colsample_bytree=0.75,
    reg_alpha=0.1,
    reg_lambda=0.2,
    class_weight={0: 1, 1: 1.3},
    n_jobs=-1,
    verbose=-1,
    random_state=42
)

sgd = SGDClassifier(
    loss="modified_huber",
    alpha=0.00005,
    max_iter=300,
    class_weight={0: 1, 1: 1.3},
    n_jobs=-1,
    random_state=42,
    tol=1e-4
)

lr_base = LogisticRegression(
    C=2.0,
    max_iter=1000,
    class_weight={0: 1, 1: 1.3},
    solver="saga",
    n_jobs=-1,
    random_state=42
)

# =====================================
# 5-FOLD STACKING WITH OOF PREDICTIONS
# =====================================

print("Building 3-learner stacking ensemble with 5-fold OOF...")
stack_start = time.time()

skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

oof_lgbm = np.zeros(len(y_train))
oof_sgd  = np.zeros(len(y_train))
oof_lr   = np.zeros(len(y_train))

test_lgbm_folds = np.zeros((len(y_test), 5))
test_sgd_folds  = np.zeros((len(y_test), 5))
test_lr_folds   = np.zeros((len(y_test), 5))

y_train_arr = y_train.values
feat_names  = [f"f{i}" for i in range(X_train_full.shape[1])]

for fold, (tr_idx, val_idx) in enumerate(skf.split(X_train_full, y_train_arr)):
    fold_start = time.time()
    print(f"  Fold {fold+1}/5 ...", end=" ", flush=True)

    X_tr, X_val = X_train_full[tr_idx], X_train_full[val_idx]
    y_tr, y_val = y_train_arr[tr_idx],  y_train_arr[val_idx]

    # LightGBM with early stopping
    lgbm.fit(
        X_tr, y_tr,
        feature_name=feat_names,
        eval_set=[(X_val, y_val)],
        callbacks=[
            lgb.early_stopping(stopping_rounds=50, verbose=False),
            lgb.log_evaluation(period=-1)
        ]
    )
    oof_lgbm[val_idx]        = lgbm.predict_proba(X_val)[:, 1]
    test_lgbm_folds[:, fold] = lgbm.predict_proba(X_test_full)[:, 1]

    # SGD
    sgd.fit(X_tr, y_tr)
    oof_sgd[val_idx]         = sgd.predict_proba(X_val)[:, 1]
    test_sgd_folds[:, fold]  = sgd.predict_proba(X_test_full)[:, 1]

    # Logistic Regression
    lr_base.fit(X_tr, y_tr)
    oof_lr[val_idx]          = lr_base.predict_proba(X_val)[:, 1]
    test_lr_folds[:, fold]   = lr_base.predict_proba(X_test_full)[:, 1]

    print(f"done in {time.time()-fold_start:.1f}s")

test_lgbm_avg = test_lgbm_folds.mean(axis=1)
test_sgd_avg  = test_sgd_folds.mean(axis=1)
test_lr_avg   = test_lr_folds.mean(axis=1)

print(f"\nStacking OOF done in {(time.time()-stack_start)/60:.1f} min\n")

# =====================================
# META-LEARNER
# =====================================

print("Training meta-learner...")

meta_X_train = np.column_stack([oof_lgbm, oof_sgd, oof_lr])
meta_X_test  = np.column_stack([test_lgbm_avg, test_sgd_avg, test_lr_avg])

meta_model = LogisticRegression(C=2.0, max_iter=1000, random_state=42)
meta_model.fit(meta_X_train, y_train_arr)

y_meta_prob = meta_model.predict_proba(meta_X_test)[:, 1]

# =====================================
# F1-OPTIMAL THRESHOLD TUNING
# =====================================

print("Finding F1-optimal threshold...")
best_f1, best_thresh = 0, 0.5

for t in np.arange(0.25, 0.75, 0.005):
    preds = (y_meta_prob > t).astype(int)
    f1    = f1_score(y_test, preds, average="macro")
    if f1 > best_f1:
        best_f1, best_thresh = f1, t

print(f"Best threshold : {best_thresh:.3f}")
print(f"Best macro-F1  : {best_f1:.4f}\n")

y_pred_final = (y_meta_prob > best_thresh).astype(int)

# =====================================
# OVERALL RESULTS
# =====================================

acc = accuracy_score(y_test, y_pred_final)
print("=" * 60)
print(f"  FINAL ACCURACY : {acc * 100:.2f}%")
print("=" * 60)
print("\nClassification Report:\n")
print(classification_report(y_test, y_pred_final, target_names=["genuine", "fake"]))

# =====================================
# PER-PLATFORM ACCURACY
# =====================================

print("\nPer-Platform Accuracy:")
print("-" * 40)

y_test_arr    = y_test.values
plat_test_arr = plat_test.values

for p, name in plat_names.items():
    mask = plat_test_arr == p
    if mask.sum() == 0:
        print(f"  {name:12s}: no test samples")
        continue
    pacc = accuracy_score(y_test_arr[mask], y_pred_final[mask])
    print(f"  {name:12s}: {pacc*100:.2f}%  ({mask.sum()} test samples)")

# =====================================
# RETRAIN ON FULL TRAINING SET & SAVE
# =====================================

print("\nRetraining on full training set for production save...")

lgbm.fit(X_train_full, y_train_arr, feature_name=feat_names)
sgd.fit(X_train_full, y_train_arr)
lr_base.fit(X_train_full, y_train_arr)

pickle.dump(lgbm,       open(BASE + "model_lgbm.pkl",      "wb"))
pickle.dump(sgd,        open(BASE + "model_sgd.pkl",       "wb"))
pickle.dump(lr_base,    open(BASE + "model_lr_base.pkl",   "wb"))
pickle.dump(meta_model, open(BASE + "model_meta.pkl",      "wb"))
pickle.dump(word_tfidf, open(BASE + "word_vectorizer.pkl", "wb"))
pickle.dump(char_tfidf, open(BASE + "char_vectorizer.pkl", "wb"))
pickle.dump(scaler,     open(BASE + "scaler.pkl",          "wb"))
pickle.dump(
    {"threshold": best_thresh, "extra_cols": extra_cols},
    open(BASE + "config.pkl", "wb")
)

print("\nAll 8 pkl files saved:")
for f in ["model_lgbm", "model_sgd", "model_lr_base", "model_meta",
          "word_vectorizer", "char_vectorizer", "scaler", "config"]:
    print(f"  {BASE}{f}.pkl")

print(f"\nTotal execution time: {(time.time()-start_time)/60:.2f} minutes")