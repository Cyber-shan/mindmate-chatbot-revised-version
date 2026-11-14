# MindMate: algorithm and technology study report

Prepared from the project source and local evaluation artifacts on November 15, 2026 (Asia/Manila).

Snapshot note: this guide and its PDF describe the model before the subsequent algorithm upgrade. See [Algorithm improvements](ALGORITHM_IMPROVEMENTS.md) for the current training coverage, selected parameters, measured gains and tradeoffs.

This guide explains the implemented system, including the corrected chat routing. It separates measured results, engineering decisions and future work. Read chapters 1-4 first, then work through the numerical examples before studying evaluation and deployment.

## 1. The explanation to remember

MindMate combines two different machine-learning tasks. A small supervised classifier estimates support priority from text. A pretrained language model generates conversational replies. Application rules and conversation state decide when a fixed safety response takes precedence. Supabase stores accounts, conversations and review records; staff review remains a separate human workflow.

The classifier uses word and character TF-IDF features, Logistic Regression and sigmoid probability calibration. It is currently trained on generated English examples. The generative model is Qwen3 4B Instruct running through Ollama on this laptop. These are separate models with separate training histories.

An accurate defense statement is: "Our prototype combines a calibrated lexical classifier with contextual safety rules and a local conversational model. The categories recommend human-review priority; they do not diagnose a condition. Our current evaluation is synthetic engineering evidence, so it does not establish clinical or real-student accuracy."

### What to study first

1. Classification versus generation: explain why TF-IDF does not write a reply.
2. Preprocessing, word n-grams, character n-grams and sparse vectors.
3. TF-IDF, Logistic Regression, calibration and thresholds.
4. Grouped splitting, leakage, precision, recall, F1 and calibration error.
5. Safety rules, conversation context and false-positive routing.
6. Next.js request handling, Ollama streaming, Supabase access control and staff review.

### Four components with different jobs

| Component | Input | Output | Where implemented |
|---|---|---|---|
| Lexical classifier | One message | Four class scores | Python / scikit-learn |
| Safety and routing policy | Message, history, prior state, optional scores | Priority and response requirements | TypeScript support library |
| Conversational model | System instructions and recent messages | Generated response tokens | Ollama / Qwen |
| Review workflow | Saved detections and staff actions | Assignments, status, notes and audit history | Next.js / Supabase |

## 2. What the four labels mean

These labels represent recommended attention based on the available information. They are not diagnoses or a clinical severity scale. Preserve the internal keys because stored events and classifier artifacts depend on them.

| Display label | Internal key | Intended meaning |
|---|---|---|
| Low priority | LOW | Routine response; no direct counselor attention indicated by the message |
| Moderate priority | MODERATE | Counselor attention recommended, without urgent timing |
| High priority | HIGH_CONCERN | Counselor attention recommended as soon as possible |
| Immediate attention | IMMEDIATE_SAFETY | Potential safety-related content requiring priority human review |

Priority order in code is LOW < MODERATE < HIGH_CONCERN < IMMEDIATE_SAFETY. The `higher` helper selects the more urgent value. Low priority does not prove a person is safe, and a high-priority result does not establish a diagnosis.

There are three related but different values. A detection priority belongs to one saved message. Conversation safety state helps interpret later turns. Account priority in the staff dashboard is the highest unresolved detection across that account's conversations. A newer low-priority message therefore cannot clear an older unresolved immediate-priority detection.

Staff review status answers a different question: what action has someone recorded? Needs review, Assigned, Contact attempted and Resolved describe work progress. False positive records an erroneous detection. A staff note or status update is auditable, and an assigned case does not mean contact succeeded. Resolving an event does not automatically erase conversation safety context.

Read `mindmate-algorithm/ANNOTATION_GUIDE.md` and `mindmate-chatbot/lib/support/types.ts` for the rubric and actual keys.

## 3. Follow one message through the application

The normal signed-in path is:

```text
Student sends message
  -> save canonical user message in hosted Supabase
  -> POST /api/chat with conversation/message identifiers
  -> verify session and load ownership-checked history
  -> independent rules and conversation-state assessment
  -> eligible optional classifier request
  -> combine evidence under the application policy
       -> High / Immediate: fixed safety response
       -> Low / Moderate: Ollama generates an appropriate reply
  -> record private decision metadata
  -> stream response to browser
  -> save completed assistant reply
```

The server does not trust a submitted conversation identifier as proof of ownership. It authenticates the student and loads canonical messages through an ownership-filtered query and row-level security. Direct requests without conversation identifiers also exist for tests and benchmarks; those requests do not create durable review events.

Rules run before the optional Python call. An immediate safety signal bypasses the classifier. A classifier outage falls back to rules, while serious rule-based responses do not depend on Ollama being available. Normal audit writing and generation startup overlap to avoid adding their entire durations sequentially.

The browser receives newline-delimited JSON (NDJSON), including generated content events and a final completion event. The restricted support event contains response requirements and review availability, not internal probabilities or matched rules. The student-facing support banner was removed; private decisions and staff reporting remain.

