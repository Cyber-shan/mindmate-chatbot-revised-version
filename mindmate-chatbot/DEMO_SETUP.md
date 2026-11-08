# Initial-defense demo

This prototype uses the installed **Qwen3.5 4B** model through local Ollama. No hosted AI provider or model download is required by these optimizations.

## Prepare before presenting

From either `Mindmate-Project` or `mindmate-chatbot`, run this one command:

```powershell
npm.cmd run demo
```

The launcher checks the local services, starts Docker Desktop on Windows when needed, starts/reuses Supabase and Ollama, and prepares the installed model. It creates the production build when needed, then starts MindMate. Unchanged builds are reused; source, dependency and build-setting changes are detected automatically. Wait for the terminal to show the application address before presenting.

For everyday editing, use `npm.cmd run dev` instead. This performs the same service preparation and starts development mode with automatic code reloading. There is no separate build or warm-up command to remember.

Docker Desktop must have completed its initial installation/setup, and Ollama, project dependencies and the configured Qwen model must already be installed. The launcher reuses running services, so they do not need to be opened manually each time. Existing environment settings are read from `mindmate-chatbot/.env.local`.

Open http://localhost:3000/chat and sign in with your prototype account. This project's Supabase Studio is at http://127.0.0.1:55123; its API is at http://127.0.0.1:55121. The model runs locally at http://127.0.0.1:11434.

The model stays ready for 30 minutes after use. Each launcher run prepares it automatically. The standalone `npm.cmd run warmup:chat` remains available if you leave the app open but let the model go idle before presenting. Keep the laptop plugged in for consistent performance. Other GPU workloads and laptop power/thermal conditions can affect speed.

Press Ctrl+C to stop the app. The launcher also stops an Ollama server it started itself. Existing Ollama sessions, Docker Desktop and Supabase containers are kept available for reuse. Database volumes are preserved.

## Verify the demonstration

- Start a new chat and try an ordinary schoolwork concern; text should stream into the reply.
- Confirm the completed messages remain in history after reopening the conversation.
- In a fresh conversation, use a synthetic high-concern example and check the fixed safety check-in.
- Run `node scripts/verify-support-runtime.mjs` while the app is running to check the three dedicated safety paths without database records.

The runtime check can target another port: `node scripts/verify-support-runtime.mjs http://127.0.0.1:3001`. Safety replies remain independent of generative-model availability. Rules are draft support-prioritization rules; do not describe this prototype as a clinically validated diagnostic system.

For measurements, use `npm.cmd run benchmark:chat -- --saved --prepare --runs 4`. This creates and cleans up synthetic local test records, and measures saving, authenticated API handling and reply generation. See [CHAT_SETUP.md](CHAT_SETUP.md) for benchmark flags and optional timing diagnostics.
