import csv
from pathlib import Path

from sklearn.model_selection import GroupShuffleSplit

from . import LABELS
from .features import normalize


def read_dataset(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"text", "label", "student_id", "conversation_id"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"CSV requires columns: {', '.join(sorted(required))}")
        rows = []
        for line_number, row in enumerate(reader, 2):
            if None in row:
                raise ValueError(f"Extra CSV fields on row {line_number}; quote text containing commas.")
            rows.append({key: (value or "").strip() for key, value in row.items()})
    if not rows:
        raise ValueError("The dataset is empty. Provide reviewed student-message annotations.")
    owners = {}
    annotations = {}
    for index, row in enumerate(rows, 2):
        if not all(row.get(key) for key in required) or row["label"] not in LABELS or len(row["text"]) > 4000:
            raise ValueError(f"Invalid or missing fields on CSV row {index}.")
        conversation = row["conversation_id"]
        if conversation in owners and owners[conversation] != row["student_id"]:
            raise ValueError("A conversation cannot belong to multiple students.")
        owners[conversation] = row["student_id"]
        text = normalize(row["text"])
        if text in annotations and annotations[text] != row["label"]:
            raise ValueError("Conflicting labels for identical normalized text; adjudicate annotations first.")
        annotations[text] = row["label"]
    return rows


def split_dataset(rows: list[dict]) -> dict[str, list[dict]]:
    names = ("train", "validation", "test")
    if any(row.get("split") for row in rows):
        if any(row.get("split") not in names for row in rows):
            raise ValueError("Every split must be train, validation, or test when the split column is used.")
        partitions = {name: [row for row in rows if row["split"] == name] for name in names}
    else:
        groups = [row["student_id"] for row in rows]
        remaining, test = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42).split(rows, groups=groups))
        train, validation = next(GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=43).split(remaining, groups=[groups[i] for i in remaining]))
        partitions = {
            "train": [rows[remaining[i]] for i in train],
            "validation": [rows[remaining[i]] for i in validation],
            "test": [rows[i] for i in test],
        }
    seen_students, seen_texts = set(), set()
    for name, items in partitions.items():
        if {row["label"] for row in items} != set(LABELS):
            raise ValueError(f"{name} must contain all four classes; supply a larger dataset or explicit grouped splits.")
        students = {row["student_id"] for row in items}
        texts = {normalize(row["text"]) for row in items}
        if seen_students & students:
            raise ValueError("Student/conversation leakage between dataset partitions.")
        if seen_texts & texts:
            raise ValueError("Duplicate normalized text across partitions would leak evaluation data.")
        seen_students |= students
        seen_texts |= texts
    return partitions
