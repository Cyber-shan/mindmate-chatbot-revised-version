import csv
import hashlib
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import numpy as np

from distress import LABELS
from distress.dataset import read_dataset, split_dataset
from distress.evaluation import apply_policy, report, threshold_for_recall
from distress.features import normalize
from distress.model import Classifier
from serve import make_handler
from train import read_review, train


def fixture_rows():
    # Synthetic software fixtures only; they are not a clinical training corpus.
    phrases = ("I'm nervous about exams but managing", "I've been sad every day for weeks", "I feel hopeless and cannot function", "I want to hurt myself tonight")
    rows = []
    for split, count in (("train", 12), ("validation", 4), ("test", 4)):
        for student in range(count):
            for label, phrase in zip(LABELS, phrases):
                rows.append({"text": f"{phrase}, fixture {split} {student}", "label": label, "student_id": f"{split}-{student}", "conversation_id": f"{split}-chat-{student}", "split": split, "subgroup": "test-fixtures"})
    return rows


def write_dataset(path, rows):
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=["text", "label", "student_id", "conversation_id", "split", "subgroup"])
        writer.writeheader()
        writer.writerows(rows)


class DatasetTests(unittest.TestCase):
    def test_normalization_keeps_negation(self):
        self.assertEqual(normalize(" I DON’T want to hurt myself. "), "i don't want to hurt myself.")

    def test_group_split_rejects_students_in_multiple_partitions(self):
        rows = fixture_rows()
        rows[-1]["student_id"] = rows[0]["student_id"]
        with self.assertRaisesRegex(ValueError, "leakage"):
            split_dataset(rows)

    def test_duplicate_text_across_partitions_is_rejected(self):
        rows = fixture_rows()
        rows[-1]["text"] = rows[0]["text"]
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            split_dataset(rows)

    def test_all_four_labels_required_in_every_partition(self):
        rows = [row for row in fixture_rows() if not (row["split"] == "test" and row["label"] == "IMMEDIATE_SAFETY")]
        with self.assertRaisesRegex(ValueError, "all four"):
            split_dataset(rows)

    def test_grouped_automatic_split_has_no_student_overlap(self):
        rows = fixture_rows()
        for row in rows:
            row.pop("split")
        partitions = split_dataset(rows)
        groups = [{row["student_id"] for row in items} for items in partitions.values()]
        self.assertFalse(groups[0] & groups[1] or groups[1] & groups[2] or groups[0] & groups[2])

    def test_conflicting_annotations_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            rows = fixture_rows()
            rows[1]["text"] = rows[0]["text"]
            write_dataset(path, rows)
            with self.assertRaisesRegex(ValueError, "Conflicting"):
                read_dataset(path)


class EvaluationTests(unittest.TestCase):
    def test_threshold_selection_meets_recall_without_using_test_data(self):
        threshold = threshold_for_recall([False, True, True, False], [0.1, 0.3, 0.8, 0.2], 1.0)
        self.assertEqual(threshold, 0.3)

    def test_uncertainty_cannot_lower_high_class(self):
        scores = np.array([[0.25, 0.25, 0.35, 0.15]])
        self.assertEqual(apply_policy(scores, {"immediate": 0.9, "high": 0.9, "confidence": 0.8}).tolist(), [2])

    def test_report_exposes_critical_false_negatives(self):
        metrics = report([3, 2, 0, 1], np.array([[0.9, 0.05, 0.03, 0.02], [0.1, 0.8, 0.07, 0.03], [0.9, 0.05, 0.03, 0.02], [0.1, 0.8, 0.07, 0.03]]))
        self.assertEqual(metrics["critical_false_negative_rate"], 1.0)
        self.assertEqual(metrics["immediate_recall"], 0.0)
        self.assertEqual(np.array(metrics["confusion_matrix"]).shape, (4, 4))

    def test_training_round_trip_calibrates_but_does_not_approve_without_review(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            path = base / "data.csv"
            write_dataset(path, fixture_rows())
            result = train(path, base / "model")
            self.assertFalse(result["release_approved"])
            self.assertIsNone(result["thresholds"])
            classifier = Classifier(base / "model" / "classifier.joblib")
            prediction = classifier.predict("I am worried about exams")
            self.assertEqual(list(prediction["scores"]), list(LABELS))
            self.assertAlmostEqual(sum(prediction["scores"].values()), 1.0)
            self.assertFalse(prediction["release_approved"])
            with self.assertRaises(ValueError):
                classifier.predict(" ")
            evaluation = json.loads((base / "model" / "evaluation.json").read_text())
            self.assertIn("test-fixtures", evaluation["subgroups"])

    def test_unfilled_review_template_cannot_enable_release(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review.json"
            path.write_text('{"reviewer":null}')
            with self.assertRaises(ValueError):
                read_review(path)

    def test_release_gates_can_reject_a_reviewed_training_run(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            data = base / "data.csv"
            write_dataset(data, fixture_rows())
            # Strict fixtures intentionally fail calibration and explicit release approval.
            config = {"reviewer": "Software test", "reviewed_at": "2026-11-08", "dataset_version": "fixture", "dataset_sha256": hashlib.sha256(data.read_bytes()).hexdigest(), "approved_for_release": False,
                      "confidence": 0.6, "target_immediate_recall": 1.0, "target_combined_recall": 1.0,
                      "minimum_macro_f1": 1.0, "minimum_immediate_recall": 1.0, "minimum_combined_recall": 1.0, "maximum_critical_false_negative_rate": 0, "maximum_ece": 0,
                      "minimum_subgroup_size": 1, "required_subgroups": ["test-fixtures"]}
            review = base / "review.json"
            review.write_text(json.dumps(config))
            result = train(data, base / "model", review)
            self.assertFalse(result["release_approved"])
            self.assertIn("missing_explicit_release_approval", result["release_gate_failures"])
            self.assertIn("calibration", result["release_gate_failures"])
            self.assertIsNotNone(result["thresholds"])


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(None, "test-token"))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_health_reports_missing_model_without_fabricated_scores(self):
        with urllib.request.urlopen(self.url + "/health", timeout=3) as response:
            self.assertEqual(json.load(response), {"ready": False, "release_approved": False})

    def test_predict_requires_token(self):
        request = urllib.request.Request(self.url + "/predict", data=b'{"text":"hello"}', headers={"Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=3)
        self.assertEqual(error.exception.code, 401)
        error.exception.close()

    def test_missing_model_returns_503(self):
        request = urllib.request.Request(self.url + "/predict", data=b'{"text":"hello"}', headers={"Authorization": "Bearer test-token"})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=3)
        self.assertEqual(error.exception.code, 503)
        error.exception.close()

    def test_invalid_text_rejected_before_model_lookup(self):
        request = urllib.request.Request(self.url + "/predict", data=b'{"text":null}', headers={"Authorization": "Bearer test-token"})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request, timeout=3)
        self.assertEqual(error.exception.code, 400)
        error.exception.close()


if __name__ == "__main__":
    unittest.main()
