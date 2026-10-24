from pathlib import Path

import joblib
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent

INPUT_FILE = BASE_DIR / "data" / "stress-annotated-dataset.csv"
MODEL_FILE = BASE_DIR / "models" / "academic_stress_pipeline.joblib"
OUTPUT_FILE = BASE_DIR / "reports" / "sad_predictions_review.csv"

# Read messages as text without changing words such as "NA".
df = pd.read_csv(
    INPUT_FILE,
    encoding="utf-8-sig",
    dtype=str,
    keep_default_na=False,
)

if "text" not in df.columns:
    raise ValueError("Your CSV must contain a column named 'text'.")

if df.empty:
    raise ValueError("Your CSV contains no messages.")

if df["text"].str.strip().eq("").any():
    raise ValueError("Some messages are empty. Fix those rows first.")

if {"predicted_label", "reviewed_label"} & set(df.columns):
    raise ValueError("Use the original input CSV without prediction columns.")

# Load your previously trained TF-IDF + classifier pipeline.
model = joblib.load(MODEL_FILE)

# Also support a saved dictionary containing a "pipeline" entry.
if isinstance(model, dict):
    model = model.get("pipeline")

if not hasattr(model, "predict"):
    raise TypeError(
        "The saved file does not contain the expected pipeline. "
        "Check how train.py saves the model."
    )

# Generate suggestions. This does not train or change the model.
df["predicted_label"] = model.predict(df["text"].tolist())

# Leave the human-reviewed answer blank.
df["reviewed_label"] = ""

OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

# Exclusive creation protects an existing review file from being overwritten.
df.to_csv(OUTPUT_FILE, index=False, encoding="utf-8-sig", mode="x")

print(f"Predicted labels for {len(df)} messages.")
print(df["predicted_label"].value_counts())
print(f"\nReview file saved: {OUTPUT_FILE}")