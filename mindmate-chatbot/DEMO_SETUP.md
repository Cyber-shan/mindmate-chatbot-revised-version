# Initial-defense demo

This prototype uses the installed **Qwen3.5 4B** model through local Ollama. No hosted AI provider or model download is required by these optimizations.

## Prepare before presenting

Open Docker Desktop and Ollama. From this project directory:

```powershell
npx.cmd supabase start
npm.cmd run build
npm.cmd run warmup:chat
npm.cmd run start
```

Wait for the warm-up to report `"ready":true` before starting the chat demonstration. Use the production build for the defense to avoid development-time compilation during the presentation. Build again only when code or build-time environment settings change.

Open http://localhost:3000/chat and sign in with your prototype account. This project's Supabase Studio is at http://127.0.0.1:55123; its API is at http://127.0.0.1:55121. The model runs locally at http://127.0.0.1:11434.

The model stays ready for 30 minutes after use. Repeat `npm.cmd run warmup:chat` after restarting Ollama or after a longer idle period. Keep the laptop plugged in for consistent performance. Other GPU workloads and laptop power/thermal conditions can affect speed.

## Verify the demonstration

- Start a new chat and try an ordinary schoolwork concern; text should stream into the reply.
- Confirm the completed messages remain in history after reopening the conversation.
- In a fresh conversation, use a synthetic high-concern example and check the fixed safety check-in.
- Run `node scripts/verify-support-runtime.mjs` while the app is running to check the three dedicated safety paths without database records.

The runtime check can target another port: `node scripts/verify-support-runtime.mjs http://127.0.0.1:3001`. Safety replies remain independent of generative-model availability. Rules are draft support-prioritization rules; do not describe this prototype as a clinically validated diagnostic system.

For measurements, use `npm.cmd run benchmark:chat -- --saved --prepare --runs 4`. This creates and cleans up synthetic local test records, and measures saving, authenticated API handling and reply generation. See [CHAT_SETUP.md](CHAT_SETUP.md) for benchmark flags and optional timing diagnostics.
