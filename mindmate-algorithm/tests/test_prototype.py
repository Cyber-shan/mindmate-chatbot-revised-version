import json
import tempfile
import threading
import unittest
import urllib.request
from collections import Counter
from http.server import ThreadingHTTPServer
from pathlib import Path

from sklearn.model_selection import GroupKFold
import joblib

from distress import LABELS
from distress.dataset import read_dataset, split_dataset
from distress.model import Classifier
from distress.synthetic import generate_rows, write_synthetic_dataset
from serve import make_handler
from train import train


class SyntheticDatasetTests(unittest.TestCase):
    def test_seed_reproduces_data_without_inserting_student_identifiers(self):
        rows = generate_rows(42)
        self.assertEqual(rows, generate_rows(42))
        self.assertNotEqual(rows, generate_rows(43))
        self.assertTrue(all(row["student_id"] not in row["text"] for row in rows))
        self.assertEqual(len(set(Counter(row["label"] for row in rows).values())), 1)

    def test_students_text_and_phrase_families_are_disjoint(self):
        partitions = split_dataset(generate_rows())
        for field in ("student_id", "text", "template_family"):
            sets = [{row[field] for row in rows} for rows in partitions.values()]
            self.assertFalse(sets[0] & sets[1] or sets[0] & sets[2] or sets[1] & sets[2], field)
        for rows in partitions.values():
            self.assertEqual({row["label"] for row in rows}, set(LABELS))
            self.assertTrue(all(row["language"] == "en" and row["data_source"] == "synthetic" for row in rows))

    def test_template_family_reuse_is_rejected_even_with_distinct_text(self):
        rows = generate_rows()
        training = next(row for row in rows if row["split"] == "train")
        held_out = next(row for row in rows if row["split"] == "test")
        held_out["template_family"] = training["template_family"]
        with self.assertRaisesRegex(ValueError, "template-family leakage"):
            split_dataset(rows)

    def test_augmented_phrase_families_stay_together_in_calibration_folds(self):
        rows = split_dataset(generate_rows())["train"]
        groups = [row["student_id"] for row in rows]
        for fitted, calibrated in GroupKFold(n_splits=3).split(rows, groups=groups):
            fitted_families = {rows[index]["template_family"] for index in fitted}
            calibrated_families = {rows[index]["template_family"] for index in calibrated}
            self.assertFalse(fitted_families & calibrated_families)
            self.assertEqual({rows[index]["label"] for index in calibrated}, set(LABELS))

    def test_synthetic_provenance_cannot_be_used_for_reviewed_release(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            data = base / "data.csv"
            write_synthetic_dataset(data)
            with self.assertRaisesRegex(ValueError, "Synthetic data cannot authorize"):
                train(data, base / "model", base / "review.json")
            with self.assertRaisesRegex(ValueError, "cannot use a clinical review"):
                train(data, base / "model", base / "review.json", prototype=True)

    def test_prototype_requires_english_synthetic_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            data = base / "data.csv"
            write_synthetic_dataset(data)
            data.write_text(data.read_text().replace(",synthetic,en,", ",unknown,en,", 1))
            with self.assertRaisesRegex(ValueError, "every row"):
                train(data, base / "model", prototype=True)


class PrototypeRoundTripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.base = Path(cls.directory.name)
        cls.data = cls.base / "synthetic.csv"
        write_synthetic_dataset(cls.data)
        cls.metadata = train(cls.data, cls.base / "model", prototype=True)
        cls.classifier = Classifier(cls.base / "model/classifier.joblib")

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_operational_thresholds_never_claim_clinical_approval(self):
        metadata = self.metadata
        self.assertEqual(metadata["model_mode"], "prototype")
        self.assertTrue(metadata["synthetic_data"])
        self.assertTrue(metadata["prototype_usable"])
        self.assertEqual(metadata["language"], "en")
        self.assertFalse(metadata["release_approved"])
        self.assertIn("synthetic_prototype_not_clinically_validated", metadata["release_gate_failures"])
        self.assertEqual(set(metadata["thresholds"]), {"immediate", "high", "confidence"})
        self.assertTrue(all(0 < value <= 1 for value in metadata["thresholds"].values()))

    def test_prediction_round_trip_exposes_provenance_and_real_probabilities(self):
        result = self.classifier.predict("I feel anxious and could use some support.")
        self.assertEqual(result["model_mode"], "prototype")
        self.assertTrue(result["prototype_usable"])
        self.assertTrue(result["synthetic_data"])
        self.assertFalse(result["release_approved"])
        self.assertAlmostEqual(sum(result["scores"].values()), 1)
        self.assertEqual(set(result["scores"]), set(LABELS))
        self.assertEqual(read_dataset(self.data)[0]["data_source"], "synthetic")

    def test_http_health_and_prediction_preserve_explicit_demo_status(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.classifier))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}"
            with urllib.request.urlopen(url + "/health", timeout=3) as response:
                health = json.load(response)
            self.assertTrue(health["ready"])
            self.assertTrue(health["prototype_usable"])
            self.assertEqual(health["model_mode"], "prototype")
            self.assertFalse(health["release_approved"])
            self.assertEqual(health["model_version"], self.metadata["model_version"])
            request = urllib.request.Request(url + "/predict", data=json.dumps({"text": "I am worried about school."}).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=3) as response:
                prediction = json.load(response)
            self.assertEqual(prediction["model_version"], health["model_version"])
            self.assertTrue(prediction["synthetic_data"])
            self.assertEqual(prediction["language"], "en")
            self.assertFalse(prediction["release_approved"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_training_is_reproducible_for_same_dataset_and_dependencies(self):
        repeated = train(self.data, self.base / "second-model", prototype=True)
        self.assertEqual(repeated["model_version"], self.metadata["model_version"])
        self.assertEqual(repeated["thresholds"], self.metadata["thresholds"])
        self.assertEqual(repeated["test"], self.metadata["test"])

    def test_legacy_approved_artifact_preserves_reviewed_status(self):
        artifact = dict(self.classifier.artifact)
        for key in ("model_mode", "synthetic_data", "language", "prototype_usable"):
            artifact.pop(key, None)
        artifact["release_approved"] = True
        path = self.base / "legacy-approved.joblib"
        joblib.dump(artifact, path)
        prediction = Classifier(path).predict("I am worried about school.")
        self.assertEqual(prediction["model_mode"], "reviewed")
        self.assertTrue(prediction["release_approved"])
        self.assertFalse(prediction["synthetic_data"])
        self.assertFalse(prediction["prototype_usable"])
        artifact["release_approved"] = False
        joblib.dump(artifact, path)
        self.assertEqual(Classifier(path).predict("I am worried about school.")["model_mode"], "research")


if __name__ == "__main__":
    unittest.main()
