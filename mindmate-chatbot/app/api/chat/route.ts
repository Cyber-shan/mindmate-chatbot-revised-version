import type { ChatMessage } from "../../../lib/support/types.ts";
import { prioritize } from "../../../lib/support/policy.ts";
import { predict } from "../../../lib/support/classifier.ts";
import { safetyReply, studentSupport } from "../../../lib/support/responses.ts";
import { ConversationError, loadConversation, recordDecision } from "../../../lib/support/store.ts";
import { ChatTimings } from "../../../lib/chat-performance.ts";
import { getOllamaConfig, SYSTEM_PROMPT } from "../../../lib/chat-config.ts";

type OllamaResponse = {
  error?: string;
};

const RESPONSE_TIMEOUT_MS = 60_000;

export async function POST(request: Request) {
  const timings = new ChatTimings();
  const ollama = getOllamaConfig();
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
    const rawBody = await request.text();
    if (rawBody.length > 256_000) {
      cleanup();
      return Response.json({ error: "Conversation is too large." }, { status: 413 });
    }
    let body;
    try { body = JSON.parse(rawBody); }
    catch {
      cleanup();
      return Response.json({ error: "Invalid JSON request." }, { status: 400 });
    }

    if (!body || !Array.isArray(body.messages)) {
      cleanup();
      return Response.json(
        { error: "Messages must be an array." },
        { status: 400 },
      );
    }

    if (body.messages.length > 200 || !body.messages.every(
        (message: ChatMessage) =>
          (message?.role === "user" ||
            message?.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim().length > 0 && message.content.length <= 4000,
      )) {
      cleanup();
      return Response.json({ error: "Use up to 200 messages of at most 4000 characters each." }, { status: 400 });
    }
    let context = null;
    try {
      context = await loadConversation(request, body.conversationId, body.messageId, timings);
    } catch (error) {
      // A storage outage cannot suppress a safety response to the submitted message.
      const submitted = body.messages.at(-1);
      const needsSafety = submitted?.role === "user" && prioritize(submitted.content, body.messages.slice(0, -1)).safety_response_required;
      if (!(error instanceof ConversationError && error.status === 503 && needsSafety)) throw error;
    }
    const messages: ChatMessage[] = context?.messages ?? body.messages.map((message: ChatMessage) => ({ role: message.role, content: message.content.trim() }));

    if (messages.length === 0 || messages.at(-1)?.role !== "user") {
      cleanup();
      return Response.json(
        { error: "The last message must be from the student." },
        { status: 400 },
      );
    }

    const latest = messages.at(-1)!;
    const history = messages.slice(0, -1);
    const localDecision = prioritize(latest.content, history, null, context?.previous);
    // Direct safety signals must not wait for either an ML service or generative model.
    const model = localDecision.level === "IMMEDIATE_SAFETY" ? null : await timings.measure("classifier", () => predict(latest.content, controller.signal));
    const decision = model ? prioritize(latest.content, history, model, context?.previous) : localDecision;
    const queued = await timings.measure("audit", () => recordDecision(decision, context));
    timings.record("prepare");
    const support = studentSupport(decision, queued);
    if (decision.safety_response_required) {
      cleanup();
      return new Response(`${JSON.stringify({ support })}\n${JSON.stringify({ message: { content: safetyReply(decision) }, done: true })}\n`, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no", "Server-Timing": timings.header() },
      });
    }

    // Safety uses full validated history; only generation receives the smaller budget.
    const recentMessages: ChatMessage[] = [];
    let remainingCharacters = 6000;
    for (let index = messages.length - 1; index >= Math.max(0, messages.length - 8); index -= 1) {
      const message = messages[index];
      if (message.content.length > remainingCharacters) break;
      recentMessages.unshift(message);
      remainingCharacters -= message.content.length;
    }

    const ollamaResponse = await timings.measure("ollama_headers", () => fetch(`${ollama.url}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ollama.model,
        stream: true,
        think: false,
        keep_alive: ollama.keepAlive,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + (decision.level === "MODERATE" ? "\nOffer structured support and suggest a trusted person or counselor when useful. Do not describe any classification or probability." : "") },
          ...recentMessages,
        ],
        options: {
          num_ctx: ollama.contextTokens,
          num_predict: ollama.outputTokens,
          temperature: 0.7,
        },
      }),
      signal: controller.signal,
    }));
    if (process.env.CHAT_PERFORMANCE_LOGS === "true") console.info("chat_timing", timings.snapshot());

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
      start(streamController) {
        streamController.enqueue(encoder.encode(`${JSON.stringify({ support })}\n`));
      },
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
        "Server-Timing": timings.header(),
      },
    });
  } catch (error) {
    cleanup();
    if (error instanceof ConversationError) return Response.json({ error: error.message }, { status: error.status });
    const timedOut =
      controller.signal.reason?.name === "TimeoutError";

    console.error("Chat API request failed.");

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
