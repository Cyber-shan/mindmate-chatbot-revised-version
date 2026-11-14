import { assessSupport } from "../../../../lib/support/assess.ts";
import { analyzeSafety } from "../../../../lib/support/safety.ts";
import { safetyReply } from "../../../../lib/support/responses.ts";
import type { ChatMessage } from "../../../../lib/support/types.ts";
import type { AlgorithmTestResult } from "../../../../lib/support/testing.ts";

const headers = { "Cache-Control": "no-store" };
function isMessage(value: unknown): value is ChatMessage {
  return typeof value === "object" && value !== null && "role" in value && "content" in value
    && (value.role === "user" || value.role === "assistant")
    && typeof value.content === "string" && value.content.trim().length > 0 && value.content.length <= 4000;
}

/** Prototype-only tester: evaluates supplied text, never reads students or writes review events. */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 200_000) return Response.json({ error: "Test input is too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { return Response.json({ error: "Enter a valid JSON test request." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || !("message" in body) || typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000) {
      return Response.json({ error: "Enter a message between 1 and 4000 characters." }, { status: 400, headers });
    }
    const history = "history" in body ? body.history : [];
    if (!Array.isArray(history) || history.length > 40 || !history.every(isMessage)) {
      return Response.json({ error: "History must contain up to 40 user or assistant messages of 1–4000 characters." }, { status: 400, headers });
    }
    const started = performance.now();
    const decision = await assessSupport(body.message, history, { signal: request.signal });
    const result: AlgorithmTestResult = {
      decision,
      safety_signal: analyzeSafety(body.message),
      evaluated_message: body.message,
      history_count: history.length,
      elapsed_ms: Number((performance.now() - started).toFixed(2)),
      response_preview: decision.safety_response_required ? safetyReply(decision) : null,
      test_only: true,
    };
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "The classification test could not finish. Please try again." }, { status: 500, headers });
  }
}
