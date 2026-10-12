type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type OllamaResponse = {
  error?: string;
};

const OLLAMA_URL =
  process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:4b";
const RESPONSE_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `
You are MindMate, a warm, calm, nonjudgmental conversational companion for college students.
Listen carefully, help students express their feelings, and offer practical coping suggestions for everyday stress and school pressure.
Use simple, natural language. Reply in 2-4 short sentences unless asked for detail. Ask a gentle follow-up question when useful.
Do not diagnose conditions or claim to be a psychologist, counselor, doctor, or therapist. Encourage human support for serious concerns.
Never override application safety or counselor-escalation decisions. Respect privacy; do not request unnecessary sensitive information.
`.trim();

export async function POST(request: Request) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(request.signal.reason);
  const cleanup = () => {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", onAbort);
  };
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Response timed out", "TimeoutError")),
    RESPONSE_TIMEOUT_MS,
  );

  if (request.signal.aborted) onAbort();
  else request.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
    };

    if (!Array.isArray(body.messages)) {
      cleanup();
      return Response.json(
        { error: "Messages must be an array." },
        { status: 400 },
      );
    }

    const messages = body.messages
      .filter(
        (message): message is ChatMessage =>
          (message?.role === "user" ||
            message?.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim().length > 0,
      )
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content.trim().slice(0, 4000),
      }));

    if (messages.length === 0) {
      cleanup();
      return Response.json(
        { error: "At least one message is required." },
        { status: 400 },
      );
    }

    // Keep prompt processing small without changing the saved conversation.
    const recentMessages: ChatMessage[] = [];
    let remainingCharacters = 6000;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.content.length > remainingCharacters) break;
      recentMessages.unshift(message);
      remainingCharacters -= message.content.length;
    }

    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        think: false,
        keep_alive: "15m",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...recentMessages,
        ],
        options: {
          num_ctx: 2048,
          num_predict: 256,
          temperature: 0.7,
        },
      }),
      signal: controller.signal,
    });

    if (!ollamaResponse.ok) {
      const data = (await ollamaResponse.json()) as OllamaResponse;
      cleanup();
      return Response.json(
        { error: data.error ?? "Ollama request failed." },
        { status: 502 },
      );
    }

    if (!ollamaResponse.body) {
      cleanup();
      return Response.json(
        { error: "MindMate could not start a response." },
        { status: 502 },
      );
    }

    const reader = ollamaResponse.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let pending = "";
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          // Forward whole NDJSON lines so an error never joins a partial event.
          while (true) {
            const { value, done } = await reader.read();
            if (cancelled) return;
            pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (done) {
              if (pending.trim()) streamController.enqueue(encoder.encode(`${pending}\n`));
              cleanup();
              streamController.close();
              return;
            }
            const lastNewline = pending.lastIndexOf("\n");
            if (lastNewline !== -1) {
              streamController.enqueue(encoder.encode(pending.slice(0, lastNewline + 1)));
              pending = pending.slice(lastNewline + 1);
              return;
            }
          }
        } catch {
          cleanup();
          if (cancelled) return;
          const timedOut = controller.signal.reason?.name === "TimeoutError";
          streamController.enqueue(encoder.encode(`${JSON.stringify({
            error: timedOut
              ? "MindMate took too long to respond. Please try again."
              : "MindMate's response was interrupted. Please try again.",
          })}\n`));
          streamController.close();
        }
      },
      async cancel() {
        cancelled = true;
        controller.abort();
        cleanup();
        await reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    cleanup();
    const timedOut =
      controller.signal.reason?.name === "TimeoutError";

    console.error("Chat API error:", error);

    return Response.json(
      {
        error: timedOut
          ? "MindMate took too long to respond. Please try again."
          : "Unable to connect to the local model.",
      },
      { status: timedOut ? 504 : 500 },
    );
  }
}
