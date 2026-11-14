# Initial-defense demo

This prototype uses the installed **Qwen3.5 4B** model through local Ollama. No hosted AI provider or model download is required by these optimizations.

`npm run dev` automatically prepares or reuses the trained English support-priority classifier and starts its Python service with the rest of the app. The Classification tester labels contributing model scores as a synthetic English prototype. Support-priority classification identifies recommended counselor attention from the available message, using **Low priority**, **Moderate priority**, **High priority**, and **Immediate attention**. `npm.cmd run verify:algorithm` exercises the trained classifier and policy without starting Supabase or Ollama. See the [classification guide](../mindmate-algorithm/README.md) for category meanings, training, and evaluation details.

## Prepare before presenting

From either `Mindmate-Project` or `mindmate-chatbot`, run this one command:

```powershell
npm run dev
```

The launcher checks the local services, starts Docker Desktop on Windows when needed, starts/reuses Supabase and Ollama, and prepares both the trained classifier and installed chatbot model. It starts MindMate with automatic code reloading. Wait for the terminal to show the application address before presenting.

For an optimized presentation build with the same classifier, `npm.cmd run prototype` remains an optional shortcut. It builds only when needed and reuses unchanged builds. `npm.cmd run demo` launches the optimized app using the classifier mode configured in the environment.

When Docker restores an existing Supabase database, its container may still be starting after the engine becomes available. The launcher waits and retries that temporary startup state for up to three minutes, so you can leave the first command running. Unhealthy containers and configuration errors are reported immediately.

The usual `npm run dev` command handles classifier preparation and chatbot warm-up automatically; no separate service command is needed.

The launcher also prepares the local private support-history table and keeps its discovered credential in server memory. It reuses existing chat records and leaves review requests disabled unless you explicitly configured a monitored queue. Saved support notices can therefore restore when you reopen a conversation without adding a secret to `.env.local`.

Support-history setup is optional for startup. If its CLI response, schema, credentials or privacy checks fail, the launcher prints a warning and still starts chat and the classifier. Saved support notices and review requests remain unavailable for that run. Repair the reported local setup issue and restart to retry; existing configuration files are preserved.

The student support dashboard is at `/admin`; sign in through `/admin/login` using an approved staff account. It lists real saved detections in Immediate attention, High priority, Moderate priority, Low priority order, grouped once per student by their highest unresolved priority. It includes account reports, search, filters and CSV export. A local administrator can be created with `npm run create:admin`, which prints its generated password once and never changes existing accounts. The Classification tester is at `/admin/tester`.

Light/dark mode is shared across student sign-in, signup, chat, administrator sign-in, dashboards, reports and report drawers. Use the sun/moon button in the sign-in corner or app header. The choice is saved in this browser, survives navigation and sign-out, and synchronizes between tabs. With no saved choice, the app follows the system theme. If browser storage is blocked, the toggle still works for the current visit.

Docker Desktop must have completed its initial installation/setup, and Ollama, project dependencies and the configured Qwen model must already be installed. The launcher reuses running services, so they do not need to be opened manually each time. Existing environment settings are read from `mindmate-chatbot/.env.local`.

Open http://localhost:3000/chat and sign in with your prototype account. This project's Supabase Studio is at http://127.0.0.1:55123; its API is at http://127.0.0.1:55121. The model runs locally at http://127.0.0.1:11434.

The model stays ready for 30 minutes after use. Each launcher run prepares it automatically. The standalone `npm.cmd run warmup:chat` remains available if you leave the app open but let the model go idle before presenting. Keep the laptop plugged in for consistent performance. Other GPU workloads and laptop power/thermal conditions can affect speed.

Press Ctrl+C to stop the app. The launcher also stops any Ollama or prototype classifier server it started itself. Existing service sessions, Docker Desktop and Supabase containers are kept available for reuse. Database volumes are preserved.

## Verify the demonstration

Click **Admin sign in** on the login page and sign in with an approved staff account, then open **Classification tester**. Choose a sample message and click **Analyze message** to see the real support-priority category, matched rules and context. **Run all examples** displays an expected-versus-actual comparison for the synthetic regression cases, including informal wording and split spellings. This testing workspace does not read real student conversations.

The owner-only **Classification overview** at `/model-lab` shows live connection status, saved evaluation metrics and your actual test decisions from this visit. **Evaluation reports** at `/model-lab/reports` includes per-class errors, confusion matrices, uncertainty intervals, calibration, split audits, and context-check results. Its refresh button checks the live service; its export button downloads the sanitized report. Offline or stale data is labeled explicitly. See [SUPPORT_SETUP.md](SUPPORT_SETUP.md) for owner access configuration.

- Start a new chat and try an ordinary schoolwork concern; text should stream into the reply.
- Confirm the completed messages remain in history after reopening the conversation.
- In a fresh conversation, use a synthetic High priority example and check the fixed safety check-in.
- Confirm the support notice stays with that reply and clears from view when a new conversation opens. Reopening the thread restores the notice when local audit persistence is available.
- Run `node scripts/verify-support-runtime.mjs` while the app is running to check the dedicated safety paths and wording variations without database records.

The runtime check can target another port: `node scripts/verify-support-runtime.mjs http://127.0.0.1:3001`. Safety replies remain independent of generative-model availability. Rules are draft support-prioritization rules; do not describe this prototype as a clinically validated diagnostic system.

For measurements, use `npm.cmd run benchmark:chat -- --saved --prepare --runs 4`. This creates and cleans up synthetic local test records, and measures saving, authenticated API handling and reply generation. See [CHAT_SETUP.md](CHAT_SETUP.md) for benchmark flags and optional timing diagnostics.
