# Support-priority classification annotation guide (draft)

These categories describe recommended counselor attention based on the available message and permitted conversation context. They support human review and do not diagnose a disorder or assign clinical severity. Have qualified reviewers approve this rubric, the runtime rules and response templates before a student-facing release.

| Category | Intended meaning | Internal key |
|---|---|---|
| **Low priority** | Routine supportive response; no direct counselor attention indicated by the available message. | `LOW` |
| **Moderate priority** | Counselor attention recommended, but not urgently. | `MODERATE` |
| **High priority** | Counselor attention recommended as soon as possible. | `HIGH_CONCERN` |
| **Immediate attention** | Potential safety-related content requiring priority human review. | `IMMEDIATE_SAFETY` |

Use the internal keys in training CSV files and model artifacts to preserve compatibility. A recommendation for counselor attention does not itself contact a counselor or guarantee a review time.

Preserve the original message. Label personal current intent differently from explicit denial, academic discussion, quotations, third-person disclosures and past experiences. A denial does not cancel a separate disclosure in another clause. Record uncertainty for adjudication instead of forcing an unsupported confident label.

Use two independent annotators with access to permitted conversation context. Record disagreements, agreement statistics and adjudication separately from the training CSV. Have a qualified reviewer adjudicate safety-sensitive disagreements. Do not derive ground truth from model predictions or keyword matches.

Include ordinary academic stress and difficult negative examples: negation, quotations, homework, jokes, historical experiences, concern for someone else, misspellings, emoji, slang, code-switching, and indirect distress. Include realistic local student language. Evaluate short safety answers in multi-turn tests: the text-only ML service cannot infer what "not really" answers; the application policy uses conversation state for that.

Use stable pseudonymous student and conversation identifiers. A student, including all their conversations, belongs to exactly one train/validation/test partition. Remove identifying details under the institution's consent and privacy process. Never commit actual messages, identifiers, datasets or trained vocabulary to the repository.

Have responsible clinicians/researchers choose recall targets, acceptable false-negative rates, calibration limits, confidence thresholds, minimum subgroup sample sizes, required cohorts and operational escalation procedures. The review-config template intentionally leaves these values blank.
