# Local chatbot

MindMate defaults to **Qwen3.5 4B**, served by Ollama. Install the model on the machine running Ollama:

```powershell
ollama pull qwen3.5:4b
```

The Next.js server connects to `http://127.0.0.1:11434` by default. To change the server or model, set these variables in `.env.local` and restart Next.js:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
```

Replies stream into the chat bubble as text is generated. Only completed replies are saved to Supabase. Starting a new chat or opening another conversation cancels the current generation.

To reduce latency and memory use, the API disables thinking, uses a 2,048-token context, sends at most eight recent messages within a 6,000-character budget, and generates at most 256 tokens. Older messages remain in the database. The model stays loaded for 15 minutes after use. Generation times out after 60 seconds and displays an error instead of leaving the progress indicator running indefinitely. Response speed still depends on hardware, prompt length, and whether the model needs to load.

Run the stream and route tests with Node.js 24:

```powershell
npm.cmd run test:chat
```

With the development server running, measure time to first visible text and total reply time:

```powershell
npm.cmd run benchmark:chat
```

The benchmark calls the chat API directly and does not create database records. It can also target another local port:

```powershell
npm.cmd run benchmark:chat -- http://127.0.0.1:3001/api/chat
```

See the [Ollama chat API](https://docs.ollama.com/api/chat), [model memory guidance](https://docs.ollama.com/faq), and [Qwen3.5 model listing](https://ollama.com/library/qwen3.5).
