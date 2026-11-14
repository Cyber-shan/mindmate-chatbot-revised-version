"""Compare trusted local artifacts on identical frozen synthetic messages.

This reports engineering regression evidence, never a population accuracy claim.
No supplied cases are used to train, calibrate, select or tune either model.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
from statistics import median
from time import perf_counter

import numpy as np
from threadpoolctl import threadpool_limits

from distress import LABELS
from distress.dataset import leakage_groups
from distress.evaluation import apply_policy, report
from distress.features import normalize
from distress.model import Classifier


def read_rows(path):
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def identity(rows):
    return sorted((normalize(row["text"]), row["label"], row["student_id"], row["conversation_id"]) for row in rows)


def evaluate(model, rows, *, thresholds=True, groups=None):
    scores = model.artifact["model"].predict_proba([row["text"] for row in rows])
    order = [list(model.artifact["model"].classes_).index(label) for label in LABELS]
    scores = scores[:, order]
    truth = [LABELS.index(row["label"]) for row in rows]
    settings = model.artifact["thresholds"] if thresholds else None
    metrics = report(truth, scores, settings, groups=groups)
    predicted = apply_policy(scores, settings)
    return metrics, [{"category": row.get("category"), "expected": row["label"], "predicted": LABELS[int(value)],
                      "correct": row["label"] == LABELS[int(value)]} for row, value in zip(rows, predicted)]


def compare(baseline_path, candidate_path, baseline_data, candidate_data, challenge_path):
    baseline_rows, candidate_rows = read_rows(baseline_data), read_rows(candidate_data)
    partitions = {}
    for name in ("validation", "test"):
        before = [row for row in baseline_rows if row["split"] == name]
        after = [row for row in candidate_rows if row["split"] == name]
        if not before or identity(before) != identity(after):
            raise ValueError(f"The {name} messages, labels and ownership groups must be identical for comparison.")
        partitions[name] = before
    fixtures = json.loads(challenge_path.read_text(encoding="utf-8"))
    result = {"scope": "Identical-message synthetic regression comparison. Reused engineering holdouts and curated challenge cases do not establish real-student or clinical accuracy.",
              "held_out_text_and_groups_unchanged": True, "challenge_scope": fixtures["scope"],
              "challenge_sha256": hashlib.sha256(challenge_path.read_bytes()).hexdigest(),
              "holdout_sha256": hashlib.sha256(json.dumps({key: identity(rows) for key, rows in partitions.items()}, sort_keys=True).encode()).hexdigest(),
              "models": {}}
    with threadpool_limits(limits=2):
        for name, path in (("baseline", baseline_path), ("candidate", candidate_path)):
            model = Classifier(path)
            if hashlib.sha256((baseline_data if name == "baseline" else candidate_data).read_bytes()).hexdigest() != model.artifact["dataset_sha256"]:
                raise ValueError(f"{name} data does not match its trusted artifact fingerprint.")
            entry = {"model_version": model.artifact["model_version"], "model_mode": model.artifact["model_mode"],
                     "release_approved": model.artifact["release_approved"], "split_sizes": model.artifact["split_sizes"],
                     "model_selection": model.artifact.get("model_selection"), "artifact_bytes": path.stat().st_size}
            for partition, rows in partitions.items():
                entry[partition] = evaluate(model, rows, groups=leakage_groups(rows))[0]
            metrics, cases = evaluate(model, fixtures["cases"])
            # Curated fixtures are not an independent random sample: remove the
            # message-bootstrap intervals produced by the generic report helper.
            metrics["confidence_intervals"] = None
            entry["challenge"] = {"metrics": metrics, "cases": cases,
                "by_category": {category: {"total": sum(row["category"] == category for row in cases),
                    "correct": sum(row["category"] == category and row["correct"] for row in cases)}
                    for category in sorted({row["category"] for row in cases})}}
            times = []
            for row in fixtures["cases"]:
                started = perf_counter()
                model.predict(row["text"])
                times.append((perf_counter() - started) * 1000)
            entry["single_message_latency_ms"] = {"median": median(times), "p95": float(np.quantile(times, .95)),
                "scope": "Sequential warmed in-process inference, two numerical-library threads; excludes HTTP/network."}
            result["models"][name] = entry
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ("baseline", "candidate", "baseline-data", "candidate-data", "output"):
        parser.add_argument("--" + argument, type=Path, required=True)
    parser.add_argument("--challenges", type=Path, default=Path(__file__).parent / "tests/fixtures/classifier-challenges.json")
    args = parser.parse_args()
    result = compare(args.baseline, args.candidate, args.baseline_data, args.candidate_data, args.challenges)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({name: {"model_version": data["model_version"],
          "validation_macro_f1": data["validation"]["macro_f1"], "test_macro_f1": data["test"]["macro_f1"],
          "test_combined_recall": data["test"]["combined_recall"], "test_false_positive_rate": data["test"]["combined_false_positive_rate"],
          "challenge_accuracy": data["challenge"]["metrics"]["accuracy_informational"],
          "challenge_categories": data["challenge"]["by_category"],
          "latency_ms": data["single_message_latency_ms"]["median"]} for name, data in result["models"].items()}, indent=2))