The response generator receives a smaller recent-history budget than the safety policy. This reduces inference work while preserving more history for safety interpretation. Exact budgets appear in chapter 13.

## 4. Text preprocessing and n-grams

The original message remains unchanged in storage. The Python feature pipeline normalizes a copy using Unicode NFKC, removes zero-width characters, converts curly apostrophes, collapses whitespace, trims and lowercases. This makes cosmetic differences less likely to create separate features.

There is no stemming, lemmatization or blanket stopword removal in this pipeline. Negation words matter: removing "not" could make two opposite statements look similar. Normalizing spelling and spacing still does not solve meaning, sarcasm, attribution or time references.

A word unigram is one token, such as `feel`. A word bigram is a pair, such as `feel stressed`. For "I feel stressed today", the default word token pattern generally omits the one-letter `I`, leaving words such as `feel`, `stressed` and `today`, plus adjacent pairs. This example is illustrative; the learned vocabulary depends on the fit fold.

Character n-grams break words into smaller overlapping fragments. The `char_wb` analyzer creates fragments inside word boundaries, including boundary padding. For `sad`, character trigrams can include ` sa`, `sad` and `ad `. Three-to-five-character features can share evidence across some spelling variants. They do not reliably understand every misspelling or unfamiliar language.

| Setting | Word branch | Character branch |
|---|---|---|
| Analyzer | Default word analyzer | char_wb |
| n-gram range | 1-2 words | 3-5 characters |
| min_df | 2 documents | 2 documents |
| max_df | 0.98 | Default 1.0 |
| sublinear_tf | True | True |
| Normalization | L2, separately per branch | L2, separately per branch |

`min_df=2` removes features found in fewer than two fit documents. `max_df=0.98` removes word features occurring in more than 98% of fit documents. A sparse matrix stores mainly nonzero entries, making a large lexical vocabulary practical. FeatureUnion concatenates the two branches; the project has no extra global L2 normalization after concatenation.

Implementation: `mindmate-algorithm/distress/features.py`. Defaults and analyzer behavior: [TfidfVectorizer documentation](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.TfidfVectorizer.html).

## 5. TF-IDF with a worked example

TF-IDF means term frequency multiplied by inverse document frequency. It produces numerical features describing which terms distinguish a document from the fit corpus. It is a representation method; the downstream classifier learns how those features relate to labels.

With this project's sublinear term frequency, a present term has TF = 1 + ln(count). Default smoothed IDF is IDF = ln((1 + N) / (1 + DF)) + 1. N is the number of fit documents; DF is the number of fit documents containing that feature. Raw weight = TF * IDF. L2 normalization divides a branch vector by the square root of the sum of its squared weights.

### Illustrative miniature corpus

Ignore bigrams, character features and vocabulary pruning for this arithmetic example:

```text
D1: study study calm
D2: study stress
D3: stress sleep
```

For `study`, N=3 and DF=2, so IDF = ln(4/3)+1 = 1.2877. In D1 its count is 2, so TF = 1+ln(2) = 1.6931. Its raw weight is about 2.1802. For `calm`, DF=1 and count=1, producing IDF = ln(4/2)+1 = 1.6931 and raw weight 1.6931.

The length of the D1 vector over these two nonzero terms is sqrt(2.1802^2 + 1.6931^2), about 2.7604. The normalized weights are about 0.7898 for `study` and 0.6134 for `calm`. Repetition increases weight with diminishing returns rather than linearly.

The toy `calm` feature would be removed by the real pipeline's `min_df=2`; it is included here only to make the arithmetic easy to follow. Actual fitted vectors include eligible word and character n-grams. The transformation vocabulary and IDF values come from fit data, then remain fixed during validation, test and inference. Unknown features have no learned column.

### What TF-IDF cannot tell you

A high feature weight is not the probability of distress. Lexical similarity is not full semantic understanding. A phrase can resemble distress examples while being an ordinary question, quotation or news topic. This is one reason the application needs contextual rules and why synthetic classifier scores cannot independently trigger the prototype's crisis response.

## 6. Logistic Regression: the classifier

Despite its name, Logistic Regression is used here for classification. Each class has learned coefficients over the feature vector and an intercept. A linear score has the form z_k = w_k dot x + b_k. In the multinomial formulation used by the ordinary lbfgs setup, softmax converts class scores to base probabilities: p_k = exp(z_k) / sum_j exp(z_j).

Training adjusts weights to reduce weighted classification loss while regularization discourages overly large coefficients. A positive coefficient means that feature can increase a class score relative to the other evidence; it is not an independent causal explanation. The final served probabilities are subsequently calibrated, so they are not simply these base softmax scores.

| Configuration | Meaning |
|---|---|
| max_iter=3000 | Solver iteration ceiling; not 3,000 training examples or guaranteed epochs |
| class_weight=balanced | Weight each class inversely to its observed training frequency |
| random_state=42 | Reproducibility parameter; not a guarantee across every dependency/platform |
| Default lbfgs / C=1 | Numerical optimizer and inverse regularization strength in the installed setup |
| Default L2 regularization | Penalizes large coefficients; does not select a few features like L1 |

