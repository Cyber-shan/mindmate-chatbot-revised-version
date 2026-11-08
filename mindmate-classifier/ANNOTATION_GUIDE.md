# MindMate academic stress annotation guide

Policy version: **1.0.0**

Target: **The student expresses current stress connected to academic demands.**

This policy defines the intended labels for an English message classifier that
helps guidance counselors review student messages. A label describes what is
expressed in the message. It does not measure a student's overall stress, assign
severity, diagnose a condition, or determine whether support is needed.

## Annotation unit and permitted evidence

Annotate one student-authored English message using only the contents of its
`text` field. The student need not identify themselves as a student in the text.
Do not use model suggestions, student records, imagined circumstances, or
surrounding conversation that the classifier does not receive.

Understandable informal English, abbreviations, and spelling mistakes are in
scope. Do not judge English proficiency. Clearly non-English or mixed-language
messages requiring another language to understand the meaning are outside this
version's scope. Defer them for review rather than forcing a binary label.

If context is essential but missing, defer the message. A future classifier that
uses conversation history will need explicitly defined context inputs and
annotations based on those same inputs.

## The two labels

| Label ID | Display wording | Meaning |
| --- | --- | --- |
| `academic_stress` | Academic stress expressed | The student expresses their own current, ongoing, or recurring stress connected to academic demands. |
| `not_academic_stress` | Academic stress not expressed | This interpretable message does not express the target. It may still express other distress or describe someone who needs support. |

Never translate the negative label into "the student is okay," "no stress,"
"safe," or "no help needed." Model errors are possible for either label.

Use `academic_stress` only when all four conditions are supported:

1. **Own experience:** the stress belongs to the student writing the message.
2. **Stress or strain:** the message expresses worry, pressure, tension, fear,
   overwhelm, frustration, difficulty coping, or a clearly connected stress
   response. The exact word "stress" is not required.
3. **Current experience:** the stress is present, ongoing, or an active recurring
   pattern. Current worry about a future requirement counts.
4. **Academic connection:** the stress is clearly linked to the student's academic
   demands in the same message. A school-related word alone is insufficient.

Any expressed level qualifies, including mild nervousness. Do not require a
symptom, a particular intensity, or a diagnosis.

## Academic demands in scope

Each example below is positive because it expresses the student's current strain,
not merely because it names an academic topic.

| Demand | Positive example |
| --- | --- |
| Exams, quizzes, and assessed practical work | "I'm nervous about tomorrow's chemistry exam." |
| Workload, assignments, projects, research, or thesis work | "These assignments are more than I can handle." |
| Grades, results, GPA, or passing requirements | "Waiting for my final grades is making me anxious." |
| Deadlines, submission dates, and competing requirements | "I'm overwhelmed trying to meet three assignment deadlines tonight." |
| Presentations, defenses, recitations, or assessed speaking | "I keep panicking about presenting my class project to the panel." |
| Academic expectations from self, family, teachers, or scholarships | "I'm scared my grades won't meet my scholarship requirement." |

Academic expectations include pressure to maintain performance, fear of
disappointing family because of grades, and worry about completing requirements.
General family conflict, job searches, finances, tuition costs, and school social
conflict are not automatically academic demands. Count them only when the message
also establishes current strain connected to an academic demand, for example:
"Working to pay tuition leaves me overwhelmed trying to finish my assignments."

## Boundary rules and examples

