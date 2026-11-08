"""Prepare blind annotation packets, compare independent reviews, and export labels.

No model or old label is consulted to make an annotation. Only completed human
reviews, with disagreements adjudicated, can reach the training export.
"""

import argparse
import csv
import hashlib
import json
import random
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from task_definition import LABELS, TASK_DEFINITION_VERSION

ROOT = Path(__file__).resolve().parent
DEFAULT_BATCH = ROOT / "reports" / "annotation_review"
REASONS = {"needs_context", "unclear_attribution", "unclear_timing",
           "unclear_meaning", "unsupported_language"}
PACKET_FIELDS = ["item_id", "text", "review_status", "reviewed_label",
                 "deferral_reason", "evidence_note", "reviewer_id", "policy_version"]
ACADEMIC = re.compile(
    r"\b(school\w*|college|university|class\w*|course\w*|exam\w*|quiz\w*|"
    r"assignment\w*|homework|thesis|dissertation|grade\w*|gpa|stud\w*|"
    r"professor|teacher|semester|recitation|scholarship|academic\w*|"
    r"graduat\w*|finals|capstone|defense)\b", re.I)
BOUNDARY = re.compile(
    r"\b(not|no|never|used to|earlier|yesterday|friend|classmate|work|job|"
    r"family|parent\w*|rent|bills|tuition|loan\w*|if|said)\b|[\"?]", re.I)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def text_key(text):
    return " ".join(text.casefold().split())


def read_csv(path, fields):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if (not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames)
                or not set(fields).issubset(reader.fieldnames)):
            raise ValueError(f"{path}: missing or duplicate CSV columns; need {fields}")
        rows = list(reader)
    if any(None in row or any(v is None for v in row.values()) for row in rows):
        raise ValueError(f"{path}: malformed CSV row.")
    return rows


def write_csv(path, rows, fields):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_json(path, value):
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def load_manifest(batch):
    manifest = json.loads((batch / "coordinator" / "manifest.json").read_text(encoding="utf-8"))
    if manifest["policy_version"] != TASK_DEFINITION_VERSION:
        raise ValueError("Policy version changed. Prepare a new review batch.")
    if manifest["guide_sha256"] != digest(ROOT / "ANNOTATION_GUIDE.md"):
        raise ValueError("Annotation guide changed. Prepare a new review batch.")
    for source in manifest["sources"]:
        if digest(ROOT / source["path"]) != source["sha256"]:
            raise ValueError(f"Source changed: {source['path']}. Prepare a new batch.")
    return manifest


