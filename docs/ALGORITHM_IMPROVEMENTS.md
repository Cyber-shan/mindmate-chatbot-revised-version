# Algorithm improvements - November 15, 2026

The updated prototype improves ordinary-versus-distress discrimination, calibration and recognition of personal emotional disclosures. It remains a lightweight local TF-IDF/Logistic Regression model. No larger language model, new cloud service or real student messages were used for training.

This is a synthetic engineering comparison, not a claim about clinical or real-student accuracy. The earlier study guide/PDF describes the previous model snapshot; this document records the subsequent changes.

## What changed

1. **Broader training coverage.** Generator `english-prototype-v3` adds 16 phrase families to each of the four training classes: ordinary conversation, gaming, news, technology, schoolwork, emotional distress, serious concerns and direct safety disclosures. Training grows from 1,280 to 1,920 generated messages, with 48 connected groups and 480 messages per class. Validation and test stay at 320 messages each; their message text, labels, student groups and conversation groups are unchanged and protected by fixed regression fingerprints.
2. **Training-only model selection.** Six configurations compare Logistic Regression C=1 or 8 with character-feature weights 0.35, 1 or 1.75. Word-feature weight remains 1. Each outer training fold is predicted by an ensemble calibrated on separate inner groups. Candidates must preserve the baseline configuration's training-CV Immediate and combined concern recall before selection by macro F1, then lower log loss. This relative engineering safeguard is not a clinically approved recall target. The selected configuration is C=8, character weight=1.75.
3. **Better personal-disclosure cues.** The app recognizes examples such as "I am anxious about my assignment" and "I can't relax". It no longer treats an academic keyword as a reason to ignore a separate personal disclosure. Denials, descriptions of a friend, sad movies and ordinary physical solitude do not automatically become personal distress. These remain bounded language heuristics.
4. **Reproducible comparison and provenance.** `compare_models.py` checks dataset fingerprints and identical holdout messages before comparing trusted artifacts. It records per-class outcomes, calibration, confusion matrices, category results and inference durations. Training records the selected parameters and dependency versions; startup invalidates cached artifacts when relevant inputs change.

The reviewed-data training path keeps its existing configuration and release gates. The new search applies to the explicit synthetic prototype. Independent safety rules and genuine conversation context still take precedence; synthetic model scores alone remain capped at Moderate priority in the chat application.

## Measured results

Baseline: `distress-tfidf-lr-v1-6e7964c1a992`.

Updated: `distress-tfidf-lr-v1-1dfb98092c81`.

| Classifier-only measurement | Before | After |
|---|---:|---:|
| Validation macro F1, same 320 messages | 78.03% | 84.82% |
| Existing synthetic test macro F1, same 320 messages | 91.95% | 89.95% |
| Existing synthetic test accuracy | 91.88% | 90.00% |
| Test Immediate recall | 98.75% | 100.00% |
| Test combined High/Immediate recall | 97.50% | 100.00% |
| Test combined false-positive rate | 6.25% | 6.25% |
| Test raw-probability ECE, lower is better | 0.3186 | 0.1844 |
| Test unscaled multiclass Brier score, lower is better | 0.2875 | 0.2003 |
| Separate 64-message challenge accuracy | 50/64 (78.13%) | 59/64 (92.19%) |
| Ordinary challenge questions classified Low | 3/16 | 13/16 |
| Moderate distress challenge labels correct | 15/16 | 14/16 |
| High concern challenge labels correct | 16/16 | 16/16 |
| Immediate challenge labels correct | 16/16 | 16/16 |

**Tradeoffs are retained in the report.** The original synthetic test macro F1 falls by about two percentage points. The updated model over-prioritizes ten High messages as Immediate instead of one; two Moderate messages become Low. Improved urgent recall and ordinary-topic coverage do not mean every category improved. The app's prototype guard still prevents synthetic-only crisis routing.

The held-out synthetic groups were already reused during engineering, so they are regression evidence rather than an untouched statistical test. The 64 developer-authored challenge messages are kept outside training and parameter selection; they include known reported errors and are not a random population sample. Do not combine these sets into a headline real-world accuracy number. Raw class calibration is evaluated separately from the threshold-adjusted class decisions.

The comparison uses the same frozen validation/test messages for both artifacts, verified by normalized text, labels and ownership groups. Grouped confidence intervals remain available in the machine-readable report; only eight connected groups per holdout make them unstable. Curated challenge cases have no population confidence interval.

## Resource use and startup

No GPU inference is needed for this classifier. The six-candidate search is sequential and limits numerical-library work to two CPU threads. Training happens when relevant sources or dependencies change; normal startup reuses the compatible artifact. Single-message classifier inference remained in the millisecond range locally. These in-process timings exclude HTTP, authentication, hosted storage and chatbot generation and do not establish a significant speed improvement.

The new artifact has been trained in `mindmate-algorithm/artifacts/prototype`. Restart the running app with Ctrl+C, then `npm.cmd run dev`, so its classifier service loads that artifact. A previously running Python process keeps its old model in memory until restarted. The launcher deliberately rejects a mismatched service rather than silently using it.

The previous trusted synthetic artifact and matching dataset are preserved locally in the ignored `mindmate-algorithm/artifacts/baseline-2026-11-15` directory for repeatable comparisons. No existing student account, conversation, detection or staff review was modified.

## Verification and reproduction

The checks passed: 338 Node tests, 41 Python tests, 34 live classifier/application context fixtures, lint, TypeScript and a production build. The HTTP verification starts an isolated temporary classifier service and does not require Docker, Ollama or student data.

From `mindmate-algorithm`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe compare_models.py --baseline artifacts/baseline-2026-11-15/classifier.joblib --candidate artifacts/prototype/classifier.joblib --baseline-data artifacts/baseline-2026-11-15/dataset.csv --candidate-data data/synthetic-english.csv --output benchmarks/improvement-2026-11-15.json
```

From `mindmate-chatbot`:

```powershell
npm.cmd run train:algorithm
npm.cmd run verify:algorithm
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Machine-readable evidence: [comparison](../mindmate-algorithm/benchmarks/improvement-2026-11-15.json). The model's ignored `evaluation.json` / `evaluation.md` also include current selection metadata, calibration, grouped split audits and class metrics.

Real-world accuracy improvements still require a permitted, representative, independently annotated dataset, including ordinary negatives, indirect disclosures and realistic local student language. The system retains `release_approved: false`; no software test changes that status.

Method references: [scikit-learn cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html), [probability calibration](https://scikit-learn.org/stable/modules/calibration.html) and [classification evaluation](https://scikit-learn.org/stable/modules/model_evaluation.html).
