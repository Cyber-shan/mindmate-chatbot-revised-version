"""Train and evaluate a support classifier. No dataset or release thresholds are invented."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import GroupKFold

from distress import LABELS
from distress.dataset import read_dataset, split_dataset
from distress.evaluation import gate_failures, report, threshold_for_recall
from distress.features import make_pipeline


def read_review(path):
    if not path:
        return None
    config = json.loads(path.read_text(encoding="utf-8"))
    for key in ("reviewer", "dataset_version", "dataset_sha256", "reviewed_at"):
        if not isinstance(config.get(key), str) or not config[key].strip():
            raise ValueError(f"Review config needs {key}.")
    for key in ("confidence", "target_immediate_recall", "target_combined_recall", "minimum_macro_f1", "minimum_immediate_recall", "minimum_combined_recall", "maximum_critical_false_negative_rate", "maximum_ece"):
        value = config.get(key)
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not 0 <= value <= 1:
            raise ValueError(f"Review config needs a clinician/researcher-selected {key} between 0 and 1 (confidence and recall targets must be positive).")
        if key in ("confidence", "target_immediate_recall", "target_combined_recall") and value == 0:
            raise ValueError(f"{key} must be positive.")
    if type(config.get("minimum_subgroup_size")) is not int or config["minimum_subgroup_size"] < 1:
        raise ValueError("Review config needs a positive minimum_subgroup_size.")
    if not isinstance(config.get("required_subgroups"), list) or not config["required_subgroups"] or not all(isinstance(x, str) and x for x in config["required_subgroups"]):
        raise ValueError("Review config needs a nonempty required_subgroups list.")
    return config


def train(data_path: Path, output: Path, review_path: Path | None = None):
    partitions = split_dataset(read_dataset(data_path))
    training = partitions["train"]
    texts = [row["text"] for row in training]
    labels = [row["label"] for row in training]
    groups = [row["student_id"] for row in training]
    if len(set(groups)) < 3:
        raise ValueError("Training and grouped calibration require at least three distinct students.")
    folds = list(GroupKFold(n_splits=3).split(texts, labels, groups))
    if any({labels[i] for i in train_ids} != set(LABELS) or {labels[i] for i in calibration_ids} != set(LABELS) for train_ids, calibration_ids in folds):
        raise ValueError("Every grouped calibration fold must contain all four labels; add reviewed examples/groups.")
    model = CalibratedClassifierCV(make_pipeline(), method="sigmoid", cv=folds)
    model.fit(texts, labels)
    # sklearn sorts classes alphabetically; explicitly restore policy order.
    class_indices = [list(model.classes_).index(label) for label in LABELS]
    scores = {name: model.predict_proba([row["text"] for row in rows])[:, class_indices] for name, rows in partitions.items() if name != "train"}
    truth = {name: np.array([LABELS.index(row["label"]) for row in rows]) for name, rows in partitions.items() if name != "train"}
    review = read_review(review_path)
    digest = hashlib.sha256(data_path.read_bytes()).hexdigest()
    if review and review["dataset_sha256"] != digest:
        raise ValueError("Review configuration does not match this dataset's SHA-256.")
    thresholds = None
    if review:
        thresholds = {
            "immediate": threshold_for_recall(truth["validation"] == 3, scores["validation"][:, 3], review["target_immediate_recall"]),
            "high": threshold_for_recall(truth["validation"] >= 2, scores["validation"][:, 2:].sum(axis=1), review["target_combined_recall"]),
            "confidence": review["confidence"],
        }
    metrics = report(truth["test"], scores["test"], thresholds)
    subgroups = {}
    for subgroup in sorted({row.get("subgroup", "") for row in partitions["test"]} - {""}):
        mask = np.array([row.get("subgroup") == subgroup for row in partitions["test"]])
        subgroups[subgroup] = report(truth["test"][mask], scores["test"][mask], thresholds)
    failures = gate_failures(metrics, review) if review else ["missing_clinical_review_config"]
    if review and review.get("approved_for_release") is not True:
        failures.append("missing_explicit_release_approval")
    if review:
        for subgroup in review["required_subgroups"]:
            subgroup_metrics = subgroups.get(subgroup)
            if not subgroup_metrics or subgroup_metrics["sample_count"] < review["minimum_subgroup_size"]:
                failures.append(f"subgroup:{subgroup}:insufficient_data")
            elif gate_failures(subgroup_metrics, review):
                failures.append(f"subgroup:{subgroup}:release_gates")
    source_dir = Path(__file__).resolve().parent
    code_digest = hashlib.sha256(b"".join((source_dir / path).read_bytes() for path in ("train.py", "distress/features.py", "distress/dataset.py", "distress/evaluation.py"))).hexdigest()
    dependencies = {"scikit_learn": sklearn.__version__, "numpy": np.__version__, "joblib": joblib.__version__}
    fingerprint = hashlib.sha256(json.dumps({"dataset": digest, "code": code_digest, "review": review, "dependencies": dependencies}, sort_keys=True).encode()).hexdigest()
    version = f"distress-tfidf-lr-v1-{fingerprint[:12]}"
    metadata = {
        "model_version": version, "dataset_sha256": digest,
        "training_code_sha256": code_digest, "dependency_versions": dependencies,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "split_sizes": {name: len(rows) for name, rows in partitions.items()},
        "calibration": "sigmoid, three student-group-disjoint training folds",
        "thresholds": thresholds, "review": review,
        "release_approved": not failures, "release_gate_failures": failures,
        "test": metrics, "subgroups": subgroups,
        "validation": report(truth["validation"], scores["validation"], thresholds),
    }
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump({"schema_version": 1, "model": model, **metadata}, output / "classifier.joblib")
    (output / "evaluation.json").write_text(json.dumps(metadata, indent=2, allow_nan=False), encoding="utf-8")
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("artifacts"))
    parser.add_argument("--review-config", type=Path)
    args = parser.parse_args()
    try:
        result = train(args.data, args.output, args.review_config)
    except (ValueError, KeyError) as error:
        parser.exit(2, f"Training rejected: {error}\n")
    print(json.dumps({key: result[key] for key in ("model_version", "split_sizes", "release_approved", "release_gate_failures")}, indent=2))
