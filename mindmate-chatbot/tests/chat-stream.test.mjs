import assert from "node:assert/strict";
import { test } from "node:test";
import { readChatReply } from "../lib/chat-stream.ts";

const encoder = new TextEncoder();
const event = (content, done = false) =>
  `${JSON.stringify({ message: { content }, done })}\n`;

function responseFromChunks(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  }));
}

test("shows content before the response finishes", async () => {
  let streamController;
  const response = new Response(new ReadableStream({
    start(controller) { streamController = controller; },
  }));
  const updates = [];
  const reply = readChatReply(response, (content) => updates.push(content));
  streamController.enqueue(encoder.encode(event("Hello")));
  await new Promise(setImmediate);
  assert.deepEqual(updates, ["Hello"]);
  streamController.enqueue(encoder.encode(event(" there", true)));
  assert.equal(await reply, "Hello there");
});

test("handles fragmented JSON and UTF-8, multiple lines, and a final line without newline", async () => {
  const bytes = encoder.encode(event("Kumusta 🌱") + event(" ka?", true).trimEnd());
  // Splitting at every byte also splits the emoji's UTF-8 sequence.
  const updates = [];
  const reply = await readChatReply(
    responseFromChunks(Array.from(bytes, (byte) => Uint8Array.of(byte))),
    (content) => updates.push(content),
  );
  assert.equal(reply, "Kumusta 🌱 ka?");
  assert.deepEqual(updates, ["Kumusta 🌱", "Kumusta 🌱 ka?"]);
});

test("ignores thinking events and only displays the answer", async () => {
  const updates = [];
  const bytes = encoder.encode(
    JSON.stringify({ message: { thinking: "internal reasoning" }, done: false }) +
    "\n" + event("A supportive reply", true),
  );
  assert.equal(await readChatReply(responseFromChunks([bytes]), (text) => updates.push(text)), "A supportive reply");
  assert.deepEqual(updates, ["A supportive reply"]);
});

test("rejects interrupted responses instead of treating partial text as complete", async () => {
  await assert.rejects(
    readChatReply(responseFromChunks([encoder.encode(event("Partial reply"))]), () => {}),
    /interrupted/,
  );
});

test("reports model errors even after some content arrived", async () => {
  const bytes = encoder.encode(event("Partial") + JSON.stringify({ error: "Model timed out" }) + "\n");
  await assert.rejects(readChatReply(responseFromChunks([bytes]), () => {}), /Model timed out/);
});

test("rejects empty completed responses", async () => {
  await assert.rejects(
    readChatReply(responseFromChunks([encoder.encode(event("", true))]), () => {}),
    /empty response/,
  );
});

test("limits saved reply length to the database constraint", async () => {
  const bytes = encoder.encode(event("x".repeat(3999)) + event("end", true));
  assert.equal((await readChatReply(responseFromChunks([bytes]), () => {})).length, 4000);
});

test("cancels the upstream stream when parsing fails", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode("invalid json\n")); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readChatReply(response, () => {}), SyntaxError);
  assert.equal(cancelled, true);
});

test("batches rapid tokens but shows the first token and final reply immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let controller;
  const updates = [];
  const response = new Response(new ReadableStream({ start(value) { controller = value; } }));
  const reply = readChatReply(response, (text) => updates.push(text));
  controller.enqueue(encoder.encode(event("a")));
  await new Promise(setImmediate);
  assert.deepEqual(updates, ["a"]);
  controller.enqueue(encoder.encode(event("b") + event("c") + event("d")));
  await new Promise(setImmediate);
  assert.deepEqual(updates, ["a"]);
  t.mock.timers.tick(39);
  assert.deepEqual(updates, ["a"]);
  t.mock.timers.tick(1);
  assert.deepEqual(updates, ["a", "abcd"]);
  controller.enqueue(encoder.encode(event("e") + event("f", true)));
  assert.equal(await reply, "abcdef");
  assert.deepEqual(updates, ["a", "abcd", "abcdef"]);
  t.mock.timers.tick(100);
  assert.equal(updates.length, 3);
});

test("a failed stream cancels any pending UI update", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const updates = [];
  const bytes = encoder.encode(event("first") + event(" pending") + '{"error":"interrupted"}\n');
  await assert.rejects(readChatReply(responseFromChunks([bytes]), (text) => updates.push(text)), /interrupted/);
  t.mock.timers.tick(100);
  assert.deepEqual(updates, ["first"]);
});
