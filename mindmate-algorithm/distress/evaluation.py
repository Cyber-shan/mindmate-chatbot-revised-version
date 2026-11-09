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
    """Use validation data only; maximize precision, then threshold, at the approved recall target."""
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


def confidence_intervals(truth, predicted, groups=None, iterations=1000, seed=42):
    """Approximate percentile intervals by resampling whole independent groups, never messages within them."""
    if groups is None:
        groups = [str(index) for index in range(len(truth))]
        unit = "message (independence not established)"
    else:
        unit = "connected student/conversation/template/text group"
    if len(groups) != len(truth) or any(not isinstance(group, str) or not group for group in groups):
        raise ValueError("Uncertainty groups must provide one nonempty identifier per message.")
    unique, inverse = np.unique(groups, return_inverse=True)
    group_matrices = np.zeros((len(unique), 4, 4), dtype=int)
    np.add.at(group_matrices, (inverse, truth, predicted), 1)
    rng = np.random.default_rng(seed)
    matrices = np.zeros((iterations, 4, 4), dtype=int)
    # Bound memory for large datasets; each draw keeps every message in a group together.
    for start in range(0, iterations, 100):
        end = min(start + 100, iterations)
        sampled = rng.integers(len(unique), size=(end - start, len(unique)))
        matrices[start:end] = group_matrices[sampled].sum(axis=1)

    def ratio(numerator, denominator):
        return np.divide(numerator, denominator, out=np.full(np.shape(numerator), np.nan, dtype=float), where=denominator > 0)

    def interval(values):
        valid = values[np.isfinite(values)]
        result = {"lower": None, "upper": None, "valid_resamples": int(len(valid)), "status": "insufficient_groups"}
        if len(unique) < 2 or len(valid) < 0.9 * iterations:
            return result
        if np.ptp(valid) <= 1e-12:
            result["status"] = "no_observed_variation"
            return result
        result.update(lower=float(np.quantile(valid, 0.025)), upper=float(np.quantile(valid, 0.975)), status="estimated")
        return result

    diagonal = np.diagonal(matrices, axis1=1, axis2=2)
    actual, assigned = matrices.sum(axis=2), matrices.sum(axis=1)
    precision = ratio(diagonal, assigned)
    recall = ratio(diagonal, actual)
    f1 = ratio(2 * diagonal, actual + assigned)
    high_true = matrices[:, 2:, 2:].sum(axis=(1, 2))
    high_actual = matrices[:, 2:, :].sum(axis=(1, 2))
    low_actual = matrices[:, :2, :].sum(axis=(1, 2))
    # A four-class macro score is not defined when a bootstrap draw omits a true class.
    macro_f1 = np.where((actual > 0).all(axis=1), np.nan_to_num(f1).mean(axis=1), np.nan)
    estimates = {
        "accuracy_informational": ratio(diagonal.sum(axis=1), matrices.sum(axis=(1, 2))),
        "macro_f1": macro_f1,
        "immediate_recall": recall[:, 3],
        "combined_recall": ratio(high_true, high_actual),
        "critical_false_negative_rate": ratio(high_actual - high_true, high_actual),
        "combined_false_positive_rate": ratio(matrices[:, :2, 2:].sum(axis=(1, 2)), low_actual),
    }
    return {
        "method": "whole-group percentile bootstrap", "confidence_level": 0.95,
        "resamples": iterations, "seed": seed, "sampling_unit": unit,
        "independent_group_count": len(unique),
        "small_group_warning": len(unique) < 30,
        "limitations": "Approximate sampling variability for a fixed model and thresholds. Does not cover training, annotation error, dataset shift or clinical validity. Null bounds mean insufficient groups, unsupported classes, or no observed variation; perfect observations do not prove zero future errors.",
        "metrics": {name: interval(values) for name, values in estimates.items()},
        "per_class": {label: {"precision": interval(precision[:, index]), "recall": interval(recall[:, index]), "f1": interval(f1[:, index])} for index, label in enumerate(LABELS)},
    }


