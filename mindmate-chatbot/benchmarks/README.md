# Local prototype measurements

Measured on 2026-11-08 with the installed Qwen3.5 4B Q4_K_M model, Ollama 0.40.15, about 32 GB system RAM and an NVIDIA RTX 4050 laptop GPU with 6 GB VRAM. Both application versions used a Next.js production build on the same machine, local Supabase, a 2048-token model context and a 256-token output limit.

The benchmark used a synthetic local account and an ordinary schoolwork message. Each request created a new conversation, saved the user message, sent an authenticated chat request, consumed the generated reply and saved it. The temporary account and its conversations were removed after each batch. Account provisioning is outside the reported request timings. These are HTTP measurements; browser rendering and human typing are outside their scope.

| Measurement | Baseline | Optimized, with preparation |
|---|---:|---:|
| First measured reply: time to first text | 14.306 s, cold model | 0.443 s, prepared model |
| Median warm time to first text | 0.172 s, 3 runs | 0.189 s, 4 runs |
| Median warm time to complete reply | 1.146 s | 1.176 s |
| Separate preparation before requests | None | 4.33 s |

The first row compares a cold-start workflow with a prepared-model workflow. Preparation moves model loading and initial prompt processing before the demonstration. Warm reply timings remain comparable; this small sample does not establish a faster model generation rate. Output lengths varied because the existing generation temperature was retained. No smaller model, cloud service or output-length reduction was introduced.

Other verified changes remove the separate conversation-ownership database lookup, load history and optional prior state concurrently after authentication, batch rapid UI tokens into 40 ms updates, and refresh the sidebar without blocking another message. Unit tests verify the reduced request count, concurrent reads, preserved ownership checks and immediate first/final stream updates. The database schema and row-level-security policies were not changed.

Raw duration-only results: [baseline](local-baseline.json) and [optimized](local-optimized.json). The baseline was collected before runtime changes; the optimized batch used the same installed model after preparation.

Reproduce against a running local app:

```powershell
npm.cmd run benchmark:chat -- --saved --cold --runs 4 --output benchmarks/new-cold.json
npm.cmd run benchmark:chat -- --saved --cold --prepare --runs 4 --output benchmarks/new-prepared.json
```

`--cold` unloads the configured local model. Preparation also exercises one generated token against the shared system prompt, rather than only loading the model. These operations do not download a model. The local saved-conversation benchmark needs the Supabase CLI or a terminal-supplied service-role key; keys remain in memory and are not written to reports.

For the actual defense, use [DEMO_SETUP.md](../DEMO_SETUP.md): prepare the model before presenting, then use the production application.
