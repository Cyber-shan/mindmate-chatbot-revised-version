"""Try new English messages using your own saved MindMate practice model."""

from pathlib import Path

import joblib

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "models" / "academic_stress_pipeline.joblib"
DISPLAY_LABELS = {
    "academic_stress": "Academic stress expressed",
    "not_academic_stress": "Academic stress not expressed",
}


def main():
    if not MODEL_PATH.is_file():
        raise SystemExit("No saved model. Run train.py successfully first.")

    # Load only the model you created locally with train.py.
    model = joblib.load(MODEL_PATH)
    print("MindMate practice classifier. Type exit to stop.")
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
