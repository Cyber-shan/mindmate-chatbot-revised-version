# MindMate local prototype

From this folder, start the complete development setup with:

```powershell
npm.cmd run dev
```

For the initial-defense presentation, use:

```powershell
npm.cmd run demo
```

Both commands also work from `mindmate-chatbot`. The launcher reuses or starts local services, prepares the installed chatbot model, and opens the application server. Follow the address printed in the terminal, normally http://localhost:3000.

`dev` reloads application code while you edit. `demo` creates an optimized build automatically and reuses it until source files, dependencies or build settings change. Keep the terminal open while using MindMate; press Ctrl+C to stop the app. Docker and Supabase remain running for reuse. An Ollama server started by the launcher is stopped with it; an existing Ollama application is left running.

Docker Desktop, Ollama, project dependencies and the configured model must already be installed. The Windows launcher can start Docker Desktop and Ollama when needed. It reports missing software or invalid local configuration rather than resetting data or changing models.

See the [defense guide](mindmate-chatbot/DEMO_SETUP.md) or [chat setup](mindmate-chatbot/CHAT_SETUP.md) for details.