def prepare(batch, per_source=100, boundary_per_source=30, seed=42):
    if per_source < 1 or not 0 <= boundary_per_source <= per_source:
        raise ValueError("Use per-source >= 1 and boundary-per-source between 0 and per-source.")
    if batch.exists():
        raise ValueError(f"Batch already exists: {batch}. Use a new --batch path.")
    items, sources = [], []
    rng = random.Random(seed)
    for relative in ("data/messages.csv", "data/Stress-Annotated-Dataset.csv"):
        path = ROOT / relative
        rows = read_csv(path, ["text"])
        if not rows:
            raise ValueError(f"Empty source: {relative}")
        source_items = []
        for number, row in enumerate(rows, 1):
            if not row["text"].strip():
                raise ValueError(f"{relative}, record {number}: empty text.")
            # Record number is logical CSV record, not physical line number.
            identity = f"{relative}\0{number}\0{row['text']}"
            item = {
                "item_id": hashlib.sha256(identity.encode()).hexdigest()[:24],
                "text": row["text"], "source_file": relative,
                "source_row": number, "source_id": row.get("sentence_id", ""),
                "original_label": row.get("label", ""),
                "group_id": row.get("group_id", ""),
                "selection": "single_review",
            }
            source_items.append(item)
        candidates = [r for r in source_items if ACADEMIC.search(r["text"]) and
                      (BOUNDARY.search(r["text"]) or len(r["text"].split()) <= 8)]
        boundary = rng.sample(candidates, min(boundary_per_source, len(candidates), per_source))
        boundary_ids = {r["item_id"] for r in boundary}
        remaining = [r for r in source_items if r["item_id"] not in boundary_ids]
        random_items = rng.sample(remaining, min(per_source - len(boundary), len(remaining)))
        for item in boundary:
            item["selection"] = "boundary"
        for item in random_items:
            item["selection"] = "random_remainder"
        sources.append({"path": relative, "sha256": digest(path), "rows": len(rows),
                        "existing_labels": dict(Counter(r.get("label", "") for r in rows)),
                        "boundary_subset": len(boundary), "random_subset": len(random_items)})
        items.extend(source_items)
    if len({r["item_id"] for r in items}) != len(items):
        raise ValueError("Item ID collision.")
    manifest = {"schema_version": 1, "policy_version": TASK_DEFINITION_VERSION,
                "guide_sha256": digest(ROOT / "ANNOTATION_GUIDE.md"),
                "created_utc": datetime.now(timezone.utc).isoformat(), "seed": seed,
                "reviewer_a_kind": "human", "reviewer_b_kind": "ai",
                "sources": sources, "items": items,
                "sampling_note": "Per source: purposeful academic boundary cases plus a random "
                                 "sample of the remaining records. No labels/predictions used. "
                                 "Overall agreement is descriptive, not a population estimate."}
    (batch / "coordinator").mkdir(parents=True)
    write_json(batch / "coordinator" / "manifest.json", manifest)
    for role, selected in (("reviewer_a", items), ("reviewer_b", [
            r for r in items if r["selection"] != "single_review"])):
        selected = selected.copy()
        random.Random(seed + (1 if role == "reviewer_a" else 2)).shuffle(selected)
        packet = [{**{f: "" for f in PACKET_FIELDS}, "item_id": r["item_id"],
                   "text": r["text"], "policy_version": TASK_DEFINITION_VERSION} for r in selected]
        write_csv(batch / role / "annotations.csv", packet, PACKET_FIELDS)
        (batch / role / "ANNOTATION_GUIDE.md").write_bytes((ROOT / "ANNOTATION_GUIDE.md").read_bytes())
        (batch / role / "INSTRUCTIONS.md").write_text(
            "# Independent annotation\n\n"
            "Read ANNOTATION_GUIDE.md. Review only the supplied text. Do not consult "
            "source files, old labels, model predictions, or the other reviewer's work. "
            "Keep this packet separate until both reviews have been submitted.\n\n"
            "Keep item_id, text, and policy_version unchanged. Fill every record:\n\n"
            "- review_status: `labeled` or `deferred` (blank means unfinished).\n"
            "- reviewed_label: `academic_stress` or `not_academic_stress` for labeled "
            "records; leave blank for deferred records.\n"
            "- deferral_reason: blank for labeled records; otherwise one of "
            + ", ".join(f"`{r}`" for r in sorted(REASONS)) + ".\n"
            "- evidence_note: brief evidence about own experience, strain, timing, "
            "and academic connection. Do not infer context from the dataset's name.\n"
            "- reviewer_id: your consistent identity. The AI reviewer must identify "
            "itself as AI; its work does not count as human validation.\n\n"
            "Use a CSV-aware editor and save UTF-8. A negative label can include "
            "work/family/financial distress. Defer only when essential evidence "
            "cannot be interpreted, not because academic stress might be unexpressed.\n",
            encoding="utf-8")
    return manifest


def validate_reviews(path, expected, complete=True):
    rows = read_csv(path, PACKET_FIELDS)
    if any(set(row) != set(PACKET_FIELDS) for row in rows):
        raise ValueError(f"{path}: keep only the blind packet columns; added fields are not accepted.")
    if len(rows) != len(expected) or len({r["item_id"] for r in rows}) != len(rows):
        raise ValueError(f"{path}: duplicate, missing, or extra records.")
    index = {r["item_id"]: r for r in rows}
    if set(index) != set(expected):
        raise ValueError(f"{path}: item IDs differ from the assigned packet.")
    identities = set()
    for key, original in expected.items():
        row = index[key]
        if row["text"] != original["text"] or row["policy_version"] != TASK_DEFINITION_VERSION:
            raise ValueError(f"{path}: text or policy changed for {key}.")
        state = row["review_status"]
        if not state and not complete:
            if any(row[f].strip() for f in ("reviewed_label", "deferral_reason", "evidence_note")):
                raise ValueError(f"{path}: unfinished record has decision fields: {key}.")
            continue
        validate_decision(state, row["reviewed_label"], row["deferral_reason"], key)
        if not row["evidence_note"].strip() or not row["reviewer_id"].strip():
            raise ValueError(f"{path}: evidence_note and reviewer_id required for {key}.")
        identities.add(row["reviewer_id"].strip())
    if len(identities) > 1:
        raise ValueError(f"{path}: use one consistent reviewer identity per packet.")
    return index, next(iter(identities), "")