| Situation | Message | Decision and reason |
| --- | --- | --- |
| School mentioned without strain | "I have an exam tomorrow." | `not_academic_stress`: an academic fact alone is insufficient. |
| Heavy workload without expressed strain | "I have five assignments this week." | `not_academic_stress`: quantity alone does not establish stress. |
| Positive academic experience | "I enjoy studying for my exams." | `not_academic_stress`: enjoyment is not an expression of strain. |
| Direct current stress | "I am stressed about my exams." | `academic_stress`: own, current stress with an academic link. |
| Indirect current stress | "I can't sleep because I keep worrying about my grades." | `academic_stress`: the stress response is linked to grades. |
| Effort without stress evidence | "I stayed up late studying." | `not_academic_stress`: effort or reduced sleep alone is insufficient. |
| Informal English | "im so stresed abt my assigments" | `academic_stress`: the intended self-report is understandable. |
| Unrelated distress | "My dog died and I feel devastated." | `not_academic_stress`: distress is expressed without an academic link. |
| Distress with no academic cause given | "I'm anxious and can't sleep." | `not_academic_stress`: do not invent an academic cause. |
| School and unrelated stress in one message | "School is going well, but I'm stressed about rent." | `not_academic_stress`: the distress is attributed to rent. |
| Future event, present worry | "I'm afraid I'll fail next week's exam." | `academic_stress`: the fear exists now. |
| Hypothetical experience only | "If I had an exam, I would probably be stressed." | `not_academic_stress`: no actual current stress is expressed. |
| Ongoing recent experience | "I've been overwhelmed by coursework all week." | `academic_stress`: the experience is ongoing. |
| Active recurring pattern | "I get anxious before every exam." | `academic_stress`: a continuing pattern is expressed. |
| Clearly historical experience | "Back in high school, exams used to stress me out." | `not_academic_stress`: no present academic stress is expressed. |
| Recent past with unclear continuation | "I was overwhelmed by my assignments earlier." | Defer: review whether the text establishes current experience; do not assume it persists. |
| Resolved past stress | "I used to panic before exams, but now I feel calm and prepared." | `not_academic_stress`: the same stress is explicitly resolved. |
| One stressor resolved, another current | "My exam worries are gone, but my thesis deadline is overwhelming me." | `academic_stress`: another academic stressor remains active. |
| Direct negation | "I am not stressed about my exams." | `not_academic_stress`: the stress is denied. |
| Negation of coping | "I'm not coping with my assignments." | `academic_stress`: the student denies coping, not stress. |
| Mixed emotions | "I'm excited about presenting my class project, but I'm also anxious I'll forget everything." | `academic_stress`: excitement does not cancel current worry. |
| Coping while stress persists | "Taking breaks helps, but I still feel overwhelmed by my thesis." | `academic_stress`: the strain remains. |
| Another person's feelings | "My friend is overwhelmed by her assignments, but I'm doing fine." | `not_academic_stress`: the reported stress belongs to the friend. |
| Shared feelings including the student | "My classmates and I are anxious about our final exam." | `academic_stress`: the writer explicitly includes themselves. |
| Quoted third-person report | "My classmate said, 'I am terrified of finals.'" | `not_academic_stress`: the quoted speaker is someone else. |
| Quoted educational content | "Our essay includes the sentence 'I am stressed about exams.'" | `not_academic_stress`: the quotation is example content, not a self-report. |
| Quoted self-report with present confirmation | "I told my counselor, 'I'm stressed about exams,' and I still am." | `academic_stress`: attribution and current experience are explicit. |
| Quote causing the student's own stress | "My teacher said 'you will fail,' and now I can't stop worrying about my grades." | `academic_stress`: the student's current response is expressed. |
| Quotation with unclear attribution | `"I am stressed about exams."` | Defer if the quotation's speaker or purpose cannot be determined; quotation marks alone do not establish attribution. |
| Informational question | "What is exam anxiety?" | `not_academic_stress`: no personal experience is asserted. |
| Personal coping question | "How can I manage my exam anxiety?" | `academic_stress`: the question expresses the student's own academic stress. |
| General advice request | "How can students manage exam stress?" | `not_academic_stress`: do not assume the question describes the writer. |
| Diagnosis mentioned alone | "I have an anxiety disorder." | `not_academic_stress`: a diagnosis alone does not establish current academic stress. |
| Short reply requiring missing context | "Yes, every night." | Defer: the referent and academic connection are unavailable. |

Interpret the whole message. Negation applies to the statement it modifies;
neither the presence of "not" nor the final sentence determines the label alone.
Quoted words can support a positive label only when the message establishes the
student's own current academic strain. Do not infer stress from grades, workload,
sleep duration, humor, or emoji alone. Defer ambiguous sarcasm or unclear meaning
instead of guessing.