def report(truth, probabilities, thresholds=None, *, groups=None):
    truth = np.asarray(truth)
    probabilities = np.asarray(probabilities, dtype=float)
    if truth.ndim != 1 or len(truth) == 0 or not np.issubdtype(truth.dtype, np.integer) or not np.isin(truth, np.arange(4)).all():
        raise ValueError("Evaluation needs nonempty integer labels in policy order (0 through 3).")
    if probabilities.shape != (len(truth), 4) or not np.isfinite(probabilities).all() or (probabilities < 0).any() or (probabilities > 1).any() or not np.allclose(probabilities.sum(axis=1), 1, atol=0.001):
        raise ValueError("Evaluation needs four finite normalized probabilities per message.")
    predicted = apply_policy(probabilities, thresholds)
    immediate = truth == 3
    combined = truth >= 2
    confidence = np.max(probabilities, axis=1)
    raw_predicted = np.argmax(probabilities, axis=1)
    ece = 0.0
    calibration_bins = []
    for lower, upper in zip(np.linspace(0, 1, 11)[:-1], np.linspace(0, 1, 11)[1:]):
        mask = (confidence > lower) & (confidence <= upper)
        if mask.any():
            ece += float(mask.mean() * abs(confidence[mask].mean() - (raw_predicted[mask] == truth[mask]).mean()))
        calibration_bins.append({"lower": float(lower), "upper": float(upper), "sample_count": int(mask.sum()),
                                 "mean_confidence": float(confidence[mask].mean()) if mask.any() else None,
                                 "observed_accuracy": float((raw_predicted[mask] == truth[mask]).mean()) if mask.any() else None})
    matrix = confusion_matrix(truth, predicted, labels=list(range(4)))
    per_class = classification_report(truth, predicted, labels=list(range(4)), target_names=list(LABELS), output_dict=True, zero_division=0)
    for index, label in enumerate(LABELS):
        tp = int(matrix[index, index])
        fp, fn = int(matrix[:, index].sum()) - tp, int(matrix[index].sum()) - tp
        per_class[label].update(true_positive=tp, false_positive=fp, false_negative=fn,
                                true_negative=len(truth) - tp - fp - fn,
                                predicted_count=int(matrix[:, index].sum()),
                                precision_defined=bool(matrix[:, index].sum()), recall_defined=bool(matrix[index].sum()))
    uncertain = confidence < thresholds["confidence"] if thresholds else None
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
        "confusion_matrix": matrix.tolist(),
        "class_order": list(LABELS),
        "per_class": per_class,
        "error_counts": {
            "correct": int((predicted == truth).sum()), "incorrect": int((predicted != truth).sum()),
            "under_prioritized": int((predicted < truth).sum()), "over_prioritized": int((predicted > truth).sum()),
            "immediate_safety_actual": int(immediate.sum()),
            "immediate_safety_false_negative": int((predicted[immediate] != 3).sum()),
            "immediate_safety_false_positive": int(((predicted == 3) & ~immediate).sum()),
            "high_priority_actual": int(combined.sum()),
            "high_priority_false_negative": int((predicted[combined] < 2).sum()),
            "high_priority_false_positive": int((predicted[~combined] >= 2).sum()),
            "lower_priority_actual": int((~combined).sum()),
        },
        "uncertainty": {
            "confidence_threshold": thresholds["confidence"] if thresholds else None,
            "low_confidence_count": int(uncertain.sum()) if uncertain is not None else None,
            "low_confidence_rate": float(uncertain.mean()) if uncertain is not None else None,
            "low_confidence_error_count": int(((predicted != truth) & uncertain).sum()) if uncertain is not None else None,
            "mean_normalized_entropy": float(np.mean(-np.sum(probabilities * np.log(np.clip(probabilities, 1e-15, 1)), axis=1) / np.log(4))),
            "confidence_definition": "Maximum raw class probability; not the probability of the final threshold-adjusted support decision.",
        },
        "confidence_intervals": confidence_intervals(truth, predicted, groups),
        "calibration": {
            "ece_10_bins": ece,
            "multiclass_brier": float(np.mean(np.sum((probabilities - np.eye(4)[truth]) ** 2, axis=1))),
            "scope": "Raw class probabilities and argmax predictions, before policy thresholds.",
            "bins": calibration_bins,
        },
    }


def write_summary(metadata, path):
    """Readable companion to evaluation.json; deliberately excludes original messages and IDs."""
    def percent(value):
        return "Unavailable" if value is None else f"{100 * value:.2f}%"

    lines = ["# Support-priority evaluation", "", f"Model: `{metadata['model_version']}`", "",
             metadata["evaluation_scope"], "", "These are classifier-only results. Application context rules and multi-turn tests are evaluated separately.", "",
             f"Partition leakage audit passed: {metadata['partition_audit']['passed']}. Student, conversation, normalized text and template families are checked in both holdouts and calibration folds.", ""]
    for name in ("validation", "test"):
        metrics = metadata[name]
        lines += [f"## {name.title()}", "", f"Messages: {metrics['sample_count']}; independent evaluation groups: {metrics['confidence_intervals']['independent_group_count']}.", "",
                  "| Metric | Result | Approximate 95% group-bootstrap interval |", "|---|---:|---|"
                  ]
        for key in ("accuracy_informational", "macro_f1", "immediate_recall", "combined_recall", "combined_false_positive_rate"):
            bounds = metrics["confidence_intervals"]["metrics"][key]
            interval = f"{percent(bounds['lower'])} to {percent(bounds['upper'])}" if bounds["lower"] is not None else bounds["status"].replace("_", " ")
            lines.append(f"| {key} | {percent(metrics[key])} | {interval} |")
        lines += ["", "| Class | Support | Precision | Recall | F1 | TP | FP | FN |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
        for label in LABELS:
            values = metrics["per_class"][label]
            lines.append(f"| {label} | {int(values['support'])} | {percent(values['precision'])} | {percent(values['recall'])} | {percent(values['f1-score'])} | {values['true_positive']} | {values['false_positive']} | {values['false_negative']} |")
        counts = metrics["error_counts"]
        lines += ["", f"Incorrect: {counts['incorrect']}; under-prioritized: {counts['under_prioritized']}; over-prioritized: {counts['over_prioritized']}.",
                  f"Immediate-safety misses: {counts['immediate_safety_false_negative']} of {counts['immediate_safety_actual']}; high-priority misses: {counts['high_priority_false_negative']} of {counts['high_priority_actual']}.",
                  f"Low-confidence predictions: {metrics['uncertainty']['low_confidence_count']}; confidence threshold: {metrics['uncertainty']['confidence_threshold']}.",
                  f"Raw probability calibration error (ECE): {metrics['calibration']['ece_10_bins']:.4f}.", ""]
    lines += ["## Uncertainty limits", "", metadata["test"]["confidence_intervals"]["limitations"],
              "Few independent groups can produce unstable intervals even when the message count is large. Synthetic template variations are not independent real students.", "",
              "See evaluation.json for per-class intervals, the confusion matrix, error counts, calibration bins and the partition audit.", ""]
    path.write_text("\n".join(lines), encoding="utf-8")


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
