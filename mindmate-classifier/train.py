"""Train a practice academic-stress classifier from data/messages.csv."""

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from sklearn.dummy import DummyClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "data" / "messages.csv"
LABELS = ["not_academic_stress", "academic_stress"]
SEED = 42


def load_data():
    """Check the CSV without changing the original file."""
    if not DATA_PATH.is_file():
        raise ValueError(f"Dataset not found. Put your CSV at: {DATA_PATH}")

    data = pd.read_csv(DATA_PATH, encoding="utf-8-sig", dtype=str,
                       keep_default_na=False)
    data.columns = data.columns.str.strip()
    if not {"text", "label"}.issubset(data.columns):
        raise ValueError("Your CSV must have columns named text and label.")

    data["text"] = data["text"].str.strip()
    data["label"] = data["label"].str.strip()
    if data.empty or data[["text", "label"]].eq("").any().any():
        raise ValueError("The dataset is empty or contains a blank text/label.")
    invalid = sorted(set(data["label"]) - set(LABELS))
    if invalid:
        raise ValueError(f"Unexpected labels: {invalid}. Use exactly: {LABELS}")
    if set(data["label"]) != set(LABELS):
        raise ValueError("Include examples of BOTH labels before training.")

    # Case/whitespace differences should not let copies enter different splits.
    data["_key"] = data["text"].str.casefold().str.replace(r"\s+", " ", regex=True)
    if data.groupby("_key")["label"].nunique().gt(1).any():
        raise ValueError("The same message has conflicting labels. Review it first.")

    if "group_id" in data.columns:
        data["group_id"] = data["group_id"].str.strip()
        if data["group_id"].eq("").any():
            raise ValueError("Every row needs a group_id when that column is present.")
        if data.groupby("_key")["group_id"].nunique().gt(1).any():
            raise ValueError("Duplicate messages cross group_id values. Merge related "
                             "groups or review these duplicates before training.")

    original_count = len(data)
    data = data.drop_duplicates("_key").drop(columns="_key").reset_index(drop=True)
    print(f"Removed {original_count - len(data)} duplicate messages.")
    print("\nExamples per label:")
    print(data["label"].value_counts().to_string())
    return data


def split_data(data):
    """Approximately 70% training / 15% validation / 15% final test."""
    try:
        if "group_id" in data.columns:
            # Use one stable ID for all messages from the same student, where known.
            splitter = GroupShuffleSplit(n_splits=1, test_size=0.30, random_state=SEED)
            train_idx, hold_idx = next(splitter.split(data, groups=data["group_id"]))
            train, hold = data.iloc[train_idx], data.iloc[hold_idx]
            splitter = GroupShuffleSplit(n_splits=1, test_size=0.50, random_state=SEED)
            val_idx, test_idx = next(splitter.split(hold, groups=hold["group_id"]))
            validation, test = hold.iloc[val_idx], hold.iloc[test_idx]
            print("\nSplit method: separate groups (percentages may differ).")
        else:
            train, hold = train_test_split(data, test_size=0.30, random_state=SEED,
                                           stratify=data["label"])
            validation, test = train_test_split(hold, test_size=0.50,
                                                random_state=SEED,
                                                stratify=hold["label"])
            print("\nSplit method: stratified random messages.")
            print("Use this only for independent examples. Related messages need group_id.")
    except ValueError as error:
        raise ValueError("Not enough examples/groups for three splits. Add independent "
                         "examples in both classes. Details: " + str(error)) from error

    for name, part in [("Training", train), ("Validation", validation), ("Test", test)]:
        if set(part["label"]) != set(LABELS):
            raise ValueError(f"{name} split lacks a class. Review class/group coverage "
                             "and add examples; do not select splits to improve scores.")
        print(f"{name}: {len(part)} messages")
    return train, validation, test


def evaluate(model, baseline, data, name, reports):
    predictions = model.predict(data["text"])
    baseline_predictions = baseline.predict(data[["text"]])
    print(f"\n{name.upper()} RESULTS")
    print(classification_report(data["label"], predictions, labels=LABELS,
                                digits=3, zero_division=0))
    matrix = confusion_matrix(data["label"], predictions, labels=LABELS)
    print("Confusion matrix: rows = actual, columns = predicted")
    print("Order:", LABELS)
    print(matrix)

    metrics = classification_report(data["label"], predictions, labels=LABELS,
                                     output_dict=True, zero_division=0)
    baseline_metrics = classification_report(data["label"], baseline_predictions,
                                              labels=LABELS, output_dict=True,
                                              zero_division=0)
    print(f"Model macro F1: {metrics['macro avg']['f1-score']:.3f}")
    print(f"Always-majority baseline macro F1: "
          f"{baseline_metrics['macro avg']['f1-score']:.3f}")

    reviewed = data.copy()
    reviewed["predicted_label"] = predictions
    reviewed["correct"] = reviewed["label"] == reviewed["predicted_label"]
    reviewed.to_csv(reports / f"{name}_predictions.csv", index=False)
    result = {"model": metrics, "majority_baseline": baseline_metrics,
              "confusion_matrix": matrix.tolist(), "label_order": LABELS}
    (reports / f"{name}_metrics.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--test", action="store_true",
                        help="Also evaluate the final test set after choices are fixed.")
    args = parser.parse_args()

    data = load_data()
    train, validation, test = split_data(data)
    print("\nPractice model: small/synthetic datasets do not establish reliability.")

    # The vocabulary and IDF weights are learned ONLY from the training messages.
    model = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), stop_words=None,
                                   min_df=1, sublinear_tf=True)),
        ("classifier", LogisticRegression(max_iter=1000, random_state=SEED)),
    ])
    model.fit(train["text"], train["label"])
    baseline = DummyClassifier(strategy="most_frequent")
    baseline.fit(train[["text"]], train["label"])

    models = ROOT / "models"
    reports = ROOT / "reports"
    models.mkdir(exist_ok=True)
    reports.mkdir(exist_ok=True)
    # Do not leave final-test reports from a different training run on display.
    for filename in ("test_metrics.json", "test_predictions.csv"):
        (reports / filename).unlink(missing_ok=True)
    evaluate(model, baseline, validation, "validation", reports)
    if args.test:
        evaluate(model, baseline, test, "test", reports)
    else:
        print("\nFinal test set reserved. Use --test only after fixing model choices.")

    # Save the fitted vectorizer and classifier together, without refitting on held-out data.
    model_path = models / "academic_stress_pipeline.joblib"
    joblib.dump(model, model_path)
    manifest = pd.concat([
        train.assign(split="train"), validation.assign(split="validation"),
        test.assign(split="test"),
    ])
    manifest.to_csv(reports / "split_assignments.csv", index=False)
    metadata = {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "purpose": "Experimental message classification for MindMate",
        "data_sha256": hashlib.sha256(DATA_PATH.read_bytes()).hexdigest(),
        "seed": SEED,
        "split_counts": {"train": len(train), "validation": len(validation), "test": len(test)},
        "grouped": "group_id" in data.columns,
        "test_evaluated": args.test,
        "python": sys.version.split()[0],
        "packages": {"pandas": pd.__version__, "scikit-learn": sklearn.__version__,
                     "joblib": joblib.__version__},
    }
    (models / "training_metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"\nModel saved: {model_path}")
    print(f"Reports saved: {reports}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, pd.errors.ParserError) as error:
        raise SystemExit(f"Training stopped: {error}")