def validate_decision(state, label, reason, item_id):
    if state == "labeled" and label in LABELS and reason == "":
        return
    if state == "deferred" and label == "" and reason in REASONS:
        return
    raise ValueError(f"{item_id}: unfinished/invalid decision; use labeled + binary label "
                     "or deferred + blank label + supported reason.")


def expected_packets(manifest):
    all_items = {r["item_id"]: r for r in manifest["items"]}
    double = {key: r for key, r in all_items.items() if r["selection"] != "single_review"}
    return all_items, double


def decision(row):
    return row["review_status"], row["reviewed_label"], row["deferral_reason"]


def agreement(keys, a, b):
    pairs = [(a[key], b[key]) for key in keys]
    binary = [(x["reviewed_label"], y["reviewed_label"]) for x, y in pairs
              if x["review_status"] == y["review_status"] == "labeled"]
    count = len(binary)
    observed = sum(x == y for x, y in binary) / count if count else None
    ac, bc = Counter(x for x, _ in binary), Counter(y for _, y in binary)
    chance = sum(ac[label] * bc[label] for label in LABELS) / count ** 2 if count else None
    kappa = (observed - chance) / (1 - chance) if count and chance < 1 else None
    return {"paired_items": len(pairs), "matching_decisions": sum(decision(x) == decision(y)
            for x, y in pairs), "binary_pairs": count, "binary_agreement": observed,
            "cohen_kappa_binary": kappa,
            "pairs_with_deferral": sum(x["review_status"] == "deferred" or
                                       y["review_status"] == "deferred" for x, y in pairs),
            "binary_confusion_matrix": [[sum(x == left and y == right for x, y in binary)
                                          for right in LABELS] for left in LABELS],
            "label_order": LABELS}


def compare(batch):
    manifest = load_manifest(batch)
    all_items, double = expected_packets(manifest)
    a, identity_a = validate_reviews(batch / "reviewer_a" / "annotations.csv", all_items)
    b, identity_b = validate_reviews(batch / "reviewer_b" / "annotations.csv", double)
    if identity_a == identity_b:
        raise ValueError("Two distinct reviewer identities are required.")
    output = batch / "coordinator" / "comparison"
    if output.exists():
        raise ValueError("Comparison already sealed. Prepare a new batch for another review round.")
    conflicts = []
    for key in double:
        if decision(a[key]) != decision(b[key]):
            conflicts.append({"item_id": key, "text": all_items[key]["text"],
                              "a_status": a[key]["review_status"], "a_label": a[key]["reviewed_label"],
                              "a_reason": a[key]["deferral_reason"], "a_note": a[key]["evidence_note"],
                              "b_status": b[key]["review_status"], "b_label": b[key]["reviewed_label"],
                              "b_reason": b[key]["deferral_reason"], "b_note": b[key]["evidence_note"],
                              "final_status": "", "final_label": "", "deferral_reason": "",
                              "adjudication_note": "", "adjudicator_id": "",
                              "policy_version": TASK_DEFINITION_VERSION})
    output.mkdir()
    # Preserve submitted annotations. Future edits to packets invalidate finalization.
    for role in ("reviewer_a", "reviewer_b"):
        (output / f"{role}_submitted.csv").write_bytes((batch / role / "annotations.csv").read_bytes())
    conflict_fields = ["item_id", "text", "a_status", "a_label", "a_reason", "a_note",
                       "b_status", "b_label", "b_reason", "b_note", "final_status", "final_label",
                       "deferral_reason", "adjudication_note", "adjudicator_id", "policy_version"]
    write_csv(output / "adjudication.csv", conflicts, conflict_fields)
    report = {"reviewer_a": {"id": identity_a, "kind": "human"},
              "reviewer_b": {"id": identity_b, "kind": "ai"},
              "disagreements": len(conflicts), "all_subset": agreement(double, a, b),
              "by_selection": {tag: agreement([k for k in double if double[k]["selection"] == tag], a, b)
                               for tag in ("boundary", "random_remainder")},
              "note": "Pre-adjudication agreement between one human and one AI reviewer. "
                      "This is not inter-human reliability. Deferrals excluded from binary kappa. "
                      "Null kappa means unavailable/undefined. Sampling is boundary-enriched.",
              "manifest_sha256": digest(batch / "coordinator" / "manifest.json")}
    write_json(output / "agreement.json", report)
    return report


