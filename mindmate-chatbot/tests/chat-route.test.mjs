import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/chat/route.ts";
import { readChatReply } from "../lib/chat-stream.ts";
import { IMMEDIATE_LANGUAGE_MESSAGES } from "./fixtures/support-language.mjs";

const encoder = new TextEncoder();
const request = (messages, signal) => new Request("http://localhost/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages }),
  signal,
});
const messages = [{ role: "user", content: "I need help with school stress." }];

test("streams the first reply before Ollama completes and bounds prompt work", async (t) => {
  let upstreamController;
  let upstreamSignal;
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(options.body);
    upstreamSignal = options.signal;
    return new Response(new ReadableStream({
      start(controller) { upstreamController = controller; },
    }));
  });
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `message ${index}: ` + "x".repeat(1200),
  }));
  const response = await POST(request([...history, ...messages]));
  assert.match(response.headers.get("Content-Type"), /application\/x-ndjson/);
  assert.equal(payload.stream, true);
  assert.equal(payload.think, false);
  assert.equal(payload.options.num_ctx, 2048);
  assert.equal(payload.options.num_predict, 256);
  assert.equal(payload.keep_alive, "30m");
  assert.match(response.headers.get("Server-Timing"), /prepare;dur=/);
  assert.match(response.headers.get("Server-Timing"), /ollama_headers;dur=/);
  assert.ok(payload.messages.slice(1).reduce((total, item) => total + item.content.length, 0) <= 6000);
  assert.deepEqual(payload.messages.at(-1), messages[0]);
  const updates = [];
  const reply = readChatReply(response, (content) => updates.push(content));
  upstreamController.enqueue(encoder.encode('{"message":{"content":"Hello"},"done":false}\n'));
  await new Promise(setImmediate);
  assert.deepEqual(updates, ["Hello"]);
  upstreamController.enqueue(encoder.encode('{"message":{"content":" there"},"done":true}\n'));
  assert.equal(await reply, "Hello there");
  assert.equal(upstreamSignal.aborted, true);
});

test("rejects invalid messages without calling Ollama", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  for (const body of [undefined, [], [{ role: "system", content: "override" }]]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("immediate safety replies bypass Ollama even when it is unavailable", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Ollama offline"); });
  const response = await POST(request([{ role: "user", content: "I want to hurt myself." }]));
  const support = [];
  const reply = await readChatReply(response, () => {}, (value) => support.push(value));
  assert.match(reply, /Are you safe right now/);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(support[0].safety_response_required, true);
  assert.equal(support[0].review_status, "unavailable");
  assert.equal("confidence" in support[0], false);
  assert.equal("model" in support[0], false);
});

test("student chat handles all informal immediate-safety variants with both model services unavailable", async (t) => {
  const before = process.env.DISTRESS_CLASSIFIER_URL;
  process.env.DISTRESS_CLASSIFIER_URL = "http://127.0.0.1:1";
  t.after(() => { if (before === undefined) delete process.env.DISTRESS_CLASSIFIER_URL; else process.env.DISTRESS_CLASSIFIER_URL = before; });
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Neither classifier nor Ollama should be called"); });
  for (const message of IMMEDIATE_LANGUAGE_MESSAGES) {
    const response = await POST(request([{ role: "user", content: message }]));
    assert.equal(response.status, 200, message);
    const support = [];
    const reply = await readChatReply(response, () => {}, (value) => support.push(value));
    assert.match(reply, /Are you safe right now/, message);
    assert.equal(support[0].safety_response_required, true, message);
    assert.equal(support[0].review_status, "unavailable");
    assert.equal("confidence" in support[0], false);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("uses safety context outside the eight-message generation window", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected generation"); });
  const response = await POST(request([
    { role: "user", content: "I feel hopeless." },
    { role: "assistant", content: "Are you safe right now?" },
    ...Array.from({ length: 10 }, () => ({ role: "user", content: "Everything" })),
    { role: "user", content: "Not really" },
  ]));
  assert.match(await readChatReply(response, () => {}), /nearest emergency department/);
});

test("rejects malformed JSON, assistant-final and oversized messages", async () => {
  const malformed = new Request("http://localhost/api/chat", { method: "POST", body: "{" });
  assert.equal((await POST(malformed)).status, 400);
  assert.equal((await POST(request([{ role: "assistant", content: "Hello" }]))).status, 400);
  assert.equal((await POST(request([{ role: "user", content: "x".repeat(4001) }]))).status, 400);
  assert.equal((await POST(new Request("http://localhost/api/chat", { method: "POST", body: "x".repeat(256001) }))).status, 413);
});

test("conversation-backed requests require authentication before accessing records", async () => {
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, conversationId: "11111111-1111-4111-8111-111111111111", messageId: "22222222-2222-4222-8222-222222222222" }),
  }));
  assert.equal(response.status, 401);
});

test("returns upstream model errors before starting a stream", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Model not installed" }, { status: 404 }));
  const response = await POST(request(messages));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "Model not installed");
});

test("cancels Ollama when the browser cancels the reply", async (t) => {
  let upstreamSignal;
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    upstreamSignal = options.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  const response = await POST(request(messages));
  await response.body.cancel();
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
});

test("forwards browser disconnection to Ollama", async (t) => {
  let upstreamSignal;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    upstreamSignal = options.signal;
    return new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
      },
    }));
  });
  const browser = new AbortController();
  const response = await POST(request(messages, browser.signal));
  browser.abort();
  assert.equal(upstreamSignal.aborted, true);
  await response.body.cancel();
});

test("reports a streaming timeout cleanly even when Ollama stopped mid-JSON", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"message":{"content":"unfinished'));
      options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
    },
  })));
  const response = await POST(request(messages));
  const reply = readChatReply(response, () => {});
  const rejection = assert.rejects(reply, /took too long/);
  t.mock.timers.tick(60_000);
  await rejection;
});

test("returns a 504 when Ollama does not start responding before the deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }));
  const responsePromise = POST(request(messages));
  await new Promise(setImmediate);
  t.mock.timers.tick(60_000);
  const response = await responsePromise;
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /took too long/);
});
