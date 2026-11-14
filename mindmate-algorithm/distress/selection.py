"""Small, sequential training-only search; no validation/test rows enter fitting.

Each outer fold is predicted by a calibrated ensemble whose own calibration
groups are disjoint from its base-estimator fit groups. This avoids reporting
resubstitution scores while selecting sparse-model settings.
"""
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import f1_score, log_loss, recall_score
from sklearn.model_selection import GroupKFold
from threadpoolctl import threadpool_limits

from . import LABELS
from .features import make_pipeline

CANDIDATES = (
    {"regularization": 1.0, "character_weight": 1.0},
    {"regularization": 1.0, "character_weight": 0.35},
    {"regularization": 8.0, "character_weight": 1.0},
    {"regularization": 8.0, "character_weight": 0.35},
    {"regularization": 1.0, "character_weight": 1.75},
    {"regularization": 8.0, "character_weight": 1.75},
)


def grouped_folds(texts, labels, groups):
    folds = list(GroupKFold(n_splits=3).split(texts, labels, groups))
    if any(set(labels[index] for index in fit) != set(LABELS)
           or set(labels[index] for index in calibration) != set(LABELS)
           for fit, calibration in folds):
        raise ValueError("Every grouped calibration fold must contain all four labels.")
    return folds


def select_pipeline(texts, labels, groups):
    """Preserve baseline urgent recall, then maximize macro F1 / minimize loss.

    Folds and candidates are fixed before evaluation. Inadequate group coverage
    produces an explicit baseline fallback rather than row-wise splitting.
    """
    result = {"scope": "Training partition only; nested group-disjoint calibration; synthetic engineering selection, not population validation.",
              "selection_metric": "baseline_urgent_recall_floors_then_macro_f1_then_lower_log_loss", "outer_folds": 3,
              "inner_calibration_folds": 3, "cpu_threads": 2, "candidates": []}
    try:
        if len(set(groups)) < 9:
            raise ValueError("At least nine independent training groups are required for nested selection.")
        outer = grouped_folds(texts, labels, groups)
        prepared = []
        for fit, held_out in outer:
            fit_texts = [texts[index] for index in fit]
            fit_labels = [labels[index] for index in fit]
            inner = grouped_folds(fit_texts, fit_labels, [groups[index] for index in fit])
            prepared.append((fit_texts, fit_labels, inner, held_out))
    except ValueError as error:
        result.update(selected=dict(CANDIDATES[0]), status="baseline_fallback", reason=str(error))
        return result
    truth = np.array([LABELS.index(label) for label in labels])
    with threadpool_limits(limits=2):
        for configuration in CANDIDATES:
            probabilities = np.zeros((len(texts), len(LABELS)))
            for fit_texts, fit_labels, inner, held_out in prepared:
                model = CalibratedClassifierCV(make_pipeline(**configuration), method="sigmoid", cv=inner, n_jobs=1)
                model.fit(fit_texts, fit_labels)
                order = [list(model.classes_).index(label) for label in LABELS]
                probabilities[held_out] = model.predict_proba([texts[index] for index in held_out])[:, order]
            predicted = probabilities.argmax(axis=1)
            result["candidates"].append({"parameters": dict(configuration),
                "macro_f1": float(f1_score(truth, predicted, labels=range(4), average="macro", zero_division=0)),
                "log_loss": float(log_loss(truth, probabilities, labels=range(4))),
                "immediate_recall": float(recall_score(truth == 3, predicted == 3)),
                "combined_recall": float(recall_score(truth >= 2, predicted >= 2))})
    baseline = result["candidates"][0]
    for candidate in result["candidates"]:
        candidate["eligible"] = (candidate["immediate_recall"] >= baseline["immediate_recall"]
                                 and candidate["combined_recall"] >= baseline["combined_recall"])
    best = max((item for item in result["candidates"] if item["eligible"]),
               key=lambda item: (item["macro_f1"], -item["log_loss"]))
    result.update(selected=best["parameters"], status="selected")
    return result