def finalize(batch):
    manifest = load_manifest(batch)
    all_items, double = expected_packets(manifest)
    comparison = batch / "coordinator" / "comparison"
    report = json.loads((comparison / "agreement.json").read_text(encoding="utf-8"))
    if report["manifest_sha256"] != digest(batch / "coordinator" / "manifest.json"):
        raise ValueError("Manifest changed after comparison.")
    reviews = []
    for role, expected in (("reviewer_a", all_items), ("reviewer_b", double)):
        current = batch / role / "annotations.csv"
        submitted = comparison / f"{role}_submitted.csv"
        if digest(current) != digest(submitted):
            raise ValueError(f"{role} changed after comparison. Prepare a new review round.")
        reviews.append(validate_reviews(submitted, expected)[0])
    a, b = reviews
    conflicts = {key for key in double if decision(a[key]) != decision(b[key])}
    resolutions = read_csv(comparison / "adjudication.csv", ["item_id", "text", "final_status",
                           "final_label", "deferral_reason", "adjudication_note", "adjudicator_id",
                           "policy_version"])
    if len(resolutions) != len(conflicts) or {r["item_id"] for r in resolutions} != conflicts:
        raise ValueError("Adjudication records must cover every disagreement exactly once.")
    final = {}
    for row in resolutions:
        key = row["item_id"]
        if row["text"] != all_items[key]["text"] or row["policy_version"] != TASK_DEFINITION_VERSION:
            raise ValueError(f"Adjudication text/policy changed: {key}")
        validate_decision(row["final_status"], row["final_label"], row["deferral_reason"], key)
        # The human reviewer may resolve a human/AI disagreement after independence ends.
        if (not row["adjudication_note"].strip() or not row["adjudicator_id"].strip()
                or row["adjudicator_id"].strip() == report["reviewer_b"]["id"]):
            raise ValueError(f"Human adjudicator identity and policy-based note required: {key}")
        final[key] = (row["final_status"], row["final_label"], row["deferral_reason"],
                      row["adjudicator_id"], row["adjudication_note"])
    training, log, seen = [], [], {}
    for key, item in all_items.items():
        state, label, reason, adjudicator, note = final.get(key, (*decision(a[key]), "", ""))
        log.append({"item_id": key, "source_file": item["source_file"],
                    "source_row": item["source_row"], "source_id": item["source_id"],
                    "original_label": item["original_label"], "final_status": state,
                    "final_label": label, "deferral_reason": reason,
                    "reviewer_a": report["reviewer_a"]["id"], "reviewer_a_kind": "human",
                    "reviewer_b": report["reviewer_b"]["id"] if key in double else "",
                    "reviewer_b_kind": "ai" if key in double else "",
                    "human_evidence": a[key]["evidence_note"],
                    "ai_evidence": b[key]["evidence_note"] if key in double else "",
                    "adjudicator_id": adjudicator, "adjudication_note": note,
                    "policy_version": TASK_DEFINITION_VERSION})
        if state == "deferred":
            continue
        normalized = text_key(item["text"])
        signature = (label, item["group_id"])
        if normalized in seen:
            if seen[normalized] != signature:
                raise ValueError("Duplicate messages have conflicting final labels/groups. Resolve first.")
            continue
        seen[normalized] = signature
        training.append({"text": item["text"], "label": label, "group_id": item["group_id"]})
    if not training:
        raise ValueError("No completed binary labels to export.")
    grouped = any(r["group_id"] for r in training)
    if grouped and not all(r["group_id"] for r in training):
        raise ValueError("Some sources lack group_id. Assign verified groups before preparing a new batch.")
    output = batch / "export"
    if output.exists():
        raise ValueError("Export exists. Existing reviewed data will not be overwritten.")
    output.mkdir()
    write_csv(output / "messages_reviewed.csv", training, ["text", "label"] + (["group_id"] if grouped else []))
    write_csv(output / "review_log.csv", log, list(log[0]))
    receipt = {"policy_version": TASK_DEFINITION_VERSION, "guide_sha256": manifest["guide_sha256"],
               "data_sha256": digest(output / "messages_reviewed.csv"),
               "review_log_sha256": digest(output / "review_log.csv"),
               "manifest_sha256": digest(batch / "coordinator" / "manifest.json"),
               "human_reviewed_records": len(all_items), "double_reviewed_records": len(double),
               "adjudicated_records": len(conflicts), "exported_unique_messages": len(training),
               "deferred_records": sum(r["final_status"] == "deferred" for r in log),
               "review_design": "one human on all records; one AI on a subset; human adjudication",
               "review_artifact_sha256": {name: digest(comparison / name) for name in (
                   "reviewer_a_submitted.csv", "reviewer_b_submitted.csv",
                   "agreement.json", "adjudication.csv")},
               "created_utc": datetime.now(timezone.utc).isoformat()}
    write_json(output / "review_receipt.json", receipt)
    return receipt


