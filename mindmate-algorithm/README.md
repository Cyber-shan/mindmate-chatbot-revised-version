# MindMate support-priority algorithm

This implements the supplied hybrid design: word and character TF-IDF with calibrated Logistic Regression, plus an independent safety-rule and conversation-policy layer in the Next.js chat server. The four labels are `LOW`, `MODERATE`, `HIGH_CONCERN`, and `IMMEDIATE_SAFETY`. They prioritize support; they do not diagnose a mental disorder.

The implementation includes a **working English synthetic-data prototype** and an independent rules-only fallback. It produces a trained classifier, probabilities, validation-selected demonstration thresholds, and evaluation artifacts. Synthetic evaluation measures this generated corpus only; it does not establish performance on real students or clinical validity. Prototype artifacts always retain `release_approved: false`.

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

## Run the completed prototype

From the repository root or `mindmate-chatbot`:

```powershell
npm run dev
```

`dev` automatically prepares or reuses a compatible synthetic English model, starts or verifies the classifier on loopback, and launches the development app with the existing local services. No separate classifier command or environment edit is needed. It uses the existing local Python environment and project dependencies; install the requirements below if the environment is missing. Docker, Supabase, and Ollama are needed for the full app.

`npm.cmd run prototype` is an optional shortcut for the same classifier with an optimized app build. `npm.cmd run train:algorithm` runs the English generator and training pipeline without the other app services, and `npm.cmd run verify:algorithm` checks the classifier and app policy without starting Supabase or Ollama.

Alternatively, from this directory:

```powershell
.\.venv\Scripts\python.exe prototype.py --output artifacts/prototype
.\.venv\Scripts\python.exe serve.py --model artifacts/prototype/classifier.joblib
```

The generator creates deterministic, balanced English examples across all four priority labels. Student IDs, conversation IDs, normalized text, and core template families stay separate across training, validation, and test partitions. Negations, academic quotations, ordinary stress, persistent distress, and safety concerns are included. Calibration also keeps student groups separate. Templates and their labeling assumptions are visible in `distress/synthetic.py`.

`artifacts/prototype/evaluation.json` records split sizes, provenance, dependency versions, thresholds, validation and synthetic regression metrics. The regression holdout was reused during engineering development and is not an untouched statistical test. Prototype thresholds and usability checks are engineering demonstration settings, not institution-approved release criteria. `prototype_usable` reports whether the prototype passed its validation checks; it never grants release approval. `verify:algorithm` exercises the real artifact over HTTP through the app policy, checks rule-priority floors and contextual abstention, and verifies that removing prototype opt-in disables synthetic scores. It needs neither Supabase nor Ollama.

Read `artifacts/prototype/evaluation.md` for a readable report of per-class precision, recall, F1, sample counts, true/false positives and false negatives, total errors, under/over-prioritization, low-confidence predictions, and calibration error. The JSON companion includes approximate 95% confidence intervals, per-class interval bounds, and calibration bins. Intervals resample whole connected groups, not individual messages; adding repeated messages from one student must not create artificial certainty. Null bounds are explicitly marked when there are insufficient groups, unsupported classes, or no observed variation. A perfect observed recall therefore never produces a claim of zero future risk. These intervals describe sampling variability conditional on the fitted model and thresholds, not training uncertainty or real-world validity. The synthetic holdouts contain only eight resampling groups each, so their intervals are particularly unstable.

`npm.cmd run verify:algorithm` additionally saves `artifacts/prototype/context-evaluation.json`, with per-class counts, a confusion matrix, and results by negation, quotation, historical, and conversation-context challenge category. These fixed engineering fixtures are separate from model training and are not a random population sample; no population confidence interval is claimed for their pass rate.

Known limitations include over-prioritizing some persistent sadness or ambiguous requests and missing the meaning of unfamiliar phrasing. The example tester's expected labels are rules-only references; a model can raise those priorities, and differences are displayed for review. Inspect the confusion matrix, false-positive rate, calibration error, and individual predictions instead of treating the usability check as an accuracy guarantee.

`GET /health` identifies the loaded model, its mode, synthetic provenance, language, and prototype usability. `POST /predict` supplies the same provenance with four normalized class scores. The app accepts these scores only with explicit `DISTRESS_CLASSIFIER_MODE=prototype`, a loopback HTTP classifier URL, and the complete English prototype metadata. The launcher sets these options for its child processes without editing `.env.local`. Research artifacts remain ineligible; the normal reviewed-model path stays available.

Use **Admin > Algorithm tester** to inspect decisions. A synthetic-prototype label appears when ML contributes. Direct immediate-safety rules bypass ML, so those decisions correctly show no contributing model. The prototype model also abstains when rules recognize negated, academic, idiomatic, historical, or third-party safety context; rules and conversation state decide those cases. Generated chatbot replies are instructed to use English.

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

Generated prototype rows also declare `data_source=synthetic`, `language=en`, and a `template_family`. Prototype training requires English synthetic provenance on every row. Template families are checked for partition overlap; the generator groups all variations of a family under one synthetic student ID so calibration keeps them together too. Data marked synthetic cannot authorize a reviewed release.

See [`ANNOTATION_GUIDE.md`](ANNOTATION_GUIDE.md) before labeling. Supply a consented, de-identified, reviewed dataset locally; `data/` contents and model artifacts are ignored by Git.

```powershell
.\.venv\Scripts\python.exe train.py --data data/reviewed.csv --output artifacts/research
```

Training uses word unigrams/bigrams and character 3–5-grams, balanced Logistic Regression, and sigmoid probability calibration over three grouped folds. All TF-IDF fitting occurs inside training/calibration folds. Stopwords and negations are retained. Messages connected by the same student, conversation, normalized text, or template family form one indivisible group, including transitive connections across students. If splits are omitted, deterministic group splitting produces roughly 60% training, 20% validation, and 20% test groups; message counts can differ when groups vary in size. Every split and calibration fold must contain all four classes. Student and conversation overlap, ownership conflicts, conflicting annotations, normalized text overlap, and template-family overlap in supplied partitions are rejected. `partition_audit` and `calibration_audit` save aggregate counts and successful overlap checks without message text or student identifiers.

Outputs are `classifier.joblib`, `evaluation.json`, and `evaluation.md`. Evaluation includes the four-class confusion matrix, per-class precision/recall/F1 and error counts, macro F1, immediate and combined high-priority recall, critical false negatives, false positives, F2, grouped confidence intervals, low-confidence counts, Brier score, ten-bin calibration error and available subgroup reports. A research run has `release_approved: false` and no operational ML thresholds; the chat server deliberately ignores its scores. Low-confidence counts remain unavailable when no confidence threshold is configured.

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
