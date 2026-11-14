import hashlib
import json
import unittest
from unittest.mock import patch

import numpy as np

from distress import LABELS
from distress.features import normalize
from distress.selection import CANDIDATES, select_pipeline
from distress.synthetic import generate_rows


class TrainingCoverageTests(unittest.TestCase):
    def test_training_expansion_preserves_frozen_holdout_messages_labels_and_groups(self):
        rows = generate_rows(42)
        expected = {
            "validation": "112124dd25731ed120f11c903aeb6956a8ab2e9d525130293b745818234d83f0",
            "test": "6ec4be5371b2125a86c888b33f0049ab19e85c6329c4e813e2bb6badcd174153",
        }
        for partition, digest in expected.items():
            values = sorted((normalize(row["text"]), row["label"], row["student_id"], row["conversation_id"])
                            for row in rows if row["split"] == partition)
            self.assertEqual(hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest(), digest)
        training = [row for row in rows if row["split"] == "train"]
        self.assertEqual(len(training), 1920)
        for label in LABELS:
            self.assertEqual(sum(row["label"] == label for row in training), 480)

    def test_nested_search_never_fits_outer_held_out_groups_or_crosses_inner_groups(self):
        texts = [f"example student-{student} {label}" for student in range(12) for label in LABELS]
        labels = [label for _ in range(12) for label in LABELS]
        groups = [f"student-{student}" for student in range(12) for _ in LABELS]
        owner = self
        fits = []

        class FakeCalibratedModel:
            classes_ = np.array(LABELS)

            def __init__(self, configuration, *, method, cv, n_jobs):
                owner.assertEqual((method, n_jobs), ("sigmoid", 1))
                self.configuration, self.cv = configuration, cv

            def fit(self, fitted, fitted_labels):
                self.fitted_groups = {text.split()[1] for text in fitted}
                fits.append(self.fitted_groups)
                for left, right in self.cv:
                    owner.assertFalse({fitted[index].split()[1] for index in left}
                                      & {fitted[index].split()[1] for index in right})
                return self

            def predict_proba(self, held_out):
                owner.assertFalse(self.fitted_groups & {text.split()[1] for text in held_out})
                values = np.full((len(held_out), 4), .05)
                for index, text in enumerate(held_out):
                    target = LABELS.index(text.split()[-1])
                    # A tempting parameter setting loses urgent recall; it must
                    # be explicitly marked ineligible by the selection policy.
                    if self.configuration["character_weight"] < 1 and target == 3:
                        target = 2
                    values[index, target] = .85
                return values

        with patch("distress.selection.make_pipeline", side_effect=lambda **options: options), \
             patch("distress.selection.CalibratedClassifierCV", FakeCalibratedModel):
            result = select_pipeline(texts, labels, groups)
        self.assertEqual(len(fits), len(CANDIDATES) * 3)
        self.assertEqual(result["status"], "selected")
        self.assertTrue(all(not candidate["eligible"] for candidate in result["candidates"]
                            if candidate["parameters"]["character_weight"] < 1))
        self.assertGreaterEqual(result["selected"]["character_weight"], 1)

    def test_insufficient_groups_use_an_explicit_fallback_without_fitting(self):
        with patch("distress.selection.CalibratedClassifierCV") as model:
            result = select_pipeline(["one", "two", "three"], ["LOW"] * 3, ["a", "b", "c"])
        model.assert_not_called()
        self.assertEqual(result["status"], "baseline_fallback")
        self.assertIn("nine independent", result["reason"])


if __name__ == "__main__":
    unittest.main()
