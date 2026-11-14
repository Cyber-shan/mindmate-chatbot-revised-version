# Local chatbot

Start the complete local setup from the main project folder or this folder with `npm.cmd run dev`. For an optimized defense presentation, use `npm.cmd run demo`. These commands prepare the required services and model automatically; `demo` also builds when source or build settings have changed. See [DEMO_SETUP.md](DEMO_SETUP.md).

The chat API runs support-priority classification before generation to identify recommended counselor attention from the available message and conversation context. Its categories are **Low priority**, **Moderate priority**, **High priority**, and **Immediate attention**. See [SUPPORT_SETUP.md](SUPPORT_SETUP.md) for category meanings, safety rules, the optional TF-IDF/Logistic Regression service, clinician-review requirements, and private review-queue configuration.

MindMate defaults to **Qwen3.5 4B**, served by Ollama. Install the model on the machine running Ollama:

```powershell
ollama pull qwen3.5:4b
```

The Next.js server connects to `http://127.0.0.1:11434` by default. To change the server or model, set these variables in `.env.local` and restart Next.js:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_KEEP_ALIVE=30m
```

Replies stream into the chat bubble as text is generated. Only completed replies are saved to Supabase. Starting a new chat or opening another conversation cancels the current generation.

To reduce latency and memory use, the API disables thinking, uses a 2,048-token context, sends at most eight recent messages within a 6,000-character budget, and generates at most 256 tokens. Older messages remain in the database. The model stays loaded for 30 minutes after use, configurable through `OLLAMA_KEEP_ALIVE`. Generation times out after 60 seconds and displays an error instead of leaving the progress indicator running indefinitely. Response speed still depends on hardware, prompt length, and whether the model needs to load.

The one-command launcher prepares the model automatically. To prepare it separately for diagnostics or after a long idle period:

```powershell
npm.cmd run warmup:chat
```

This runs a neutral, one-token warm-up against the same local model, system prompt and context configuration as the chat route. It creates no database records and downloads no model. Model preparation takes place before the student sends a message; it does not increase the model's underlying token-generation speed. Keeping the model ready occupies GPU memory. Run the warm-up again after restarting Ollama or leaving the model idle past its keep-alive period. See [DEMO_SETUP.md](DEMO_SETUP.md) for the defense checklist.

The first streamed token appears immediately. Subsequent updates are batched every 40 milliseconds to reduce rendering work, and the completed reply is flushed immediately. The server loads ownership-checked history with one query and reads optional prior safety state in parallel. History-sidebar refreshes run after saving without blocking the next message.

Run the stream and route tests with Node.js 24:

```powershell
npm.cmd run test:chat
```

With the development server running, measure time to first visible text and total reply time:

```powershell
npm.cmd run benchmark:chat
```

By default, the benchmark calls the chat API directly without database records and reports three runs. It can target another local port:

```powershell
npm.cmd run benchmark:chat -- http://127.0.0.1:3001/api/chat
```

To include real local authentication and message saving, with model preparation:

```powershell
npm.cmd run benchmark:chat -- --saved --prepare --runs 4 --output benchmarks/local-results.json
```

`--saved` is restricted to a local app and local Supabase. It reads local CLI credentials in memory (or uses a server-role key supplied to the terminal), creates a synthetic account with no outgoing email, saves test conversations, and removes that account and its conversations afterward. No real student messages, credentials or generated reply text are written to the report. User provisioning is excluded from the latency measurement. `--cold` unloads the configured local model before a run; combine it with `--prepare` to test preparation after unloading. With `--cold` alone, the first run measures a cold start and is excluded from the warm median.

Reports include message-save time, time to response headers, first visible text, completed reply, final save, model loading, prompt evaluation and output tokens per second. The `Server-Timing` response header exposes authentication/history/classifier/audit durations. `prepare` is the total pre-generation elapsed time and includes its nested phases; history and prior-state reads overlap. These durations must not all be added together. For optional duration-only diagnostics, set `CHAT_PERFORMANCE_LOGS=true` on the server or `NEXT_PUBLIC_CHAT_PERFORMANCE=true` for browser console timing, then rebuild/restart as appropriate. No timings are shown in the student interface. See [the measured results](benchmarks/README.md) for the initial comparison.

See the [Ollama chat API](https://docs.ollama.com/api/chat), [model memory guidance](https://docs.ollama.com/faq), and [Qwen3.5 model listing](https://ollama.com/library/qwen3.5).
