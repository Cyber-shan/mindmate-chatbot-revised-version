import numpy as np
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, fbeta_score

from . import LABELS


def apply_policy(probabilities, thresholds=None):
    predicted = np.argmax(probabilities, axis=1)
    if thresholds:
        predicted = np.where(probabilities[:, 2] + probabilities[:, 3] >= thresholds["high"], np.maximum(predicted, 2), predicted)
        predicted = np.where(probabilities[:, 3] >= thresholds["immediate"], 3, predicted)
        predicted = np.where(np.max(probabilities, axis=1) < thresholds["confidence"], np.maximum(predicted, 1), predicted)
    return predicted


def threshold_for_recall(truth, scores, target):
    """Use validation positives only; maximize precision, then threshold, at the approved recall target."""
    truth = np.asarray(truth, dtype=bool)
    scores = np.asarray(scores, dtype=float)
    if not truth.any() or not 0 < target <= 1:
        raise ValueError("Threshold selection needs positive validation examples and a target in (0, 1].")
    candidates = []
    for threshold in np.unique(scores):
        if threshold <= 0:
            continue
        predictions = scores >= threshold
        true_positive = int(np.sum(predictions & truth))
        recall = true_positive / int(truth.sum())
        precision = true_positive / int(predictions.sum())
        if recall >= target:
            candidates.append((precision, float(threshold)))
    if not candidates:
        raise ValueError("No positive threshold satisfies the approved validation recall target.")
    return max(candidates)[1]


def report(truth, probabilities, thresholds=None):
    truth = np.asarray(truth)
    predicted = apply_policy(probabilities, thresholds)
    immediate = truth == 3
    combined = truth >= 2
    confidence = np.max(probabilities, axis=1)
    raw_predicted = np.argmax(probabilities, axis=1)
    ece = 0.0
    for lower, upper in zip(np.linspace(0, 1, 11)[:-1], np.linspace(0, 1, 11)[1:]):
        mask = (confidence > lower) & (confidence <= upper)
        if mask.any():
            ece += float(mask.mean() * abs(confidence[mask].mean() - (raw_predicted[mask] == truth[mask]).mean()))
    return {
        "sample_count": len(truth),
        "accuracy_informational": float(accuracy_score(truth, predicted)),
        "macro_f1": float(f1_score(truth, predicted, labels=list(range(4)), average="macro", zero_division=0)),
        "immediate_recall": float((predicted[immediate] == 3).mean()) if immediate.any() else None,
        "combined_recall": float((predicted[combined] >= 2).mean()) if combined.any() else None,
        "critical_false_negative_rate": float((predicted[combined] < 2).mean()) if combined.any() else None,
        "immediate_false_negative_rate": float((predicted[immediate] != 3).mean()) if immediate.any() else None,
        "combined_false_positive_rate": float((predicted[~combined] >= 2).mean()) if (~combined).any() else None,
        "combined_f2": float(fbeta_score(combined, predicted >= 2, beta=2, zero_division=0)),
        "confusion_matrix": confusion_matrix(truth, predicted, labels=list(range(4))).tolist(),
        "class_order": list(LABELS),
        "per_class": classification_report(truth, predicted, labels=list(range(4)), target_names=list(LABELS), output_dict=True, zero_division=0),
        "calibration": {
            "ece_10_bins": ece,
            "multiclass_brier": float(np.mean(np.sum((probabilities - np.eye(4)[truth]) ** 2, axis=1))),
        },
    }


def gate_failures(metrics, config):
    failures = []
    for metric, setting in (("macro_f1", "minimum_macro_f1"), ("immediate_recall", "minimum_immediate_recall"), ("combined_recall", "minimum_combined_recall")):
        if metrics[metric] is None or metrics[metric] < config[setting]:
            failures.append(metric)
    if metrics["critical_false_negative_rate"] is None or metrics["critical_false_negative_rate"] > config["maximum_critical_false_negative_rate"]:
        failures.append("critical_false_negative_rate")
    if metrics["calibration"]["ece_10_bins"] > config["maximum_ece"]:
        failures.append("calibration")
    return failures
