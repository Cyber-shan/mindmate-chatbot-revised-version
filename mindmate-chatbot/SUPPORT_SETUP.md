# Support-priority classification integration

Support-priority classification identifies the recommended level of counselor attention from the available message and permitted conversation context. It supports human review and does not diagnose a disorder or assign clinical severity.

| Category | Intended meaning | Internal key |
|---|---|---|
| **Low priority** | Routine supportive response; no direct counselor attention indicated by the available message. | `LOW` |
| **Moderate priority** | Counselor attention recommended, but not urgently. | `MODERATE` |
| **High priority** | Counselor attention recommended as soon as possible. | `HIGH_CONCERN` |
| **Immediate attention** | Potential safety-related content requiring priority human review. | `IMMEDIATE_SAFETY` |

Internal keys remain stable for saved events, model artifacts, and API compatibility. All categories above Low priority require human review in the decision policy. Actual review availability depends on persistence and the institution's monitored-queue configuration; a recommendation does not mean a counselor has been contacted.

`POST /api/chat` evaluates the latest student message before generative response handling. The independent rule engine and optional ML scores feed a monotonic policy: a lower ML prediction cannot reduce a safety rule's priority. High priority and Immediate attention receive fixed responses rather than Ollama generation. Low priority and Moderate priority retain streaming generation.

The managed `npm run dev` command automatically enables the synthetic English classifier. Without the managed launcher or classifier configuration, the application uses **draft, rules-only mode**, with no invented probabilities. This is an engineering implementation requiring a reviewed corpus, clinician rule/template review, local evaluation and an institution-approved escalation procedure before production use with students.