## Review dispositions outside the model labels

Deferral is a human annotation workflow state, **not a third model class**. Use
it for genuinely unclear attribution or timing, missing essential context,
unclear meaning, or unsupported language. Do not defer an otherwise clear
negative simply because the student might have unexpressed academic stress.

Use the blind packets produced by `review_dataset.py`. Set `review_status` to
`deferred`, leave `reviewed_label` blank, and record a `deferral_reason`:
`needs_context`, `unclear_attribution`, `unclear_timing`, `unclear_meaning`, or
`unsupported_language`. Add an `evidence_note` explaining the missing evidence.
Use `labeled` plus a binary `reviewed_label` for a completed interpretable item.
A blank `review_status` means unfinished work. Deferral reasons are not accepted
values in the training `label` column.

The old `reports/sad_predictions_review.csv` exposes model predictions beside
review fields. Keep it out of independent review, along with the original
training labels and all saved prediction reports. Its predictions are unverified
and must never supply a missing review decision.

## Annotation and adjudication workflow

1. Confirm that the message is in scope and interpretable using its supplied text.
2. Independently check own experience, strain, current status, and academic link.
   Write a brief evidence note; do not copy the model's suggested label.
3. Assign one of the two label IDs when the decision is clear. Otherwise leave the
   reviewed label blank and log the deferral reason.
4. Have a second reviewer independently label an agreed subset, including boundary
   cases. Keep model suggestions hidden during independent labeling.
5. Resolve disagreements with an adjudicator, preferably a guidance counselor,
   using this policy and the same evidence available to the classifier. If the
   text still cannot support a decision, keep the item deferred.
6. Record policy version, reviewer identity, and adjudication notes in the review
   log. Export only completed human-reviewed binary labels, with disagreements
   adjudicated, to training data; map the final `reviewed_label` to `label`, never
   the unverified `predicted_label`.

The current review design uses **one human reviewer on all records and one AI
reviewer on a subset**. The AI reviewer receives only its own shuffled packet and
this guide. It cannot see existing labels, model output, or the human review.
The human receives only the human packet and cannot see AI decisions until both
reviews have been submitted. The coordinator must keep these folders separate;
local files do not enforce access control. Submit the two packets before running
`compare`. Submitted copies are preserved and later edits invalidate export.

The default subset includes 100 messages from each source: up to 30 deliberately
chosen academic boundary candidates, then a seeded random sample of the remaining
records. Candidate selection uses text only, never labels or predictions. The
selection tags and source identity stay in the coordinator manifest. Agreement
is reported before adjudication, separately for these selection groups. This
boundary-enriched sample is not a representative estimate of corpus agreement.
Human/AI agreement is not evidence of agreement between two human annotators.

A human adjudicator (preferably a guidance counselor) resolves every difference,
including label-versus-deferral and differing deferral reasons, with a policy
explanation. The human reviewer may act as adjudicator after the independent
round ends; record that identity honestly. Do not convert unresolved differences
into majority votes. If the text remains ambiguous, adjudicate to a deferral.
Final export waits for all assigned reviews and all disagreements to be completed.
It excludes deferrals and records each source record, policy, reviewer identity,
reviewer type, evidence, and adjudication. AI-only decisions are not training labels.

Keep the training interface as `text,label`, with optional `group_id` as supported
by `train.py`. Deferrals must be resolved or excluded before training. Academic
topics in this guide are annotation aids, not extra model labels.

## Limits and policy changes

Neither label determines severity, diagnosis, urgency, overall wellbeing, or a
counselor's decision. Any other review or support workflow needs its own policy;
this binary label must not be used to rule out a student's need for help.

Existing data, model suggestions, and saved model artifacts are not automatically
compliant with this guide. Review annotations against this version before
retraining or claiming performance for this target. Future training metadata
records the intended task definition; it does not certify annotation compliance.
Do not rewrite old model metadata to imply that an earlier model was trained
under a policy it did not use.

When a rule changes, increment the policy version in this guide and
`task_definition.py`, document the change, and review affected annotations.