For balanced weighting, a class weight is conceptually N / (K * N_class). The prototype has balanced classes, so this setting provides little class-frequency correction in that dataset. Larger C means weaker regularization; smaller C means stronger regularization. Those values would need validation rather than being changed because a model seems more confident.

Reasons this model fits the prototype include inexpensive inference, compatibility with sparse TF-IDF, reproducible training and inspectable features. Its limits include weak handling of unseen paraphrases, discourse, indirect disclosures, sarcasm and language shifts. Adding character features helps lexical robustness, not general reasoning.

Source: `distress/features.py`; API behavior: [LogisticRegression documentation](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html).

## 7. Calibration and confidence

A probability is calibrated when predictions around a particular value correspond to roughly that outcome frequency on suitable data. A score of 0.8 should not be presented as "80% clinical certainty". Dataset shift, synthetic labels and context limitations can invalidate that interpretation.

The project wraps its pipeline in `CalibratedClassifierCV(method="sigmoid", cv=folds)`. It constructs three GroupKFold splits from the training partition. Each fold fits its feature extraction and classifier on fit groups, then learns a sigmoid mapping using separate calibration groups. With the ordinary ensemble configuration, fitted model/calibrator pairs contribute averaged probabilities.

For multiclass sigmoid calibration, per-class adjustments are normalized to produce a distribution. Calibration learns a mapping from model evidence to probabilities; it does not add clinical understanding. The sigmoid mapping and the decision threshold solve different problems. Calibration adjusts scores; thresholds decide which action category to select from those scores.

The code explicitly restores policy class order after prediction because scikit-learn's class ordering is alphabetical. A four-element array cannot be interpreted safely without checking this mapping. Application order is LOW, MODERATE, HIGH_CONCERN, IMMEDIATE_SAFETY.

`confidence` in the app is the maximum raw class probability. It is not the probability that the final rule- or threshold-adjusted decision is correct. Rules-only decisions have no model confidence, and the UI must show unavailable rather than inventing a percentage.

Calibration quality is measured separately from classification success in chapter 11. A model may classify many examples correctly while providing poor probability estimates.

