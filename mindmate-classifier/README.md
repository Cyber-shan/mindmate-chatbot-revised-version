# MindMate classifier

Target: **The student expresses current stress connected to academic demands.**

The classifier is an experimental English message classifier intended to help
guidance counselors review expressions of academic stress. It predicts one of
two labels:

| Label | Display wording |
| --- | --- |
| `academic_stress` | Academic stress expressed |
| `not_academic_stress` | Academic stress not expressed |

A negative prediction does not mean the student is okay or does not need help.
Neither label assesses severity or diagnosis.

Read [ANNOTATION_GUIDE.md](ANNOTATION_GUIDE.md) before labeling data. It defines
the academic topics, current experience, negation, quotations, third-person
reports, resolved past stress, and deferred review cases. The same intended task
wording is shared by the scripts through `task_definition.py`.

## Review before training

The current source files contain 1,000 labeled training messages and 498 imported
messages. Existing labels and saved predictions are unverified against the guide.
The import contains work, family, financial, and other stressors. Its filename is
not evidence of academic stress, student authorship, or English suitability.
Use only each message's text. Clear unrelated distress is negative for this task;
defer genuinely unclear meaning or essential missing context.

The requested design uses one human reviewer for every record and one independent
AI reviewer for a 200-record subset (100 per source). Each source contributes up
to 30 boundary candidates and a random sample of the remaining records, using
seed 42. Selection uses text only. Both packets have different shuffled orders,
opaque stable item IDs, blank decisions, and no existing labels or model output.
The IDs identify records within a frozen source snapshot. Source hashes prevent
silently reusing reviews after source edits.

Run these commands inside `mindmate-classifier`, using its virtual environment:

```powershell
.\.venv\Scripts\python.exe review_dataset.py prepare
# Equivalent: .\.venv\Scripts\python.exe label_dataset.py
.\.venv\Scripts\python.exe review_dataset.py status
```

Preparation refuses to overwrite an existing batch. The default batch is
`reports/annotation_review`. Use `--batch reports/another_round` for a new round.
`--per-source` and `--boundary-per-source` customize subset sizes during preparation.

1. Give the human **only** `reports/annotation_review/reviewer_a/`, including its
   guide and instructions. The human annotates all 1,498 records. Do not share
   source CSVs, old prediction reports, the coordinator folder, or the AI packet.
2. Give the AI **only** `reviewer_b/`. It annotates its 200 assigned records using
   that guide. Identify the actual AI in `reviewer_id`. The AI must not inspect
   source labels, other reviews, or model suggestions. The coordinator retains
   its completed packet until the human submits independent decisions.
3. Fill every assigned record with `labeled` or `deferred`, a valid decision,
   evidence, and a consistent reviewer identity. Keep text and IDs unchanged.
   See the packet instructions for the fields and allowed values.
4. Once both packets are complete, compare them:

   ```powershell
   .\.venv\Scripts\python.exe review_dataset.py compare
   ```

   This preserves submitted copies and writes `coordinator/comparison/agreement.json`
   and `adjudication.csv`. Agreement covers the independently reviewed subset,
   before adjudication. Binary kappa excludes pairs with deferrals; counts and a
   confusion matrix are included. Undefined kappa is `null`. These are human/AI
   agreement statistics, not inter-human reliability or classifier accuracy.
5. A human adjudicator fills every disagreement's final status, label or deferral
   reason, identity, and policy-based explanation in `adjudication.csv`. Prefer a
   guidance counselor. The human reviewer can adjudicate after submitting their
   independent packet. If essential evidence is still missing, defer the item.
6. Export and then train:

   ```powershell
   .\.venv\Scripts\python.exe review_dataset.py finalize
   .\.venv\Scripts\python.exe train.py
   # For a nondefault batch: train.py --review-batch reports/another_round
   ```

Finalization requires every human review, every AI subset review, and every
adjudication. It exports `export/messages_reviewed.csv` with `text,label` (and
optional `group_id`), `review_log.csv`, and a matching `review_receipt.json`.
Deferrals are excluded. Matching duplicates are collapsed; conflicting labels
or groups stop export. Existing source data, predictions, models, and reports
are preserved. Review folders stay under the existing ignored `reports/`
directory because they contain message text.

`train.py` requires this completed export and validates the review receipt and
source/policy hashes before fitting anything. It never falls back to old labels
or AI suggestions. A receipt records submitted review provenance; it does not
authenticate reviewer identity or establish annotation accuracy. Keep packets
separate using actual file sharing permissions. The CLI cannot prevent someone
with access to the whole repository from opening other files.

## Model use after review

Training fits TF-IDF and logistic regression with separate training, validation,
and final test sets. Use verified `group_id` values for related messages where
known. Do not infer independence or provenance from a dataset's name. Label
review alone does not establish that an imported dataset represents students.

`python train.py --test` evaluates the reserved final test set after model choices
are fixed. `python predict.py` runs the saved practice model. Old artifacts retain
their original metadata; this workflow does not retroactively validate them.

Run workflow regression checks without fitting a model:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
