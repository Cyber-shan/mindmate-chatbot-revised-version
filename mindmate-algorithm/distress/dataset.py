import csv
from pathlib import Path

from sklearn.model_selection import GroupShuffleSplit

from . import LABELS
from .features import normalize


def _validate_identities(rows: list[dict]):
    owners = {}
    for row in rows:
        if any(not isinstance(row.get(field), str) or not row[field].strip() for field in ("student_id", "conversation_id")):
            raise ValueError("Every message needs nonempty student_id and conversation_id values.")
        owner = owners.setdefault(row["conversation_id"], row["student_id"])
        if owner != row["student_id"]:
            raise ValueError("Conversation ownership conflict: multiple students would cause student/conversation leakage.")


def leakage_groups(rows: list[dict]) -> list[str]:
    """Keep connected students, conversations, duplicate texts and template families together."""
    _validate_identities(rows)
    parents = list(range(len(rows)))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    seen = {}
    for index, row in enumerate(rows):
        keys = [(field, row[field]) for field in ("student_id", "conversation_id")]
        keys.append(("text", normalize(row["text"])))
        if row.get("template_family"):
            keys.append(("template_family", row["template_family"]))
        for key in keys:
            if key in seen:
                first, second = root(index), root(seen[key])
                parents[max(first, second)] = min(first, second)
            else:
                seen[key] = index
    # Stable identifiers keep seeded splits independent of message ordering.
    students = {}
    for index, row in enumerate(rows):
        component = root(index)
        students[component] = min(students.get(component, row["student_id"]), row["student_id"])
    return [f"group:{students[root(index)]}" for index in range(len(rows))]


def partition_audit(partitions: dict[str, list[dict]]) -> dict:
    """Reject overlap and return aggregate evidence without saving student IDs or message text."""
    _validate_identities([row for rows in partitions.values() for row in rows])
    seen = {field: set() for field in ("student_id", "conversation_id", "text", "template_family")}
    summary = {}
    for name, rows in partitions.items():
        values = {field: {row[field] for row in rows if row.get(field)} for field in seen}
        values["text"] = {normalize(row["text"]) for row in rows}
        for field, entries in values.items():
            if seen[field] & entries:
                if field == "text":
                    raise ValueError("Duplicate normalized text across partitions would leak evaluation data.")
                if field == "template_family":
                    raise ValueError("Synthetic template-family leakage between dataset partitions.")
                raise ValueError(f"Student/conversation leakage: {field} occurs in multiple partitions.")
            seen[field] |= entries
        summary[name] = {
            "message_count": len(rows), "student_count": len(values["student_id"]),
            "conversation_count": len(values["conversation_id"]),
            "independent_group_count": len(set(leakage_groups(rows))),
            "class_counts": {label: sum(row["label"] == label for row in rows) for label in LABELS},
        }
    return {"passed": True, "checked_fields": list(seen), "partitions": summary}


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
    _validate_identities(rows)
    names = ("train", "validation", "test")
    if any(row.get("split") for row in rows):
        if any(row.get("split") not in names for row in rows):
            raise ValueError("Every split must be train, validation, or test when the split column is used.")
        partitions = {name: [row for row in rows if row["split"] == name] for name in names}
    else:
        groups = leakage_groups(rows)
        if len(set(groups)) < 3:
            raise ValueError("Splitting requires at least three independent student/conversation groups.")
        remaining, test = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42).split(rows, groups=groups))
        train, validation = next(GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=43).split(remaining, groups=[groups[i] for i in remaining]))
        partitions = {
            "train": [rows[remaining[i]] for i in train],
            "validation": [rows[remaining[i]] for i in validation],
            "test": [rows[i] for i in test],
        }
    for name, items in partitions.items():
        if {row["label"] for row in items} != set(LABELS):
            raise ValueError(f"{name} must contain all four classes; supply a larger dataset or explicit grouped splits.")
    partition_audit(partitions)
    return partitions
