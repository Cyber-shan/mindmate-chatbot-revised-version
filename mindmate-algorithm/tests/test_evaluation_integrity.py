import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from sklearn.model_selection import GroupKFold

from distress import LABELS
from distress.dataset import leakage_groups, partition_audit, split_dataset
from distress.evaluation import report
from test_distress import fixture_rows, write_dataset
from train import train


class PartitionIntegrityTests(unittest.TestCase):
    def test_one_student_with_multiple_conversations_stays_in_one_partition(self):
        rows = fixture_rows()
        for index, row in enumerate(rows):
            row.pop("split")
            row["conversation_id"] += f"-message-{index}"
        partitions = split_dataset(rows)
        assignments = {}
        for name, messages in partitions.items():
            for row in messages:
                self.assertEqual(assignments.setdefault(row["student_id"], name), name)
        self.assertTrue(partition_audit(partitions)["passed"])

    def test_conflicting_conversation_owners_are_rejected_without_csv_loading(self):
        rows = fixture_rows()
        rows[-1]["conversation_id"] = rows[0]["conversation_id"]
        with self.assertRaisesRegex(ValueError, "Conversation ownership conflict"):
            split_dataset(rows)

    def test_messages_from_one_conversation_cannot_be_manually_split(self):
        rows = fixture_rows()
        training = [row for row in rows if row["split"] == "train"]
        test = [row for row in rows if row["split"] == "test"]
        moved = training.pop()
        test.append(moved)
        with self.assertRaisesRegex(ValueError, "leakage"):
            partition_audit({"train": training, "test": test})

    def test_connected_template_and_duplicate_text_groups_remain_together_in_calibration(self):
        rows = [row for row in fixture_rows() if row["split"] == "train"]
        # Link different students through a template and then a duplicated message.
        rows[0]["template_family"] = rows[4]["template_family"] = "shared-family"
        rows[5]["text"] = rows[8]["text"]
        groups = leakage_groups(rows)
        self.assertEqual(groups[0], groups[4])
        self.assertEqual(groups[0], groups[8])
        for fitted, calibrated in GroupKFold(n_splits=3).split(rows, groups=groups):
            audit = partition_audit({"fit": [rows[i] for i in fitted], "calibration": [rows[i] for i in calibrated]})
            self.assertTrue(audit["passed"])
        reverse_groups = dict(zip((row["text"] + row["student_id"] for row in reversed(rows)), leakage_groups(list(reversed(rows)))))
        for row, group in zip(rows, groups):
            self.assertEqual(reverse_groups[row["text"] + row["student_id"]], group)

    def test_partition_audit_exposes_counts_without_saving_identifiers(self):
        audit = partition_audit(split_dataset(fixture_rows()))
        self.assertIn("conversation_id", audit["checked_fields"])
        self.assertEqual(audit["partitions"]["test"]["conversation_count"], 4)
        self.assertEqual(audit["partitions"]["test"]["class_counts"], dict.fromkeys(LABELS, 4))
        self.assertNotIn("test-chat-0", json.dumps(audit))


class EvaluationIntegrityTests(unittest.TestCase):
    def test_error_counts_and_per_class_denominators_match_known_mistakes(self):
        truth = np.array([0, 0, 1, 1, 2, 2, 3, 3])
        predicted = np.array([0, 1, 1, 2, 1, 2, 2, 3])
        metrics = report(truth, np.eye(4)[predicted], groups=[f"group-{i}" for i in range(8)])
        self.assertEqual(metrics["error_counts"]["incorrect"], 4)
        self.assertEqual(metrics["error_counts"]["under_prioritized"], 2)
        self.assertEqual(metrics["error_counts"]["over_prioritized"], 2)
        self.assertEqual(metrics["error_counts"]["high_priority_false_negative"], 1)
        self.assertEqual(metrics["error_counts"]["high_priority_false_positive"], 1)
        self.assertEqual(metrics["error_counts"]["immediate_safety_false_negative"], 1)
        high = metrics["per_class"]["HIGH_CONCERN"]
        self.assertEqual((high["true_positive"], high["false_positive"], high["false_negative"]), (1, 2, 1))
        self.assertAlmostEqual(high["precision"], 1 / 3)
        self.assertAlmostEqual(high["recall"], 1 / 2)

    def test_group_intervals_do_not_narrow_when_messages_within_students_are_duplicated(self):
        truth = np.tile(np.arange(4), 4)
        predicted = truth.copy()
        predicted[:4] = (predicted[:4] + 1) % 4
        groups = [f"student-{index // 4}" for index in range(16)]
        original = report(truth, np.eye(4)[predicted], groups=groups)
        duplicated = report(np.repeat(truth, 10), np.repeat(np.eye(4)[predicted], 10, axis=0), groups=np.repeat(groups, 10))
        self.assertEqual(original["confidence_intervals"], duplicated["confidence_intervals"])
        self.assertEqual(original["confidence_intervals"]["independent_group_count"], 4)
        bounds = original["confidence_intervals"]["metrics"]["macro_f1"]
        self.assertLess(bounds["lower"], bounds["upper"])
        json.dumps(duplicated, allow_nan=False)

    def test_perfect_and_unsupported_metrics_do_not_claim_zero_uncertainty(self):
        metrics = report([0, 0], [[1, 0, 0, 0], [1, 0, 0, 0]], groups=["one", "two"])
        intervals = metrics["confidence_intervals"]
        self.assertIsNone(intervals["metrics"]["accuracy_informational"]["lower"])
        self.assertEqual(intervals["metrics"]["accuracy_informational"]["status"], "no_observed_variation")
        self.assertIsNone(intervals["metrics"]["immediate_recall"]["lower"])
        self.assertFalse(metrics["per_class"]["IMMEDIATE_SAFETY"]["recall_defined"])

    def test_uncertain_predictions_are_reported_without_reducing_priority(self):
        metrics = report([0, 2], [[0.4, 0.3, 0.2, 0.1], [0.2, 0.25, 0.35, 0.2]],
                         {"confidence": 0.6, "high": 0.9, "immediate": 0.9}, groups=["one", "two"])
        self.assertEqual(metrics["uncertainty"]["low_confidence_count"], 2)
        self.assertEqual(metrics["uncertainty"]["low_confidence_error_count"], 1)
        self.assertEqual(metrics["confusion_matrix"][2][2], 1)
        self.assertEqual(sum(item["sample_count"] for item in metrics["calibration"]["bins"]), 2)

    def test_invalid_probabilities_or_group_lengths_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "normalized probabilities"):
            report([0], [[0.8, 0.8, 0, 0]])
        with self.assertRaisesRegex(ValueError, "identifier per message"):
            report([0], [[1, 0, 0, 0]], groups=[])

    def test_training_saves_human_readable_and_structured_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            data = base / "data.csv"
            write_dataset(data, fixture_rows())
            result = train(data, base / "model")
            self.assertTrue(result["partition_audit"]["passed"])
            self.assertEqual(len(result["calibration_audit"]), 3)
            self.assertTrue(all(fold["passed"] for fold in result["calibration_audit"]))
            summary = (base / "model/evaluation.md").read_text()
            self.assertIn("95% group-bootstrap", summary)
            self.assertIn("Immediate attention misses", summary)
            self.assertNotIn("test-chat-0", summary)
            self.assertNotIn(fixture_rows()[0]["text"], summary)


if __name__ == "__main__":
    unittest.main()
