from pathlib import Path

import joblib

from . import LABELS


class Classifier:
    def __init__(self, path: Path):
        # joblib/pickle can execute code: load only locally produced, trusted artifacts.
        self.artifact = joblib.load(path)
        if self.artifact.get("schema_version") != 1 or set(self.artifact["model"].classes_) != set(LABELS):
            raise ValueError("Unsupported model artifact or missing support-priority classes.")

    def predict(self, text: str) -> dict:
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise ValueError("text must contain between 1 and 4000 characters.")
        model = self.artifact["model"]
        scores = dict(zip(model.classes_, map(float, model.predict_proba([text])[0])))
        return {
            "scores": {label: scores[label] for label in LABELS},
            "model_version": self.artifact["model_version"],
            "thresholds": self.artifact["thresholds"],
            "release_approved": self.artifact["release_approved"],
            **self.mode_metadata(),
        }

    def mode_metadata(self) -> dict:
        return {
            "model_mode": self.artifact.get("model_mode", "reviewed" if self.artifact.get("release_approved") is True else "research"),
            "synthetic_data": self.artifact.get("synthetic_data", False),
            "language": self.artifact.get("language", "unspecified"),
            "prototype_usable": self.artifact.get("prototype_usable", False),
        }
