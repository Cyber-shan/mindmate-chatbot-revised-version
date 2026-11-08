import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConversation, recordDecision } from "../lib/support/store.ts";
import { prioritize } from "../lib/support/policy.ts";

const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
function env(t) {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test", SUPABASE_SERVICE_ROLE_KEY: "server-test", SUPPORT_REVIEW_QUEUE_ENABLED: "true" })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
const request = () => new Request("http://localhost/api/chat", { headers: { Authorization: "Bearer student-test" } });
test("cannot read a different student's conversation", async (t) => {
  env(t);
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "student-one" });
    return Response.json(null);
  });
  await assert.rejects(loadConversation(request(), conversationId, messageId), (error) => error.status === 404);
});
test("canonical history replaces submitted history and carries persisted state", async (t) => {
  env(t);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = String(url);
    if (target.includes("/auth/v1/user")) return Response.json({ id: "student-one" });
    if (target.includes("/messages?")) {
      const query = new URL(target).searchParams;
      assert.match(query.get("select"), /conversations!inner\(user_id\)/);
      assert.equal(query.get("conversations.user_id"), "eq.student-one");
      return Response.json([{ id: messageId, role: "user", content: "I want to hurt myself" }]);
    }
    if (target.includes("/support_events?")) {
      assert.match(new Headers(options.headers).get("authorization"), /server-test/);
      return Response.json({ decision: { state: { highest_level: "HIGH_CONCERN", safety_question_active: true, prior_high_concern: true, prior_immediate_concern: false } } });
    }
    throw new Error("Unexpected URL");
  });
  const context = await loadConversation(request(), conversationId, messageId);
  assert.equal(context.messages[0].content, "I want to hurt myself");
  assert.equal(context.previous.safety_question_active, true);
});

test("history and prior state load concurrently after authentication", { timeout: 5000 }, async (t) => {
  env(t);
  let historyStarted = false;
  let stateStarted = false;
  let releaseHistory;
  let releaseState;
  const historyGate = new Promise((resolve) => { releaseHistory = resolve; });
  const stateGate = new Promise((resolve) => { releaseState = resolve; });
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    const target = String(url);
    if (target.includes("/auth/v1/user")) return Response.json({ id: "student-one" });
    if (target.includes("/messages?")) {
      historyStarted = true;
      releaseState();
      await historyGate;
      return Response.json([{ id: messageId, role: "user", content: "Exam stress" }]);
    }
    if (target.includes("/support_events?")) {
      stateStarted = true;
      releaseHistory();
      await stateGate;
      return Response.json(null);
    }
    throw new Error("Unexpected request: redundant conversation lookup");
  });
  const context = await loadConversation(request(), conversationId, messageId);
  assert.equal(context.messages[0].content, "Exam stress");
  assert.equal(historyStarted && stateStarted, true);
  assert.equal(fetch.mock.callCount(), 3);
});

test("a private state result cannot expose another student's conversation", async (t) => {
  env(t);
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/auth/v1/user")) return Response.json({ id: "student-one" });
    if (String(url).includes("/support_events?")) return Response.json({ decision: { state: { highest_level: "IMMEDIATE_SAFETY" } } });
    return Response.json([]);
  });
  await assert.rejects(loadConversation(request(), conversationId, messageId), (error) => error.status === 404);
});
test("audit write failures do not claim a queued human review", async (t) => {
  env(t);
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "table missing" }, { status: 404 }));
  assert.equal(await recordDecision(prioritize("I want to hurt myself"), { conversationId, messageId }), false);
});
test("audit stores structured metadata without the student's message text", async (t) => {
  env(t);
  t.mock.method(console, "info", () => {});
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.review_status, "pending");
    assert.equal(JSON.stringify(body).includes("I want to hurt myself"), false);
    return Response.json([{ id: "audit-id" }]);
  });
  assert.equal(await recordDecision(prioritize("I want to hurt myself"), { conversationId, messageId }), true);
});
