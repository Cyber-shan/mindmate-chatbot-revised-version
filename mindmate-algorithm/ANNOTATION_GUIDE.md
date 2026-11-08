# Support-priority annotation guide (draft)

These labels describe support needs, not diagnoses. Have qualified reviewers approve this rubric, the runtime rules and response templates before a student-facing release.

| Label | Annotation focus | Intended application action |
|---|---|---|
| LOW | Ordinary, transient emotional concerns without a stronger safety signal | Supportive conversation |
| MODERATE | Persistent or significant stress, sadness, anxiety or difficulty managing daily tasks | Structured support and human-support suggestions |
| HIGH_CONCERN | Serious emotional difficulty, severe hopelessness, passive or ambiguous safety language, or relevant historical/third-party concerns | Safety clarification and human-review option |
| IMMEDIATE_SAFETY | Possible current personal self-harm/suicide danger, current action or unsafe reply to an active safety question | Dedicated safety response and urgent review request |

Preserve the original message. Label personal current intent differently from explicit denial, academic discussion, quotations, third-person disclosures and past experiences. A denial does not cancel a separate disclosure in another clause. Record uncertainty for adjudication instead of forcing an unsupported confident label.

Use two independent annotators with access to permitted conversation context. Record disagreements, agreement statistics and adjudication separately from the training CSV. Have a qualified reviewer adjudicate safety-sensitive disagreements. Do not derive ground truth from model predictions or keyword matches.

Include ordinary academic stress and difficult negative examples: negation, quotations, homework, jokes, historical experiences, concern for someone else, misspellings, emoji, slang, code-switching, and indirect distress. Include realistic local student language. Evaluate short safety answers in multi-turn tests: the text-only ML service cannot infer what "not really" answers; the application policy uses conversation state for that.

Use stable pseudonymous student and conversation identifiers. A student, including all their conversations, belongs to exactly one train/validation/test partition. Remove identifying details under the institution's consent and privacy process. Never commit actual messages, identifiers, datasets or trained vocabulary to the repository.

Have responsible clinicians/researchers choose recall targets, acceptable false-negative rates, calibration limits, confidence thresholds, minimum subgroup sample sizes, required cohorts and operational escalation procedures. The review-config template intentionally leaves these values blank.