Run `npm run dev` from the repository root or this directory. It prepares or reuses a calibrated classifier, starts its local service alongside the existing app services, and launches the development app with prototype mode enabled. `npm.cmd run prototype` remains an optional optimized-build shortcut. `npm.cmd run train:algorithm` trains without starting the full app. See the [algorithm guide](../mindmate-algorithm/README.md#run-the-completed-prototype) for standalone Python commands and evaluation artifacts.

Prototype predictions carry `model_mode: "prototype"`, `synthetic_data: true`, `language: "en"`, `prototype_usable: true`, and `release_approved: false`. The application requires `DISTRESS_CLASSIFIER_MODE=prototype` and a loopback HTTP URL before using them. Admin results clearly label synthetic scores. The prototype abstains for rule-recognized negated, academic, idiomatic, historical, and third-party safety context, where a synthetic lexical model can misread intent; rules and conversation state still apply. Safety overrides requiring Immediate attention continue to bypass ML. Generated replies are instructed to use English, and visible tester examples are English.

## Application configuration

Add the settings you need to `.env.local` and restart Next.js. Existing Supabase and Ollama settings stay in use. The `dev` and `prototype` launchers set classifier mode to `prototype` for their child processes and supply the default loopback URL without editing this file. The reviewed-mode settings below apply when launching Next.js directly or using `demo`.

```dotenv
# Optional, server-only. Omit to use the independent rule engine alone.
DISTRESS_CLASSIFIER_URL=http://127.0.0.1:8001
DISTRESS_CLASSIFIER_TOKEN=match-the-python-service-token
# Default: reviewed. Set prototype only for the local synthetic demonstration.
DISTRESS_CLASSIFIER_MODE=reviewed

# Deployment resource locale. PH enables the explicitly labeled Philippines contact.
# Omit for generic local emergency/crisis-service directions.
MINDMATE_COUNTRY=PH

# Optional local override; the managed launcher discovers its local key in memory.
# Configure explicitly when launching Next.js directly. Never use NEXT_PUBLIC_.
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key

# Enable only when the institution operates and monitors the queue.
SUPPORT_REVIEW_QUEUE_ENABLED=false
```

See [`../mindmate-algorithm/README.md`](../mindmate-algorithm/README.md) for Python setup and training. Classifier requests time out after 1.5 seconds. Unapproved artifacts outside explicit prototype mode, invalid scores, missing thresholds and service errors fall back to rules. Direct safety signals requiring Immediate attention bypass ML entirely.

The resource locale is deployment configuration, not language-based location inference. The Philippines contact was obtained using the local-hotline lookup on 2026-11-08 and must be reverified before release. Other locations require a reviewed resource configuration. Do not infer a student's physical location from browser language or a training label.

## Conversation context and student interface

The chat page sends its Supabase bearer token, conversation ID and saved message ID. The server verifies the session and ownership using RLS, then loads the latest 200 canonical messages. Submitted history cannot replace the saved conversation. Only Ollama's generation prompt is reduced to eight messages and 6000 characters; safety evaluation runs first over the larger window. Messages over 4000 characters are rejected rather than silently cutting off a safety disclosure.

State tracks highest priority, previous high/immediate concerns and unanswered safety questions. A reply such as "not really" to "Are you safe right now?" raises immediate priority. Explicit safe answers resolve that question while retaining an additional-support floor. When private auditing is configured, state from previous decisions also survives the 200-message window, reloads and restarts. Without it, state is reconstructed from available messages; model-only decisions outside the window cannot be recovered.

The stream includes a restricted `support` event containing only response requirements, review availability and actionable resource links. Internal categories, scores, rule matches, thresholds and versions stay server-side. Safety replies use the same NDJSON completion event as generated replies, so they display and save in existing conversation history.

Support notices now belong to their message and reply instead of a global banner. New conversations, sign-out and thread switches cancel stale requests. Reopened history fetches the latest 200 messages and, when private auditing is available, restores matching notices through `GET /api/chat/support?conversation_id=...`. This endpoint verifies the bearer session and conversation ownership before reading private events, then returns only restricted support flags keyed to canonical user-message IDs. Missing audit access does not prevent readable chat history or invent a review request. Raw priorities, probabilities and rule matches are never sent to the student interface.

Requests without conversation IDs retain the existing direct API/benchmark behavior and have no durable review queue. Add authentication/rate limiting at the deployment boundary if this endpoint is internet-facing.

## Private audit and review queue

The managed local launcher prepares private support history automatically after Supabase is ready. It checks that CLI discovery exactly matches the configured loopback API origin, reads a local service-role key into the child process environment only, verifies table privacy, and applies only the pinned [`20261108090000_create_support_events.sql`](supabase/migrations/20261108090000_create_support_events.sql) if its table is absent. That single atomic migration is recorded in the local migration ledger; unrelated migrations, existing chat data and `.env.local` are untouched. Repeated starts reuse the private table. Changed migration SQL, an inconsistent migration ledger, or unsafe existing table permissions are rejected for explicit repair. No remote database was changed.

The local table and migration ledger were prepared and verified during frontend integration. For a different environment or direct Next.js launch, use the normal reviewed migration process and configure the server-only role key explicitly. The launcher preserves an existing configured key and never enables a monitored review queue automatically.

The schema reader handles row envelopes and result arrays, and explicitly decodes native or PostgreSQL text booleans. Invalid or ambiguous metadata cannot enable private audit access or trigger an automatic migration. If optional support-history preparation fails, the launcher warns and continues starting chat and the classifier with the role key blank and review queue disabled in the child environment. This also prevents Next.js from reloading an unverified role key from `.env`. Saved configuration files stay unchanged. Saved support notices and review requests remain unavailable until the local setup issue is repaired and the app is restarted. Cancelling startup still stops the app.

`support_events` stores structured decisions, source, confidence, versions, rule IDs and conversation state, linked to the original message. It does not duplicate message text. Student/anonymous roles cannot read or write it; the server-only service role writes after ownership verification. Events cascade on conversation/message deletion. The institution must establish retention and staff-access policies.

Audit requests have a one-second deadline and failures do not suppress safety replies. Missing persistence, missing migration or write failure reports review as unavailable. A successfully saved event is only reported as queued when `SUPPORT_REVIEW_QUEUE_ENABLED=true`. Retried messages use an idempotent write and do not reopen reviewed events. A queue entry does not mean a counselor has been contacted or that an immediate response is guaranteed; the interface states this explicitly.

Student notice restoration and live chat are also guarded at account boundaries. A sign-out or direct account change cancels in-flight requests and clears the previous account's messages, notices and sidebar history; refreshing the same account's token preserves its conversation. A stale initial authentication lookup cannot overwrite a newer session event. Audit retries cannot report a pending review once the monitored queue setting is disabled.

The `/admin` entry opens the authenticated student support dashboard. `/admin/login` provides a dedicated administrator sign-in form. Each private report request verifies the Supabase session server-side and requires `app_metadata.mindmate_role` to be `admin` or `counselor`, or a verified email in the server-only comma-separated `MINDMATE_ADMIN_EMAILS` allowlist. Student-editable `user_metadata` never grants access. The service-role credential stays on the server. Reports use private, no-store responses; signing out or changing accounts removes the previous account's report from the interface.

The dashboard groups saved `support_events` by the owning student account across all conversations. Priority is **Immediate attention → High priority → Moderate priority → Low priority**, using the highest unresolved detection. Within one priority, the oldest unresolved detection comes first. A newer Low priority detection cannot clear an older Immediate attention detection. Only `resolved` and `false_positive` events leave the unresolved count; `reviewed` remains open until resolved. Accounts with only closed events remain available through the status filter. Counts on the four cards represent accounts, not messages.

Administrators can search by name, email or account ID, filter priorities, refresh, export the filtered account list, and open an individual report with the original detected messages and saved review statuses. Account reports show up to 100 entries ordered by unresolved priority and waiting time; totals include every saved event. CSV exports neutralize spreadsheet formulas in account names and message text. The dashboard reads existing detections and does not activate the review queue, contact anyone, or alter existing review statuses.

The server uses keyset pagination across the complete detection history, including PostgreSQL microseconds, so older urgent events cannot disappear behind the API's first-page limit. The local prototype explicitly rejects reports above 100,000 events or its request deadline instead of silently returning incomplete priorities. Identity lookup failures retain account IDs and priorities with a visible warning. A database-side reporting aggregate is needed before scaling beyond these prototype bounds.

To create a local administrator after a fresh database setup, run `npm run create:admin` from the repository root or `mindmate-chatbot`. It creates `admin@mindmate.local` with a generated password, confirms the local account without sending email, and assigns the server-managed administrator role. It prints the new credentials once and never writes the password to source or configuration files. It rejects remote Supabase origins and does not overwrite an existing account. Use `npm run create:admin -- --email another-admin@mindmate.local` for a different account. Existing student accounts do not need any changes.

Administrator setup also applies the reviewed, idempotent [`20261109090000_enable_staff_support_reports.sql`](supabase/migrations/20261109090000_enable_staff_support_reports.sql) migration. It grants only `SELECT` on `conversations` and `messages` to `service_role`, which needs those reads to link detections to accounts and show authorized report evidence. Student policies and grants stay unchanged. The setup verifies that CLI discovery matches the configured loopback origin before applying this single migration; it never runs unrelated migrations. For an existing administrator, `npm run setup:admin` prepares these read permissions without changing accounts or passwords. These local read grants were applied during dashboard integration.

The prototype classification tester is at `/admin/tester`. It uses the same assessment function as student chat and evaluates only text supplied in the test form. It does not load student records or write review events. Use synthetic examples there.

The regular admin navigation contains only the student dashboard at `/admin` and Classification tester at `/admin/tester`. The unlisted owner Classification overview at `/model-lab` shows live classifier health, saved training metrics, split audits, and actual test decisions from that workspace visit. `/model-lab/reports` displays the saved validation and regression comparison, per-class errors, confusion matrices, grouped confidence intervals, calibration and context checks. Neither private page is linked from regular admin screens. The old `/admin/overview` and `/admin/reports` pages no longer exist. These evaluation pages do not read private student records or operate a counselor queue.

Set the server-only `MINDMATE_OWNER_USER_ID` in `.env.local` to the existing owner's Supabase account UUID. Only that identity can open the private pages; report API requests additionally require existing staff authorization. Other administrators and counselors do not inherit owner access. Missing or invalid owner configuration denies access. Page requests verify the cookie session server-side, redirect signed-out visitors to admin sign-in, and return not-found for other accounts. Successful sign-in returns the owner to `/model-lab`. Sign-out and account changes clear private report data. A hidden URL is not the access control.

## See decisions in the admin prototype

Start the project with `npm run dev` and visit http://localhost:3000/admin/login to sign in to the student dashboard. The trained classifier starts automatically. To run an isolated classification test, choose **Classification tester** in the sidebar or visit http://localhost:3000/admin/tester, choose an example or type a test message, then click **Analyze message**. The result shows the support-priority category, source, matched rule IDs, safety and human-review requirements, conversation state, available model confidence and a fixed safety-response preview when applicable.

Use **Include conversation context** or **Edit previous messages** to supply an ordered history, edit user/assistant roles, and test short replies in context. For example, "Not really" after "Are you safe right now?" should select `IMMEDIATE_SAFETY`. **Run all examples** evaluates 19 synthetic cases through the running endpoint and compares actual outcomes with rules-only reference labels, including informal wording, split spellings, negation and quotations. A model can raise these reference priorities. When ML contributes, the tester shows all four raw class probabilities and explains that the top score is not a clinical certainty. Structured decision JSON remains expandable.

The regular dashboard and tester use `GET /api/admin/algorithm/status` for service health without loading or exposing evaluation artifacts. Owner pages use `GET /api/admin/algorithm/overview` with a verified owner bearer session and private, no-store responses varying on Authorization. Both refresh every 30 seconds while visible and on demand, and verify service health through the same authenticated prediction adapter used by chat. The owner endpoint reads validated aggregate artifact fields and excludes private review identities, source paths, original message text, and individual student IDs. Missing, invalid, stale, offline and failed-refresh states are displayed explicitly; sample metrics are never substituted. Evaluation reports remain identified as saved results even when the live service is unavailable. `MINDMATE_ALGORITHM_REPORT_DIR` can select a server-only artifact directory for a different trained model. JSON export downloads the same sanitized snapshot. Recent manual tests stay in memory for the current workspace visit and clear on page reload.

Report JSON files remain server-side runtime artifacts rather than being copied into the browser or bundled with all project source. The local launcher supplies them from `mindmate-algorithm/artifacts/prototype`. Any separate deployment must mount its own approved aggregate report directory; missing files produce an explicit unavailable state.

The tester calls `POST /api/admin/algorithm`, which delegates to `assessSupport`, also used by `POST /api/chat`. Safety signals requiring Immediate attention bypass ML. Other messages can use a configured reviewed classifier or an explicitly enabled local synthetic prototype. Rules-only results display confidence as unavailable; model probabilities come from the trained artifact. Passing the built-in examples verifies these cases, not population-level accuracy or clinical validity.

## Rule maintenance and verification

Rules are versioned in [`lib/support/rules.json`](lib/support/rules.json), marked `requires_clinician_review`. Reviewers should update the version, approval metadata and regression cases when changing them. Do not mark draft rules clinically approved merely because software tests pass. The context heuristics are bounded engineering safeguards; they do not establish that a student is safe.

The `v3` draft retains the informal-word normalization introduced in `v2` and adds context regressions. Negation is scoped to each disclosure: "not sure" and "cannot stop" are not treated as denials. Closed quotations retain their educational, historical, or third-party attribution across internal sentence boundaries; personal disclosures remain actionable even if they mention a class assignment. Unclosed quotations are treated conservatively. Historical language includes last week/month and childhood references without suppressing a separate current disclosure.

Saved conversation state is replayed before canonical history, so a later explicit safety answer can resolve an old question while retaining the additional-support floor. Uncertainty about staying safe does not resolve a question. A text-only model abstains from interpreting explicit contextual safety answers. Prototype models also abstain for recognized negated, academic, historical, third-party, or involuntary-thought contexts. Original messages remain intact. These are bounded language rules and tested examples, not general language understanding or a guarantee for unfamiliar wording.

`npm.cmd run verify:algorithm` tests the actual classifier service and hybrid policy, and saves `../mindmate-algorithm/artifacts/prototype/context-evaluation.json`. It records per-class counts, a confusion matrix, and errors by context category. The separate `evaluation.md` and `evaluation.json` files report classifier metrics, grouped confidence intervals, calibration, low-confidence counts, and holdout/calibration overlap audits. A perfect challenge-fixture pass rate does not estimate real-world accuracy.

```powershell
npm.cmd test
npm.cmd run test:support
npm.cmd run lint
npm.cmd run build
```

With a local server running, `node scripts/verify-support-runtime.mjs http://127.0.0.1:3000` checks seven safety-response cases over HTTP, including the four reported wording examples, without creating database records. To verify independence from both model services, use `npm.cmd run dev:next` to start Next.js directly with `OLLAMA_URL` and `DISTRESS_CLASSIFIER_URL` pointing to an unavailable local port.

The Node suite covers safety-rule/model disagreement, negation, historical and third-person context, academic quotations, selected Tagalog/code-switched phrases, obfuscation, uncertainty, conversation replies, database authorization and failures, stream behavior and Ollama bypass. The Python suite covers grouped leakage prevention, calibrated training, class-order mapping, threshold selection, evaluation gates and HTTP errors. Tests train temporary **synthetic fixtures**, not a release model. GitHub Actions runs both suites through [the safety workflow](../.github/workflows/support-safety.yml).

Draft fixed replies follow the connection and safety-check principles in [NIMH's action steps](https://www.nimh.nih.gov/health/publications/5-action-steps-to-help-someone-having-thoughts-of-suicide). A qualified local team must approve wording and escalation behavior for the institution.
