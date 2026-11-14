"""Train support-priority classification for research/reviewed use, or an explicitly synthetic English prototype."""
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
from distress.dataset import leakage_groups, partition_audit, read_dataset, split_dataset
from distress.evaluation import gate_failures, report, threshold_for_recall, write_summary
from distress.features import make_pipeline


PROTOTYPE_TARGETS = {
    "confidence": 0.40,
    "target_immediate_recall": 0.95,
    "target_combined_recall": 0.95,
    "minimum_macro_f1": 0.75,
}


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


def train(data_path: Path, output: Path, review_path: Path | None = None, *, prototype: bool = False):
    if prototype and review_path:
        raise ValueError("A synthetic prototype cannot use a clinical review configuration.")
    rows = read_dataset(data_path)
    synthetic_data = any(row.get("data_source", "").lower() == "synthetic" for row in rows)
    if review_path and synthetic_data:
        raise ValueError("Synthetic data cannot authorize a reviewed release; use --prototype for the demo.")
    if prototype and any(row.get("data_source") != "synthetic" or row.get("language") != "en" for row in rows):
        raise ValueError("Prototype training requires every row to declare data_source=synthetic and language=en.")
    partitions = split_dataset(rows)
    review = read_review(review_path)
    digest = hashlib.sha256(data_path.read_bytes()).hexdigest()
    if review and review["dataset_sha256"] != digest:
        raise ValueError("Review configuration does not match this dataset's SHA-256.")
    training = partitions["train"]
    texts = [row["text"] for row in training]
    labels = [row["label"] for row in training]
    groups = leakage_groups(training)
    if len(set(groups)) < 3:
        raise ValueError("Training and grouped calibration require at least three independent student/conversation groups.")
    folds = list(GroupKFold(n_splits=3).split(texts, labels, groups))
    if any({labels[i] for i in train_ids} != set(LABELS) or {labels[i] for i in calibration_ids} != set(LABELS) for train_ids, calibration_ids in folds):
        raise ValueError("Every grouped calibration fold must contain all four labels; add reviewed examples/groups.")
    calibration_audit = [partition_audit({"fit": [training[i] for i in fit], "calibration": [training[i] for i in calibration]}) for fit, calibration in folds]
    model = CalibratedClassifierCV(make_pipeline(), method="sigmoid", cv=folds)
    model.fit(texts, labels)
    # sklearn sorts classes alphabetically; explicitly restore policy order.
    class_indices = [list(model.classes_).index(label) for label in LABELS]
    scores = {name: model.predict_proba([row["text"] for row in rows])[:, class_indices] for name, rows in partitions.items() if name != "train"}
    truth = {name: np.array([LABELS.index(row["label"]) for row in rows]) for name, rows in partitions.items() if name != "train"}
    thresholds = None
    threshold_config = PROTOTYPE_TARGETS if prototype else review
    if threshold_config:
        thresholds = {
            "immediate": threshold_for_recall(truth["validation"] == 3, scores["validation"][:, 3], threshold_config["target_immediate_recall"]),
            "high": threshold_for_recall(truth["validation"] >= 2, scores["validation"][:, 2:].sum(axis=1), threshold_config["target_combined_recall"]),
            "confidence": threshold_config["confidence"],
        }
    metrics = report(truth["test"], scores["test"], thresholds, groups=leakage_groups(partitions["test"]))
    subgroups = {}
    for subgroup in sorted({row.get("subgroup", "") for row in partitions["test"]} - {""}):
        mask = np.array([row.get("subgroup") == subgroup for row in partitions["test"]])
        subgroups[subgroup] = report(truth["test"][mask], scores["test"][mask], thresholds,
                                    groups=leakage_groups([row for row, include in zip(partitions["test"], mask) if include]))
    failures = gate_failures(metrics, review) if review else ["synthetic_prototype_not_clinically_validated" if prototype else "missing_clinical_review_config"]
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
    code_paths = ("train.py", "distress/features.py", "distress/dataset.py", "distress/evaluation.py", "distress/synthetic.py")
    code_digest = hashlib.sha256(b"".join((source_dir / path).read_bytes() for path in code_paths)).hexdigest()
    dependencies = {"scikit_learn": sklearn.__version__, "numpy": np.__version__, "joblib": joblib.__version__}
    model_mode = "prototype" if prototype else "reviewed" if review else "research"
    fingerprint = hashlib.sha256(json.dumps({"dataset": digest, "code": code_digest, "review": review, "dependencies": dependencies, "model_mode": model_mode}, sort_keys=True).encode()).hexdigest()
    version = f"distress-tfidf-lr-v1-{fingerprint[:12]}"
    validation = report(truth["validation"], scores["validation"], thresholds, groups=leakage_groups(partitions["validation"]))
    prototype_failures = []
    if prototype:
        for metric, target in (("macro_f1", "minimum_macro_f1"), ("immediate_recall", "target_immediate_recall"), ("combined_recall", "target_combined_recall")):
            if validation[metric] is None or validation[metric] < PROTOTYPE_TARGETS[target]:
                prototype_failures.append(metric)
    metadata = {
        "model_version": version, "dataset_sha256": digest,
        "model_mode": model_mode, "synthetic_data": synthetic_data,
        "language": "en" if prototype or all(row.get("language") == "en" for row in rows) else "unspecified",
        "prototype_usable": prototype and not prototype_failures,
        "prototype_validation_targets": PROTOTYPE_TARGETS if prototype else None,
        "prototype_gate_failures": prototype_failures,
        "evaluation_scope": "Synthetic English phrase-family regression holdout, reused during engineering development; not an untouched statistical test, real-world evaluation, or clinical validation." if synthetic_data else "Held-out dataset; institutional review is required before release.",
        "training_code_sha256": code_digest, "dependency_versions": dependencies,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "split_sizes": {name: len(rows) for name, rows in partitions.items()},
        "partition_audit": partition_audit(partitions), "calibration_audit": calibration_audit,
        "calibration": "sigmoid, three folds disjoint by connected student/conversation/template/text groups",
        "thresholds": thresholds, "review": review,
        "release_approved": not failures, "release_gate_failures": failures,
        "test": metrics, "subgroups": subgroups,
        "validation": validation,
    }
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump({"schema_version": 1, "model": model, **metadata}, output / "classifier.joblib")
    (output / "evaluation.json").write_text(json.dumps(metadata, indent=2, allow_nan=False), encoding="utf-8")
    write_summary(metadata, output / "evaluation.md")
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("artifacts"))
    parser.add_argument("--review-config", type=Path)
    parser.add_argument("--prototype", action="store_true", help="Allow synthetic English demo data and select demo thresholds; never approves a release")
    args = parser.parse_args()
    try:
        result = train(args.data, args.output, args.review_config, prototype=args.prototype)
    except (ValueError, KeyError) as error:
        parser.exit(2, f"Training rejected: {error}\n")
    print(json.dumps({key: result[key] for key in ("model_version", "split_sizes", "release_approved", "release_gate_failures")}, indent=2))
