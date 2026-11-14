# MindMate prototype

To use **online Supabase without Docker**, follow the [hosted Supabase migration guide](mindmate-chatbot/SUPABASE_SETUP.md). It covers preserving existing accounts and chat history, connecting the hosted project, and closing Docker after verification. Ollama and the classifier still run locally.

Start the complete English development prototype from this folder or `mindmate-chatbot`:

```powershell
npm run dev
```

This prepares or reuses the trained synthetic-data classifier, starts its local Python service and the existing app services, and launches the app with automatic code reloading. Open **Admin > Classification tester** to inspect live support-priority classification decisions and model scores. The classification identifies the recommended level of counselor attention from the available message: **Low priority**, **Moderate priority**, **High priority**, or **Immediate attention**. Synthetic scores demonstrate the pipeline; they are not validated estimates for real students. See the [classification guide](mindmate-algorithm/README.md) for category meanings, training, evaluation, and standalone service commands.

To generate and train the classifier without starting Docker, Supabase, or Ollama:

```powershell
npm.cmd run train:algorithm
```

`npm.cmd run verify:algorithm` checks the real trained model through its HTTP service and the application policy without starting the database or Ollama.

Training writes a readable [evaluation report](mindmate-algorithm/artifacts/prototype/evaluation.md) with per-class results, error counts, grouped uncertainty intervals, and leakage audits. Verification also writes [context challenge results](mindmate-algorithm/artifacts/prototype/context-evaluation.json) for negation, quotations, historical disclosures, and multi-turn safety replies.

The frontend connects these results at `/admin/tester` (live message tester), `/model-lab` (owner-only service status and session tests), and `/model-lab/reports` (owner-only evaluation tables, uncertainty, audits and JSON export). The student support dashboard is at `/admin`. Student chat attaches actionable support notices to each response and restores available notices when a saved conversation reopens. See the [integration guide](mindmate-chatbot/SUPPORT_SETUP.md) for the data and privacy boundaries.

With local Supabase, `npm run dev` prepares local private support history automatically and keeps its discovered credential on the server. Hosted Supabase uses the server key configured in `.env.local` and the schema applied during migration. A monitored review queue is not enabled automatically.

For an optimized presentation build with the same trained classifier, use the optional shortcut:

```powershell
npm.cmd run prototype
```

To launch the optimized app using the classifier mode configured in the environment, use:

```powershell
npm.cmd run demo
```

All commands also work from `mindmate-chatbot`. The launcher connects to the configured Supabase project, starts or reuses local model services, prepares the installed chatbot model, and opens the application server. Follow the address printed in the terminal, normally http://localhost:3000. Both `dev` and `prototype` automatically enable the synthetic classifier for the local run; `demo` keeps the configured classifier mode.

`dev` reloads application code while you edit. `demo` creates an optimized build automatically and reuses it until source files, dependencies or build settings change. Keep the terminal open while using MindMate; press Ctrl+C to stop the app. An Ollama server started by the launcher is stopped with it; an existing Ollama application is left running. Local Supabase containers, if used, remain available for reuse.

Ollama, project dependencies and the configured model must already be installed. Docker Desktop is required only when the configured Supabase URL is local. With a hosted HTTPS URL, the launcher checks the online database and never starts Docker. It reports missing software or invalid configuration rather than resetting data or changing models.

See the [defense guide](mindmate-chatbot/DEMO_SETUP.md) or [chat setup](mindmate-chatbot/CHAT_SETUP.md) for details.
