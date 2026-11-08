# Support-priority integration

`POST /api/chat` evaluates the latest student message before generative response handling. The independent rule engine and optional ML scores feed a monotonic policy: a lower ML prediction cannot reduce a safety rule's priority. High concern and immediate safety receive fixed responses rather than Ollama generation. Ordinary and moderate support retain streaming generation.

The default is **draft, rules-only mode**, with no invented probabilities. This is an engineering implementation requiring a reviewed corpus, clinician rule/template review, local evaluation and an institution-approved escalation procedure before production use with students.

## Application configuration

Add the settings you need to `.env.local` and restart Next.js. Existing Supabase and Ollama settings stay in use.

```dotenv
# Optional, server-only. Omit to use the independent rule engine alone.
DISTRESS_CLASSIFIER_URL=http://127.0.0.1:8001
DISTRESS_CLASSIFIER_TOKEN=match-the-python-service-token

# Deployment resource locale. PH enables the explicitly labeled Philippines contact.
# Omit for generic local emergency/crisis-service directions.
MINDMATE_COUNTRY=PH

# Optional private audit persistence. Never prefix this key with NEXT_PUBLIC_.
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key

# Enable only when the institution operates and monitors the queue.
SUPPORT_REVIEW_QUEUE_ENABLED=false
```

See [`../mindmate-algorithm/README.md`](../mindmate-algorithm/README.md) for Python setup and training. Classifier requests time out after 1.5 seconds. Unapproved artifacts, invalid scores, missing thresholds and service errors fall back to rules. Direct immediate-safety signals bypass ML entirely.

The resource locale is deployment configuration, not language-based location inference. The Philippines contact was obtained using the local-hotline lookup on 2026-11-08 and must be reverified before release. Other locations require a reviewed resource configuration. Do not infer a student's physical location from browser language or a training label.

## Conversation context and student interface

The chat page sends its Supabase bearer token, conversation ID and saved message ID. The server verifies the session and ownership using RLS, then loads the latest 200 canonical messages. Submitted history cannot replace the saved conversation. Only Ollama's generation prompt is reduced to eight messages and 6000 characters; safety evaluation runs first over the larger window. Messages over 4000 characters are rejected rather than silently cutting off a safety disclosure.

State tracks highest priority, previous high/immediate concerns and unanswered safety questions. A reply such as "not really" to "Are you safe right now?" raises immediate priority. Explicit safe answers resolve that question while retaining an additional-support floor. When private auditing is configured, state from previous decisions also survives the 200-message window, reloads and restarts. Without it, state is reconstructed from available messages; model-only decisions outside the window cannot be recovered.

The stream includes a restricted `support` event containing only response requirements, review availability and actionable resource links. Internal categories, scores, rule matches, thresholds and versions stay server-side. Safety replies use the same NDJSON completion event as generated replies, so they display and save in existing conversation history.

Requests without conversation IDs retain the existing direct API/benchmark behavior and have no durable review queue. Add authentication/rate limiting at the deployment boundary if this endpoint is internet-facing.

## Private audit and review queue

Apply [`supabase/migrations/20261108090000_create_support_events.sql`](supabase/migrations/20261108090000_create_support_events.sql) through the project's normal Supabase migration process. It has not been applied to any remote database by this change.

`support_events` stores structured decisions, source, confidence, versions, rule IDs and conversation state, linked to the original message. It does not duplicate message text. Student/anonymous roles cannot read or write it; the server-only service role writes after ownership verification. Events cascade on conversation/message deletion. The institution must establish retention and staff-access policies.

Audit requests have a one-second deadline and failures do not suppress safety replies. Missing persistence, missing migration or write failure reports review as unavailable. A successfully saved event is only reported as queued when `SUPPORT_REVIEW_QUEUE_ENABLED=true`. Retried messages use an idempotent write and do not reopen reviewed events. A queue entry does not mean a counselor has been contacted or that an immediate response is guaranteed; the interface states this explicitly.

The existing `/admin` screens use their existing sample data. This change supplies a **private database queue**, not a staffed monitoring service or an authenticated staff dashboard. Connect institution-approved staff tooling to rows with `review_status='pending'` before enabling the queue. No email, SMS, emergency-service call, automatic external notification or remote database change is performed.

## Rule maintenance and verification

Rules are versioned in [`lib/support/rules.json`](lib/support/rules.json), marked `requires_clinician_review`. Reviewers should update the version, approval metadata and regression cases when changing them. Do not mark draft rules clinically approved merely because software tests pass. The context heuristics are bounded engineering safeguards; they do not establish that a student is safe.

```powershell
npm.cmd test
npm.cmd run test:support
npm.cmd run lint
npm.cmd run build
```

With a local server running, `node scripts/verify-support-runtime.mjs http://127.0.0.1:3000` checks three safety-response paths over HTTP without creating database records. To verify independence from both model services, start that server with `OLLAMA_URL` and `DISTRESS_CLASSIFIER_URL` pointing to an unavailable local port.

The Node suite covers safety-rule/model disagreement, negation, historical and third-person context, academic quotations, selected Tagalog/code-switched phrases, obfuscation, uncertainty, conversation replies, database authorization and failures, stream behavior and Ollama bypass. The Python suite covers grouped leakage prevention, calibrated training, class-order mapping, threshold selection, evaluation gates and HTTP errors. Tests train temporary **synthetic fixtures**, not a release model. GitHub Actions runs both suites through [the safety workflow](../.github/workflows/support-safety.yml).

Draft fixed replies follow the connection and safety-check principles in [NIMH's action steps](https://www.nimh.nih.gov/health/publications/5-action-steps-to-help-someone-having-thoughts-of-suicide). A qualified local team must approve wording and escalation behavior for the institution.
