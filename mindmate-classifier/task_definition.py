"""Shared wording for MindMate's intended binary classification task.

These definitions do not certify existing annotations or change a fitted model.
The complete annotation policy is in ANNOTATION_GUIDE.md.
"""

TASK_DEFINITION_VERSION = "1.0.0"
TARGET_DEFINITION = (
    "The student expresses current stress connected to academic demands."
)
LANGUAGE_SCOPE = "English"
ANNOTATION_UNIT = "One student-authored message, using only its text."

LABELS = ["not_academic_stress", "academic_stress"]
DISPLAY_LABELS = {
    "academic_stress": "Academic stress expressed",
    "not_academic_stress": "Academic stress not expressed",
}
LABEL_DEFINITIONS = {
    "academic_stress": (
        "The message expresses the student's own current, ongoing, or recurring "
        "stress connected to academic demands."
    ),
    "not_academic_stress": (
        "The message does not express the target; this does not establish "
        "the student's wellbeing or need for support."
    ),
}
SCOPE_NOTE = (
    "Labels describe academic stress expressed in this message. "
    "They do not assess severity, diagnosis, or whether the student is okay."
)
