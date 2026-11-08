"""Try English messages for the intended task defined in ANNOTATION_GUIDE.md.

Target: The student expresses current stress connected to academic demands.
The saved practice model may not have been trained under this policy.
"""

from pathlib import Path

import joblib

from task_definition import DISPLAY_LABELS, SCOPE_NOTE, TARGET_DEFINITION

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "models" / "academic_stress_pipeline.joblib"


def main():
    if not MODEL_PATH.is_file():
        raise SystemExit("No saved model. Run train.py successfully first.")

    # Load only the model you created locally with train.py.
    model = joblib.load(MODEL_PATH)
    print("MindMate practice classifier. Type exit to stop.")
    print("Intended target:", TARGET_DEFINITION)
    print(SCOPE_NOTE)
    print("Predictions can be wrong. A negative label does not mean a student is okay.")

    while True:
        try:
            message = input("\nStudent message: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nFinished.")
            break
        if message.casefold() == "exit":
            break
        if not message:
            print("Enter a message first.")
            continue

        features = model.named_steps["tfidf"].transform([message])
        if features.nnz == 0:
            print("No usable terms recognized. No prediction made.")
            continue
        label = model.predict([message])[0]
        print("Predicted label:", label)
        print("Meaning:", DISPLAY_LABELS[label])


if __name__ == "__main__":
    main()