def verified_training_path(batch):
    """Require the reviewed export and its matching review/source artifacts."""
    manifest = load_manifest(batch)
    output = batch / "export"
    receipt = json.loads((output / "review_receipt.json").read_text(encoding="utf-8"))
    for filename, field in (("messages_reviewed.csv", "data_sha256"), ("review_log.csv", "review_log_sha256")):
        if digest(output / filename) != receipt[field]:
            raise ValueError(f"Reviewed export changed: {filename}. Re-review before training.")
    if (receipt["policy_version"] != TASK_DEFINITION_VERSION or
            receipt["guide_sha256"] != manifest["guide_sha256"] or
            receipt["manifest_sha256"] != digest(batch / "coordinator" / "manifest.json")):
        raise ValueError("Review receipt does not match the policy/source batch.")
    comparison = batch / "coordinator" / "comparison"
    for name in ("reviewer_a_submitted.csv", "reviewer_b_submitted.csv",
                 "agreement.json", "adjudication.csv"):
        if digest(comparison / name) != receipt["review_artifact_sha256"][name]:
            raise ValueError(f"Review artifact changed after export: {name}.")
    if any(digest(batch / role / "annotations.csv") != digest(comparison / f"{role}_submitted.csv")
           for role in ("reviewer_a", "reviewer_b")):
        raise ValueError("Review annotations changed after export.")
    # Checksums detect accidental stale data; local files are not identity authentication.
    return output / "messages_reviewed.csv", receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "status", "compare", "finalize"])
    parser.add_argument("--batch", type=Path, default=DEFAULT_BATCH)
    parser.add_argument("--per-source", type=int, default=100)
    parser.add_argument("--boundary-per-source", type=int, default=30)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)
    batch = args.batch.resolve()
    if args.command == "prepare":
        manifest = prepare(batch, args.per_source, args.boundary_per_source, args.seed)
        print(f"Prepared {len(manifest['items'])} human-review records and "
              f"{sum(r['selection'] != 'single_review' for r in manifest['items'])} AI subset records.")
        print(f"Human packet: {batch / 'reviewer_a'}")
        print("Share only the human packet with the human reviewer. Keep AI decisions separate.")
    elif args.command == "status":
        manifest = load_manifest(batch)
        for role, expected in zip(("reviewer_a", "reviewer_b"), expected_packets(manifest)):
            rows, _ = validate_reviews(batch / role / "annotations.csv", expected, complete=False)
            completed = sum(bool(r["review_status"]) for r in rows.values())
            print(f"{role}: {completed}/{len(rows)} decisions completed (labels hidden).")
    elif args.command == "compare":
        report = compare(batch)
        print(f"Compared submitted reviews. {report['disagreements']} disagreements require human adjudication.")
        print(f"Results: {batch / 'coordinator' / 'comparison'}")
    else:
        receipt = finalize(batch)
        print(f"Exported {receipt['exported_unique_messages']} reviewed messages; "
              f"excluded {receipt['deferred_records']} deferred records.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, csv.Error) as error:
        raise SystemExit(f"Review stopped: {error}")
