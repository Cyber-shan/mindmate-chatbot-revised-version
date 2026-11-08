"""End-to-end checks for blindness, human review gates, and annotation provenance."""

import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import review_dataset as review


class ReviewWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(review, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.temp.cleanup)
        (self.root / "ANNOTATION_GUIDE.md").write_text("Frozen policy for test fixtures.", encoding="utf-8")
        # Deliberately wrong old label checks that exports use reviewed decisions.
        review.write_csv(self.root / "data/messages.csv", [
            {"text": "I am calm about my exam.", "label": "academic_stress"},
            {"text": "My exam is making me anxious.", "label": "not_academic_stress"},
            {"text": "My friend is worried about her grades; I feel fine.", "label": "academic_stress"},
        ], ["text", "label"])
        review.write_csv(self.root / "data/Stress-Annotated-Dataset.csv", [
            {"sentence_id": "one", "text": "My job is stressing me out."},
            {"sentence_id": "two", "text": "Yes, every night."},
            {"sentence_id": "three", "text": "I have a class tomorrow."},
        ], ["sentence_id", "text"])
        self.batch = self.root / "batch"
        self.manifest = review.prepare(self.batch, per_source=3, boundary_per_source=1)

    def rewrite(self, path, rows):
        with path.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    def rows(self, relative):
        return review.read_csv(self.batch / relative, ["item_id"])

    def annotate(self, conflict=False):
        for role, identity in (("reviewer_a", "human_reviewer"), ("reviewer_b", "ai_reviewer")):
            path = self.batch / role / "annotations.csv"
            rows = review.read_csv(path, review.PACKET_FIELDS)
            for row in rows:
                row.update(review_status="labeled", reviewed_label="not_academic_stress",
                           reviewer_id=identity, evidence_note="No own current academic strain expressed.")
                if row["text"] == "My exam is making me anxious.":
                    row.update(reviewed_label="academic_stress", evidence_note="Own current anxiety tied to exam.")
                if row["text"] == "Yes, every night.":
                    row.update(review_status="deferred", reviewed_label="", deferral_reason="needs_context",
                               evidence_note="Reply requires an absent referent to interpret.")
                if conflict and role == "reviewer_b" and row["text"] == "I am calm about my exam.":
                    row.update(reviewed_label="academic_stress", evidence_note="Deliberate conflict fixture.")
            self.rewrite(path, rows)

    def adjudicate(self, state="labeled", label="not_academic_stress", identity="human_adjudicator"):
        path = self.batch / "coordinator/comparison/adjudication.csv"
        rows = review.read_csv(path, ["item_id"])
        for row in rows:
            row.update(final_status=state, final_label=label,
                       deferral_reason="needs_context" if state == "deferred" else "",
                       adjudicator_id=identity, adjudication_note="The message explicitly expresses calm.")
        self.rewrite(path, rows)

    def test_packets_hide_original_labels_sources_and_suggestions(self):
        for role in ("reviewer_a", "reviewer_b"):
            rows = self.rows(f"{role}/annotations.csv")
            self.assertEqual(set(rows[0]), set(review.PACKET_FIELDS))
            for row in rows:
                self.assertEqual(row["reviewed_label"], "")
                self.assertEqual(row["review_status"], "")
                self.assertNotIn("source_file", row)
                self.assertNotIn("label", row)
                self.assertNotIn("predicted_label", row)
            self.assertEqual((self.batch / role / "ANNOTATION_GUIDE.md").read_bytes(),
                             (self.root / "ANNOTATION_GUIDE.md").read_bytes())

    def test_sampling_is_reproducible_and_label_independent(self):
        changed = review.read_csv(self.root / "data/messages.csv", ["text", "label"])
        for row in changed:
            row["label"] = "arbitrary_previous_label"
        self.rewrite(self.root / "data/messages.csv", changed)
        another = review.prepare(self.root / "another", per_source=3, boundary_per_source=1)
        self.assertEqual([(r["item_id"], r["selection"]) for r in self.manifest["items"]],
                         [(r["item_id"], r["selection"]) for r in another["items"]])
        self.assertEqual([s["boundary_subset"] + s["random_subset"] for s in another["sources"]], [3, 3])

    def test_comparison_requires_completed_independent_reviews(self):
        with self.assertRaisesRegex(ValueError, "unfinished/invalid"):
            review.compare(self.batch)
        self.assertFalse((self.batch / "coordinator/comparison").exists())
        self.annotate()
        path = self.batch / "reviewer_b/annotations.csv"
        rows = self.rows("reviewer_b/annotations.csv")
        for row in rows:
            row["reviewer_id"] = "human_reviewer"
        self.rewrite(path, rows)
        with self.assertRaisesRegex(ValueError, "distinct"):
            review.compare(self.batch)

    def test_disagreement_blocks_export_until_human_adjudication(self):
        self.annotate(conflict=True)
        report = review.compare(self.batch)
        self.assertEqual(report["disagreements"], 1)
        self.assertEqual(report["all_subset"]["binary_pairs"], 5)
        self.assertEqual(report["all_subset"]["pairs_with_deferral"], 1)
        with self.assertRaisesRegex(ValueError, "unfinished/invalid"):
            review.finalize(self.batch)
        self.assertFalse((self.batch / "export").exists())
        self.adjudicate(identity="ai_reviewer")
        with self.assertRaisesRegex(ValueError, "Human adjudicator"):
            review.finalize(self.batch)
        self.adjudicate()
        receipt = review.finalize(self.batch)
        self.assertEqual(receipt["exported_unique_messages"], 5)
        self.assertEqual(receipt["deferred_records"], 1)
        self.assertEqual(receipt["adjudicated_records"], 1)
        exported = review.read_csv(self.batch / "export/messages_reviewed.csv", ["text", "label"])
        self.assertEqual({r["text"]: r["label"] for r in exported}["I am calm about my exam."],
                         "not_academic_stress")
        self.assertNotIn("Yes, every night.", [r["text"] for r in exported])
        path, _ = review.verified_training_path(self.batch)
        self.assertEqual(path, self.batch / "export/messages_reviewed.csv")
        log = review.read_csv(self.batch / "export/review_log.csv", ["item_id"])
        self.assertEqual(len(log), 6)
        self.assertTrue(all(r["reviewer_a_kind"] == "human" for r in log))

    def test_adjudication_can_keep_an_item_deferred(self):
        self.annotate(conflict=True)
        review.compare(self.batch)
        self.adjudicate(state="deferred", label="")
        receipt = review.finalize(self.batch)
        self.assertEqual(receipt["deferred_records"], 2)

    def test_source_policy_and_packet_integrity(self):
        self.annotate()
        path = self.batch / "reviewer_b/annotations.csv"
        rows = self.rows("reviewer_b/annotations.csv")
        rows[0]["text"] += " changed"
        self.rewrite(path, rows)
        with self.assertRaisesRegex(ValueError, "text or policy changed"):
            review.compare(self.batch)
        (self.root / "ANNOTATION_GUIDE.md").write_text("Changed policy.", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "guide changed"):
            review.load_manifest(self.batch)

    def test_source_changes_invalidate_batch(self):
        source = self.root / "data/messages.csv"
        source.write_bytes(source.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "Source changed"):
            review.load_manifest(self.batch)

    def test_added_prediction_fields_are_rejected(self):
        self.annotate()
        rows = self.rows("reviewer_b/annotations.csv")
        for row in rows:
            row["predicted_label"] = "academic_stress"
        self.rewrite(self.batch / "reviewer_b/annotations.csv", rows)
        with self.assertRaisesRegex(ValueError, "blind packet columns"):
            review.compare(self.batch)

    def test_missing_duplicate_records_and_invalid_deferrals_rejected(self):
        self.annotate()
        path = self.batch / "reviewer_b/annotations.csv"
        rows = self.rows("reviewer_b/annotations.csv")
        original_rows = [row.copy() for row in rows]
        rows[0] = rows[1].copy()
        self.rewrite(path, rows)
        with self.assertRaisesRegex(ValueError, "duplicate, missing, or extra"):
            review.compare(self.batch)
        self.rewrite(path, original_rows)
        rows = self.rows("reviewer_b/annotations.csv")
        for row in rows:
            if row["review_status"] == "deferred":
                row["reviewed_label"] = "academic_stress"
        self.rewrite(path, rows)
        with self.assertRaisesRegex(ValueError, "unfinished/invalid"):
            review.compare(self.batch)

    def test_changed_submitted_review_cannot_be_exported(self):
        self.annotate()
        review.compare(self.batch)
        path = self.batch / "reviewer_a/annotations.csv"
        rows = self.rows("reviewer_a/annotations.csv")
        rows[0]["evidence_note"] += " later edit"
        self.rewrite(path, rows)
        with self.assertRaisesRegex(ValueError, "changed after comparison"):
            review.finalize(self.batch)

    def test_export_and_adjudication_changes_block_training(self):
        self.annotate()
        review.compare(self.batch)
        review.finalize(self.batch)
        data = self.batch / "export/messages_reviewed.csv"
        original = data.read_bytes()
        data.write_bytes(original + b"\n")
        with self.assertRaisesRegex(ValueError, "Reviewed export changed"):
            review.verified_training_path(self.batch)
        data.write_bytes(original)
        adjudication = self.batch / "coordinator/comparison/adjudication.csv"
        adjudication.write_bytes(adjudication.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "artifact changed"):
            review.verified_training_path(self.batch)

    def test_unreviewed_training_path_has_no_fallback(self):
        with self.assertRaises(FileNotFoundError):
            review.verified_training_path(self.batch)

    def test_existing_batch_and_output_not_overwritten(self):
        with self.assertRaisesRegex(ValueError, "already exists"):
            review.prepare(self.batch)
        self.annotate()
        review.compare(self.batch)
        review.finalize(self.batch)
        with self.assertRaisesRegex(ValueError, "Export exists"):
            review.finalize(self.batch)

    def test_kappa_handles_empty_single_class_and_known_matrix(self):
        def row(label):
            return {"review_status": "labeled", "reviewed_label": label, "deferral_reason": ""}
        positive, negative = "academic_stress", "not_academic_stress"
        a = dict(enumerate(map(row, [positive, positive, negative, negative])))
        b = dict(enumerate(map(row, [positive, negative, negative, negative])))
        result = review.agreement(a, a, b)
        self.assertEqual(result["binary_agreement"], 0.75)
        self.assertEqual(result["cohen_kappa_binary"], 0.5)
        self.assertIsNone(review.agreement([], {}, {})["cohen_kappa_binary"])
        self.assertIsNone(review.agreement([0], a, a)["cohen_kappa_binary"])


if __name__ == "__main__":
    unittest.main()
