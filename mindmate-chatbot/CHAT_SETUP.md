# Local chatbot

Start the complete local setup from the main project folder or this folder with `npm.cmd run dev`. For an optimized defense presentation, use `npm.cmd run demo`. These commands prepare the required services and model automatically; `demo` also builds when source or build settings have changed. See [DEMO_SETUP.md](DEMO_SETUP.md).

The chat API runs support-priority classification before generation to identify recommended counselor attention from the available message and conversation context. Its categories are **Low priority**, **Moderate priority**, **High priority**, and **Immediate attention**. See [SUPPORT_SETUP.md](SUPPORT_SETUP.md) for category meanings, safety rules, the optional TF-IDF/Logistic Regression service, clinician-review requirements, and private review-queue configuration.

MindMate defaults to **Qwen3 4B Instruct** (`qwen3:4b-instruct`, Q4_K_M, about 2.5 GB to download), served by Ollama. Install the model on the machine running Ollama:

```powershell
ollama pull qwen3:4b-instruct
```

The Next.js server connects to `http://127.0.0.1:11434` by default. To change the server or model, set these variables in `.env.local` and restart Next.js:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b-instruct
OLLAMA_KEEP_ALIVE=5m
```

Replies stream into the chat bubble as text is generated. Only completed replies are saved to Supabase. Starting a new chat or opening another conversation cancels the current generation.

To reduce latency and memory use, the API disables thinking, uses a 2,048-token context, sends at most eight recent messages within a 6,000-character budget, and generates at most 256 tokens, and limits CPU work to four threads. Older messages remain in the database. The model stays loaded for five minutes after use, configurable through `OLLAMA_KEEP_ALIVE`. Generation times out after 60 seconds and displays an error instead of leaving the progress indicator running indefinitely. Response speed still depends on hardware, prompt length, and whether the model needs to load.

The one-command launcher prepares the model automatically. To prepare it separately for diagnostics or after a long idle period:

```powershell
npm.cmd run warmup:chat
```

This runs a neutral, one-token warm-up against the same local model, system prompt and context configuration as the chat route. It creates no database records and downloads no model. Model preparation takes place before the student sends a message; it does not increase the model's underlying token-generation speed. Keeping the model ready occupies GPU memory. Run the warm-up again after restarting Ollama or leaving the model idle past its keep-alive period. See [DEMO_SETUP.md](DEMO_SETUP.md) for the defense checklist.

The first token is displayed as soon as it arrives. Subsequent updates are batched every 40 milliseconds to reduce rendering work, and the completed reply is flushed immediately. The server loads ownership-checked history with one query and reads optional prior safety state in parallel. Audit writing and normal response generation also start in parallel. History-sidebar refreshes run after saving without blocking the next message.

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

See the [Ollama chat API](https://docs.ollama.com/api/chat), [model memory guidance](https://docs.ollama.com/faq), and [Qwen3 4B Instruct model listing](https://ollama.com/library/qwen3:4b-instruct).

## Context-aware replies and laptop performance

Ordinary questions receive direct, practical answers. Emotional disclosures receive empathy appropriate to the message. Independent safety rules and genuine unresolved safety context still select fixed safety responses. The unvalidated synthetic classifier skips ordinary messages and cannot independently initiate a crisis response; see SUPPORT_SETUP.md. The assistant has no live news feed.

On the tested Ryzen 5 7535HS / RTX 4050 Laptop 6 GB / 32 GB machine, five synthetic prompts on November 15, 2026 measured about 52 output tokens/second for this model versus 46 for qwen3.5:4b. Warm model-only first text was about 49-56 ms versus 188-210 ms. These are a small local comparison with identical 2,048-token context, thinking disabled and four CPU threads; they exclude hosted database/network overhead. The first cold loads took about 14 and 9 seconds respectively. The selected model occupied about 2.9 GB of dedicated GPU memory at this context. Model choice improves resource use and streaming speed but does not guarantee factual correctness.

The five-minute idle timeout releases model memory sooner; the next cold request needs to load it again. Warm-up happens automatically through the launcher. Keep the 9B model unloaded while chatting to avoid competing for dedicated VRAM.