Source: `train.py`, `distress/model.py`; method details: [CalibratedClassifierCV documentation](https://scikit-learn.org/stable/modules/generated/sklearn.calibration.CalibratedClassifierCV.html).

## 8. Dataset, splits and leakage prevention

The current generator is `english-prototype-v2`, seed 42. It creates 1,920 synthetic English messages: 1,280 train, 320 validation and 320 test. Each partition is balanced across four labels. These are generated examples with pseudonymous grouping identifiers, not observations from 1,920 real students.

| Partition | Messages | Per class | Independent connected groups |
|---|---:|---:|---:|
| Train | 1280 | 320 | 32 |
| Validation | 320 | 80 | 8 |
| Synthetic regression test | 320 | 80 | 8 |

The explicit synthetic split is approximately 66.7% / 16.7% / 16.7%. Do not describe it as the generic splitter's 60/20/20 target. When explicit partition labels are absent, the dataset code uses grouped holdout splitting: 20% test groups, then 25% of remaining groups for validation. Group sizes can make actual message proportions differ.

The synthetic generator uses core phrases plus neutral-context variations. Multiple variations from one core template are not independent evidence of generalization. Pseudonymous student identifiers are shared across connected examples to preserve all classes within the grouping design.

Leakage occurs when training gains information that should belong only to evaluation. Splitting individual messages at random can put one student's closely related conversations, duplicate texts or template variants on both sides. A model may then appear strong by recognizing familiar patterns.

The project uses connected components: connect rows sharing a student, conversation, normalized text or template family; keep each connected component in one partition. Connections are transitive. If A shares a student with B and B shares a template with C, all three must stay together. The same principle separates calibration fit and calibration groups.

Required CSV fields are `text`, `label`, `student_id` and `conversation_id`; supplied split and provenance fields add checks. The implementation validates labels, ownership consistency, lengths and partition coverage. Every partition and each calibration fold must include all four labels.

Real data collection is future work. The annotation guide calls for two independent annotators, disagreement recording, qualified adjudication and privacy procedures. Model predictions must not become their own ground-truth labels.

## 9. Thresholds and the corrected hybrid policy

The saved classifier thresholds are immediate=0.5794377887, combined high=0.5999594964 and confidence=0.4. These are demonstration settings chosen from validation, not clinically approved operating limits. The high threshold applies to P(HIGH_CONCERN)+P(IMMEDIATE_SAFETY).

Classifier-only thresholding starts from the top-scoring class, raises to High when combined concern passes its threshold, raises to Immediate when the immediate threshold passes, and applies a Moderate floor when top confidence is below 0.4. Failing a threshold does not necessarily force Low: the initial argmax can itself be High or Immediate.

Threshold selection tests candidate validation scores and chooses the best precision meeting the target recall, breaking ties toward the higher threshold. The prototype targets 95% immediate recall, 95% combined recall and at least 0.75 macro F1 on validation. Test data is not used to select these demonstration thresholds.

### Current application behavior

Independent rules and genuine conversation safety state establish priority floors. The optional model cannot lower those floors. For prototype scores specifically, ordinary requests without independent concern or a personal-distress cue skip the classifier. Accepted prototype evidence is capped at Moderate: synthetic scores alone cannot initiate a High/Immediate crisis workflow. Reviewed-model acceptance remains a separate path.

This distinction is essential: the saved classifier evaluation uses its original threshold policy. It does not measure the newly constrained application policy. Improving routing does not magically change the stored classifier confusion matrix.

### Why the screenshot produced inappropriate replies

The actual classifier gave the gaming question about 0.629 HIGH_CONCERN probability, despite its ordinary intent. The ambiguous news-crisis question had Immediate as its largest score, about 0.366. Lexical over-prioritization selected fixed response templates rather than letting Ollama answer the question.

An inappropriate assistant safety question could then contaminate later conversation interpretation. The correction requires independent evidence before that assistant question establishes danger in a complete neutral history. Saved prototype-only escalation state can be ignored during replay only when a complete canonical history contains no independent High/Immediate user signal. Genuine signals and truncated histories retain prior state. Historical audit events are preserved for staff review.

Sources: `lib/support/intent.ts`, `assess.ts`, `policy.ts`, `safety.ts` and `store.ts`.

## 10. Context and deterministic safety responses

The safety engine handles selected direct disclosures and linguistic contexts, including scoped negation, academic quotations, historical statements and third-party concerns. Its normalization also recognizes selected informal spellings. These are explicit engineering heuristics, not unrestricted language understanding.

Consider the ordinary word "crisis". In a news question, it does not automatically mean the speaker is personally unsafe. Likewise, an educational request about depression should not automatically be treated as a personal disclosure. A personal statement and a quotation can occur in the same message, so a broad academic keyword must not suppress a separate actual concern.

Short replies can require history. "Not really" after a genuine safety question has a different meaning from the same words in a conversation about gaming. The Python classifier receives only one message, so the application handles this conversational meaning. A configured reviewed classifier can contribute evidence, but it still does not read the entire conversation through this endpoint.

Conversation state tracks highest observed level, prior high/immediate concern and whether a safety question is active. An explicit safe answer may close the active question while preserving a Moderate support floor. Uncertainty does not necessarily resolve it. An unrelated topic alone cannot erase an unresolved genuine safety question.

High/Immediate decisions use fixed responses. Ordinary and Moderate turns use the conversational model with context-sensitive instructions. This keeps serious responses available if the generative service fails and prevents the language model from overruling application decisions. It also means changing the Ollama model alone would not fix a policy false positive.

The rules remain marked as draft and requiring qualified review. Passing software regressions demonstrates expected behavior for those fixtures, not a general guarantee of safe interpretation.

## 11. Evaluation: calculate and interpret the metrics

For one class treated as positive: TP is a correct positive, FP is another class predicted as positive, FN is a missed actual positive, and TN is neither actual nor predicted positive.

```text
Precision = TP / (TP + FP)
Recall = TP / (TP + FN)
F1 = 2 * precision * recall / (precision + recall)
F2 = 5 * precision * recall / (4 * precision + recall)
Accuracy = all correct predictions / all examples
Macro F1 = mean of the four per-class F1 scores
```

Precision asks how many flagged examples belonged to that category. Recall asks how many actual category examples were found. F2 weights recall more heavily than precision. Macro F1 gives each class equal weight; accuracy can hide poor performance on rare but important classes.

### Saved synthetic test results

Model: `distress-tfidf-lr-v1-6e7964c1a992`. These results cover 320 generated examples and only eight independent connected groups. The synthetic holdout was reused during engineering; it is not an untouched population test.

| Metric | Validation | Synthetic test |
|---|---:|---:|
| Accuracy, informational | 79.06% | 91.88% |
| Macro F1 | 78.03% | 91.95% |
| Immediate recall | 100.00% | 98.75% |
| Combined High/Immediate recall | 100.00% | 97.50% |
| Combined false-positive rate | 16.88% | 6.25% |
| Incorrect predictions | 67 | 26 |
| Under / over-prioritized | 10 / 57 | 5 / 21 |
| Low-confidence examples | 32 | 25 |
| Raw-probability ECE, 10 bins | 0.1924 | 0.3186 |

### Test confusion matrix

Rows are actual labels; columns are predicted labels. L=Low, M=Moderate, H=High, I=Immediate. Each row has 80 examples.

| Actual / predicted | L | M | H | I |
|---|---:|---:|---:|---:|
| L | 70 | 10 | 0 | 0 |
| M | 0 | 70 | 10 | 0 |
| H | 0 | 4 | 75 | 1 |
| I | 0 | 0 | 1 | 79 |

The diagonal totals 294 correct examples; 294/320=91.875%. Immediate recall is 79/80=98.75%. Combined concern recall is 156/160=97.5%; the one Immediate-to-High error still counts as a combined positive. There are ten lower-priority examples predicted High, so combined FPR=10/160=6.25%. FPR and one-minus-precision have different denominators.

### Per-class results

| Class | Precision | Recall | F1 | TP / FP / FN |
|---|---:|---:|---:|---|
| Low | 100.00% | 87.50% | 93.33% | 70 / 0 / 10 |
| Moderate | 83.33% | 87.50% | 85.37% | 70 / 14 / 10 |
| High | 87.21% | 93.75% | 90.36% | 75 / 11 / 5 |
| Immediate | 98.75% | 98.75% | 98.75% | 79 / 1 / 1 |

### Probability quality and uncertainty

Expected calibration error (ECE) bins examples by their maximum raw probability, then weights the absolute difference between bin accuracy and average confidence. Here it uses ten bins and raw argmax predictions, before thresholds. Test ECE is about 0.319 despite high thresholded accuracy; calibration remains a limitation.

The project also computes unscaled multiclass Brier score: average over examples of sum_k (p_k - y_k)^2. Test value is about 0.2875; lower is better. This implementation has no extra division by the number of classes or by two. Do not compare it casually with differently scaled reports.

Confidence intervals resample whole connected groups 1,000 times with seed 42. Approximate test intervals include accuracy 82.18%-99.69% and macro F1 81.99%-99.69%. Only eight groups make intervals unstable. They describe sampling variability for this fixed model and thresholds; they do not cover training uncertainty, labeling error, dataset shift or clinical validity. Null bounds can mean insufficient groups or no observed variation, rather than proven zero risk.

Separately, the updated app passed 25 fixed context challenge fixtures with zero errors, plus the Node regression suite. Those fixtures are reused developer-authored checks, not a random accuracy sample. Classifier metrics, context regressions and conversational quality must remain separate reports.

Metric implementation: `distress/evaluation.py`; saved evidence: `artifacts/prototype/evaluation.json` and `context-evaluation.json`. API reference: [classification_report](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.classification_report.html).

## 12. The technology stack and each part's role

| Technology | Role in MindMate | What to understand |
|---|---|---|
| Next.js 16.3 | Web app, pages and API handlers | Browser/server boundary; request lifecycle |
| React 19.2.4 | Interactive interface | State, effects, rendering and cleanup |
| TypeScript 5 | Static types | Compile-time checking does not replace runtime validation |
| Tailwind CSS 4 | Styling and responsive layout | Utility classes and breakpoints |
| Motion, Radix UI, Lucide | Animation, dialog interaction and icons | Accessibility, focus and component behavior |
| Recharts | Evaluation/report charts | Plot real values and label their scope |
| Supabase | Hosted PostgreSQL and Auth | Sessions, SQL, constraints and row-level security |
| Python | Classifier training and serving | Environment, numerical code and service lifecycle |
| scikit-learn | Features, classifier, calibration and metrics | fit/transform/predict_proba and leakage prevention |
| NumPy | Numerical arrays and calculations | Shapes, indexing and class order |
| joblib | Model artifact serialization | Load only trusted artifacts |
| Ollama | Local model runtime | Model tags, inference options and memory residency |
| Qwen3 4B Instruct | Pretrained conversational generator | Prompt adherence, token limits and factual limitations |
| Node.js test runner | Backend regressions | Failure paths, state and mocked service behavior |

The saved classifier records scikit-learn 1.9.1, NumPy 2.5.4 and joblib 1.6.0. Requirements permit version ranges, so artifact metadata is better evidence of a particular training run than requirements.txt alone.

The Python service uses the standard-library ThreadingHTTPServer, not FastAPI or Flask. Its default loopback address is port 8001. It exposes `/health` and `/predict`, validates request limits and can require a bearer token. Non-loopback deployment requires authenticated configuration. It is a small prototype service, not a claim of production-scale serving.

Supabase now runs online, so Docker Desktop is unnecessary for ordinary startup. Ollama and Python still use this laptop. Moving the database online does not move language-model inference to the cloud. The web app itself also remains local until separately deployed.

## 13. Ollama model choice and response speed

The measured laptop has a Ryzen 5 7535HS, six physical CPU cores, 12 logical processors, about 31.2 GiB system RAM and an RTX 4050 Laptop GPU with 6,141 MiB dedicated VRAM. System RAM and dedicated GPU memory are separate limits.

The selected default is `qwen3:4b-instruct`, a roughly 4-billion-parameter Q4_K_M model. Its official download is about 2.5 GB. Q4_K_M is a quantized format, reducing weight storage with a quality/resource tradeoff. Disk size is not the full runtime requirement; context and runtime buffers also use memory. See the [official model listing](https://ollama.com/library/qwen3:4b-instruct).

### Local comparison, November 15

Five identical synthetic prompts per model, one resident model at a time, thinking disabled, context 2,048, four CPU threads, temperature 0.6, seed 42 and comparison output cap 180 tokens:

| Measurement | qwen3.5:4b | qwen3:4b-instruct |
|---|---:|---:|
| Median warm first text, direct Ollama | 194 ms | 51 ms |
| Median warm output tokens/second | 46.55 | 52.70 |
| Median warm complete reply | 2.154 s | 2.368 s |
| First cold load duration | 9.288 s | 13.739 s |
| Replies hitting comparison token cap | 0 | 1 |

The new model generated tokens about 13% faster in this small batch. Longer answers meant its median complete reply was slightly slower. It was not faster by every measure, and this comparison does not establish that it is more accurate. Selected-model residency was about 2.876 GB (2.679 GiB), entirely reported in VRAM at context 2,048.

The final application keeps a 256-token cap and requests concise responses under about 120 words. A separate updated-route, five-turn synthetic check completed all replies without truncation: gaming received practical advice, news ambiguity received clarification, and the distress disclosure received empathy. That check called the route directly without hosted database or browser overhead.

### Current performance settings

- Disable thinking; stream tokens rather than wait for a complete paragraph.
- Use 2,048 context tokens, at most eight recent generation messages and 6,000 message characters.
- Cap generation at 256 tokens and use four CPU threads; temperature is 0.6.
- Keep the model resident for five idle minutes; launcher warm-up prepares it before interaction.
- Skip unnecessary prototype classifier calls for ordinary questions; overlap audit startup with generation.

Full canonical safety history remains separately bounded at 200 messages. Character limits and model-token limits are different measures. More prompt history can improve recall but costs processing and memory. Warm-up moves initial loading before the student's request; it does not speed up underlying token generation.

Use `ollama ps` to check residency and `ollama stop MODEL_NAME` to unload an idle model. Avoid loading the installed 9B model alongside chat on this GPU. Keep-alive is a tradeoff: shorter periods free memory sooner, while longer periods reduce cold starts. See [Ollama memory and keep-alive guidance](https://docs.ollama.com/faq).

Measured evidence: `mindmate-chatbot/benchmarks/model-comparison-2026-11-15.json`. These small local measurements are not guarantees under gaming, battery saving, thermal throttling or concurrent workloads.

## 14. Storage, privacy and the review workflow

The principal application data includes conversations, messages, support events and staff review history. Supabase Auth stores account identities and sessions. Foreign keys link detections to their canonical message and conversation, allowing authorized staff to see the relevant evidence.

Row-level security (RLS) restricts which database rows a student session may access. A public/publishable client key identifies the application; it does not replace the user's session or RLS. The server service-role secret is privileged and must never be bundled into browser code or committed. Authentication proves identity; authorization determines allowed actions.

Staff routes verify server-controlled roles or configured server-side permissions. Student-editable profile metadata must not grant staff access. Hidden URLs alone are not access control. Reports use private no-store responses, and account changes clear the prior account's sensitive UI state.

Each review change records who acted, when and what changed. Append-only history helps distinguish a mistaken classification from a delayed human response. Optimistic concurrency prevents two staff members from silently overwriting each other's work: an update includes the version it read, and a stale version produces a conflict requiring refresh.

Account-level sorting uses highest unresolved priority and waiting time. Counts must distinguish accounts from individual detections. A student can have four unresolved detections but still count as one account. Waiting duration should accompany an exact timestamp with timezone so urgency is understandable.

An event saved to a database does not notify a counselor. Queue availability depends on explicit operational configuration; the software cannot promise contact or response times from a successful insert. Retention, qualified access, annotations and response procedures require institutional decisions.

## 15. Failure modes and how to debug them

| Symptom | Likely layer | First evidence to inspect |
|---|---|---|
| Gaming or news triggers emergency wording | Routing / lexical false positive | Rule IDs, source, model mode, canonical context |
| Every topic receives the same comfort | System prompt or fixed-response selection | Whether Ollama was called; safety_response_required |
| First reply is slow, later replies fast | Cold model load | load_duration, ollama ps, warm-up |
| Text starts quickly but finishes slowly | Generation length / throughput | eval_count, eval_duration, done_reason |
| Model unavailable | Ollama service or missing tag | Local API health and installed model names |
| Chat history fails after hosted move | Supabase URL/key/schema/session | check:supabase; same-project configuration |
| Safety state persists unexpectedly | Saved prior state / unresolved question | Canonical messages and state provenance |
| Report priority differs from newest message | Unresolved account aggregation | Older unresolved detections and review status |
| Strong accuracy but weak real replies | Evaluation scope mismatch | Synthetic classifier metrics versus generated-chat tests |

Debug the whole pipeline before changing models. Inspect metadata rather than printing private message bodies or credentials. A fixed safety reply cannot be improved by increasing the LLM temperature because it bypasses the LLM. Likewise, making responses more empathetic does not improve classifier recall.

For performance, separate authentication, history, classifier, audit, model loading, prompt processing, first text and generation completion. Some phases overlap, so adding every Server-Timing duration double-counts time. Time to first text is responsiveness; tokens per second is throughput; total completion time also depends on output length.

The model has no live browsing integration in chat. Current-events answers should ask for the event if unclear and disclose the lack of live updates. Stronger factual reliability would require an explicit retrieval or verification design; merely changing a model tag does not add live information.

## 16. Reading map and practical commands

Read one feature from browser request to storage before trying to memorize every library.

| File or directory, relative to project root | Study purpose |
|---|---|
| mindmate-algorithm/distress/features.py | Normalization, TF-IDF branches and Logistic Regression |
| mindmate-algorithm/distress/dataset.py | Schema checks, connected groups and partitions |
| mindmate-algorithm/distress/synthetic.py | Generated data and labeling assumptions |
| mindmate-algorithm/train.py | Calibration, thresholds, gates and metadata |
| mindmate-algorithm/distress/evaluation.py | Metrics, confusion matrix and grouped intervals |
| mindmate-algorithm/distress/model.py | Trusted artifact loading and probability mapping |
| mindmate-algorithm/serve.py | HTTP prediction service and limits |
| mindmate-chatbot/lib/support/ | Rules, intent cues, routing, state and storage |
| mindmate-chatbot/lib/chat-config.ts | Conversational instructions and runtime defaults |
| mindmate-chatbot/app/api/chat/route.ts | Request validation, routing and streaming |
| mindmate-chatbot/lib/chat-stream.ts | Client-side stream parsing |
| mindmate-chatbot/lib/admin/ | Report aggregation, filters, exports and review actions |
| mindmate-chatbot/supabase/migrations/ | Schema, permissions and review audit definitions |
| mindmate-chatbot/tests/ | Expected behavior and failure regressions |

From the main project folder:

```powershell
npm.cmd run dev
```

From `mindmate-chatbot`, useful checks are:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run verify:algorithm
npm.cmd run check:supabase
npm.cmd run warmup:chat
npm.cmd run benchmark:chat
```

`verify:algorithm` exercises the actual artifact and hybrid policy without requiring Supabase or Ollama. Normal benchmark mode uses synthetic direct requests. Its `--saved` option is deliberately restricted to local Supabase; do not expect it to benchmark the current hosted database without a separately designed verification step.

Training the classifier does not retrain Qwen. `train:algorithm` prepares the small classifier artifact. The local launcher can reuse a compatible artifact, so startup need not mean a new independent experiment every time.

## 17. Limitations and a credible improvement plan

The largest research limitation is the dataset. The prototype sees generated phrase families, while real students express feelings indirectly, mix languages, change topics and use local slang. An English synthetic result cannot establish Filipino/Tagalog or code-switched performance. Selected multilingual rule examples are not comprehensive multilingual validation.

The lexical classifier is context-limited; the personal-distress cue is also a heuristic. It can miss unfamiliar disclosures or misread unusual phrasing. The prototype cap reduces inappropriate crisis responses but changes the balance of false positives and false negatives. Evaluate that tradeoff explicitly rather than claiming one guard solves all safety problems.

The language model can invent facts, give inconsistent plans and fail to follow instructions. The selected 4B model is a resource-aware local choice, not a mental-health specialist. Prompting for comfort does not make a model a therapist. Fixed responses and rules also require qualified review.

Prioritize future work in this order:

1. Establish a permitted, representative annotation process with independent reviewers and adjudication.
2. Collect hard ordinary negatives and indirect distress, including realistic local language and multi-turn cases.
3. Keep student/group holdouts untouched while tuning features, thresholds and routing on training/validation.
4. Compare the lexical baseline against suitable semantic models using accuracy, calibration, latency and resource use.
5. Evaluate complete conversations separately from single-message classification, including topic changes and stale state.
6. Define institutional review procedures, access controls, monitoring and release criteria with qualified stakeholders.

RAG (retrieval-augmented generation) would retrieve approved material into a prompt; it is a possible future design, not an implemented feature in this chat path. Fine-tuning would update model weights; editing SYSTEM_PROMPT does not. A semantic embedding model would represent contextual similarity differently from TF-IDF, but still needs representative evaluation.

## 18. Defense questions, glossary and study plan

### Questions you should be able to answer

**Why use TF-IDF?** It is an efficient sparse representation for a reproducible lexical baseline. Word pairs and character fragments capture useful patterns, with known semantic limits.

**Why Logistic Regression instead of a large neural classifier?** It is inexpensive, inspectable and suitable for sparse features. That is an engineering rationale, not evidence that it outperforms every alternative.

**Does the classifier generate the chat reply?** No. It supplies class scores. The application chooses a response path, and Ollama generates ordinary/supportive replies.

**Did you train the chatbot on 1,920 messages?** The project trained the small classifier on a split of 1,920 generated examples. Qwen is separately pretrained; this project did not retrain its weights on that corpus.

**Why use both word and character features?** They provide complementary lexical evidence. Character fragments can help some spelling variation; neither branch provides full contextual reasoning.

**What is calibration?** Adjusting probability estimates using held-out calibration evidence. It differs from raising or lowering a decision threshold.

**Why not report only accuracy?** It can conceal missed urgent cases, false alarms, class imbalance and probability problems. Report per-class metrics and error costs too.

**Why group students across splits?** Closely related messages can otherwise leak between training and evaluation, inflating apparent generalization.

**What does 91.88% mean?** Classifier threshold-policy accuracy on this generated regression holdout. It does not mean 91.88% accuracy on real students or 91.88% correct chatbot replies.

**Why is the test score higher than validation?** Different generated phrase families can differ in difficulty. A higher score on this small reused holdout is not evidence that tuning on validation harmed the model or that real-world accuracy is higher.

**What happens when a service fails?** Classifier failure leaves rules available. Rule-triggered safety responses bypass Ollama. Storage failures are surfaced without claiming a successful review request.

**Why was the screenshot wrong?** Synthetic lexical false positives and contaminated safety context selected fixed responses to ordinary topics. Routing and context provenance needed correction, as well as conversational instructions.

**Why choose the new Ollama model?** It fit dedicated VRAM comfortably and generated tokens faster in a measured local comparison. Cold loading and total answer length still affect perceived speed.

**Does online Supabase eliminate local processing?** No. It removes the local database/Docker requirement; Ollama and Python still run on the laptop.

**What would establish readiness for real use?** Representative reviewed evidence, suitable calibration and subgroup analysis, qualified review of rules/responses, operational human-review procedures and explicit release approval. Passing synthetic tests alone is insufficient.

### Compact glossary

| Term | Meaning |
|---|---|
| Corpus / document | Collection of texts / one text example |
| Vocabulary | Feature terms learned during fitting |
| Sparse vector | Numerical representation storing mainly nonzero features |
| N-gram | Sequence of n words or characters |
| IDF | Weight based on how broadly a term occurs across documents |
| Regularization | Constraint discouraging overly complex fitted weights |
| Hyperparameter | Setting selected outside ordinary model-weight fitting |
| Calibration | Agreement between scores and observed outcome frequencies |
| Threshold | Score boundary used by a decision policy |
| Leakage | Evaluation information improperly influencing fitting or tuning |
| Overfitting | Learning patterns that fail to generalize |
| Distribution shift | New inputs differ from the data used for development |
| Inference | Running a fitted model on an input |
| Token | Model text unit; different from a word or character |
| Quantization | Lower-precision weight representation to reduce resources |
| Context window | Token budget available to a model request |
| RLS / JWT | Database row-access policy / signed session-token format |
| Optimistic concurrency | Rejecting an update based on a stale record version |

### Seven-day study sequence

| Day | Focus | Evidence of understanding |
|---|---|---|
| 1 | Architecture and labels | Draw both models and explain every arrow |
| 2 | Normalization, n-grams and TF-IDF | Recalculate chapter 5 by hand |
| 3 | Logistic Regression and calibration | Explain scores, probabilities and thresholds separately |
| 4 | Data and evaluation | Recalculate recall, FPR and accuracy from the matrix |
| 5 | Rules and conversation context | Trace gaming, emotional disclosure and a genuine safety follow-up |
| 6 | Stack and performance | Trace an authenticated request; distinguish cold start from throughput |
| 7 | Limitations and defense | Answer the questions aloud without overstating evidence |

### Revision quiz and answer key

1. Is a TF-IDF weight a probability? **No; it is a feature value.**
2. If one actual Immediate example becomes High, does combined recall necessarily fall? **No; it remains in the combined positive group.**
3. Can 320 messages represent only eight independent groups? **Yes; related variations are grouped.**
4. Does low confidence mean Low priority? **No; the policy can apply a Moderate floor.**
5. Does an online database mean online LLM inference? **No.**
6. Can the final decision differ from the top probability? **Yes; rules, thresholds and conversation context can change it.**
7. Does a queue insert mean a counselor was contacted? **No.**
8. Does a perfect fixture pass establish clinical validity? **No; fixtures test specific expected behavior.**

### References and verification scope

Primary evidence is the project source and saved artifacts named throughout this guide. External references explain library behavior: [TF-IDF](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.TfidfVectorizer.html), [Logistic Regression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html), [calibration](https://scikit-learn.org/stable/modules/generated/sklearn.calibration.CalibratedClassifierCV.html), [classification metrics](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.classification_report.html), [Ollama model listing](https://ollama.com/library/qwen3:4b-instruct) and [Ollama runtime guidance](https://docs.ollama.com/faq).

At this snapshot, all 327 Node tests, lint, TypeScript checking and the production build passed. The current artifact/policy context verification passed 25 fixed fixtures. Five synthetic multi-turn route checks confirmed the corrected ordinary-versus-supportive routing with the selected model. These checks do not certify every possible generated reply or real-world safety performance.
