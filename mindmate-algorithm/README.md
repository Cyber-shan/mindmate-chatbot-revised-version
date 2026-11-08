# MindMate support-priority algorithm

This implements the supplied hybrid design: word and character TF-IDF with calibrated Logistic Regression, plus an independent safety-rule and conversation-policy layer in the Next.js chat server. The four labels are `LOW`, `MODERATE`, `HIGH_CONCERN`, and `IMMEDIATE_SAFETY`. They prioritize support; they do not diagnose a mental disorder.

The implementation works in **rules-only mode immediately**. No real student corpus, trained production model, clinician approval, or performance claims are included. Synthetic examples in tests verify software behavior only. Existing deletions under the old `mindmate-classifier` directory were left untouched.

```text
Student message + saved conversation
    -> preserve original; normalize a copy
    -> independent contextual safety rules
    -> optional calibrated TF-IDF/Logistic Regression scores
    -> monotonic priority policy + safety-question state
    -> supportive generation OR fixed safety response
    -> private audit event + optional human-review queue
```

The safety engine is in [`../mindmate-chatbot/lib/support`](../mindmate-chatbot/lib/support). This Python service only supplies ML probabilities. Keeping the rule engine in the application means an unavailable Python service cannot disable safety responses.

## Local setup

From this directory, using Python 3.11 or later:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The isolated environment was created during implementation. To start the service without a trained model:

```powershell
.\.venv\Scripts\python.exe serve.py
```

`GET http://127.0.0.1:8001/health` reports `ready: false`. `POST /predict` returns 503 until an artifact is loaded. MindMate then uses its rules-only policy.

## Dataset and training

Use the columns in [`data/schema.csv`](data/schema.csv). `text`, `label`, `student_id`, and `conversation_id` are required. IDs must be pseudonymous and stable. Optional `split` values are `train`, `validation`, and `test`; if any split is supplied, every row must have one. Optional `subgroup` identifies an evaluation cohort such as language; do not put personal information in it.

See [`ANNOTATION_GUIDE.md`](ANNOTATION_GUIDE.md) before labeling. Supply a consented, de-identified, reviewed dataset locally; `data/` contents and model artifacts are ignored by Git.

```powershell
.\.venv\Scripts\python.exe train.py --data data/reviewed.csv --output artifacts/research
```

Training uses word unigrams/bigrams and character 3–5-grams, balanced Logistic Regression, and sigmoid probability calibration over three student-disjoint folds. All TF-IDF fitting occurs inside training/calibration folds. Stopwords and negations are retained. If splits are omitted, a deterministic student-group split produces roughly 60% training, 20% validation, and 20% test data. Every split and calibration fold must contain all four classes. Student overlap, conversation ownership conflicts, conflicting annotations and identical normalized text across partitions are rejected.

Outputs are `classifier.joblib` and `evaluation.json`. Evaluation includes the four-class confusion matrix, per-class precision/recall, macro F1, immediate and combined high-priority recall, critical false negatives, false positives, F2, Brier score, ten-bin calibration error and available subgroup reports. A research run has `release_approved: false` and no operational ML thresholds; the chat server deliberately ignores its scores.

## Reviewed thresholds and release gates

Copy [`review-config.template.json`](review-config.template.json) to a local review file and have responsible clinicians/researchers fill it. The template intentionally contains no invented acceptance percentages. Supply the reviewer, review date, dataset version and exact SHA-256, approved confidence threshold, validation recall targets, test acceptance gates, required subgroups and minimum subgroup sample size. Set `approved_for_release` only after the institution's review process authorizes it.

```powershell
Get-FileHash -Algorithm SHA256 data/reviewed.csv
.\.venv\Scripts\python.exe train.py --data data/reviewed.csv --output artifacts/reviewed --review-config review-config.local.json
```

Copy the hash as lowercase. Safety thresholds are selected on **validation data** to maximize precision subject to the specified recall targets. They are then frozen for evaluation on the held-out test split. Release approval requires the explicit review flag and passing overall and required subgroup gates. Repeatedly tuning against the test report invalidates the holdout; use a new untouched test set after changes informed by test results. Passing software gates alone is not a clinical validation study.

```powershell
$env:DISTRESS_CLASSIFIER_TOKEN = 'a-private-service-token'
.\.venv\Scripts\python.exe serve.py --model artifacts/reviewed/classifier.joblib
```

The default bind is loopback. Non-local binds require a token; use a trusted TLS reverse proxy and private network. Only load trusted local joblib artifacts: their serialization can execute code. Artifacts also contain learned vocabulary and must be handled as sensitive data.

`POST /predict` accepts `{ "text": "..." }` with 1–4000 characters. It returns `scores`, `model_version`, `thresholds`, and `release_approved`. Authentication is `Authorization: Bearer <DISTRESS_CLASSIFIER_TOKEN>` when configured. No student text is logged by the service. See [`../mindmate-chatbot/SUPPORT_SETUP.md`](../mindmate-chatbot/SUPPORT_SETUP.md) to connect it to chat and configure private auditing.

## Limits and references

The draft safety rules cover selected English and Tagalog expressions and some context, contractions and obfuscations. They are not a complete multilingual language-understanding system or a validated clinical instrument. Unsupported language, sarcasm, new slang and ambiguous intent require additional review and regression examples. High recall in synthetic software fixtures is not evidence of real-world safety performance.

The implementation uses scikit-learn's documented [TF-IDF feature extraction](https://scikit-learn.org/stable/modules/feature_extraction.html), [Logistic Regression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html), [grouped splitting](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GroupShuffleSplit.html), and [probability calibration](https://scikit-learn.org/stable/modules/generated/sklearn.calibration.CalibratedClassifierCV.html). The draft response templates draw on NIMH guidance to ask about safety, listen, help reduce immediate danger and connect with people; they still need local clinician review. [NIMH action steps](https://www.nimh.nih.gov/health/publications/5-action-steps-to-help-someone-having-thoughts-of-suicide).
