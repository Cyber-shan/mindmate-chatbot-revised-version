import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/chat/support/route.ts";
import { loadSupportHistory } from "../lib/support/store.ts";

const conversationId = "11111111-1111-4111-8111-111111111111";
const foreignConversationId = "99999999-9999-4999-8999-999999999999";
const messageId = "22222222-2222-4222-8222-222222222222";
const assistantId = "33333333-3333-4333-8333-333333333333";
const oldMessageId = "44444444-4444-4444-8444-444444444444";
const secondMessageId = "55555555-5555-4555-8555-555555555555";
const flags = { safety_response_required: true, requires_human_review: true };

function env(t, overrides = {}) {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
    SUPABASE_SERVICE_ROLE_KEY: "server-test",
    SUPPORT_REVIEW_QUEUE_ENABLED: "true", MINDMATE_COUNTRY: undefined,
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}

function request({ id = conversationId, authorization = "Bearer student-test" } = {}) {
  return new Request(`http://localhost/api/chat/support?conversation_id=${encodeURIComponent(id)}`, {
    headers: authorization === null ? {} : { Authorization: authorization },
  });
}

function backend(t, overrides = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(String(input));
    const authorization = new Headers(options?.headers).get("authorization");
    calls.push({ url, authorization, options });
    if (url.pathname === "/auth/v1/user") {
      return overrides.auth?.() ?? Response.json({ id: "student-one" });
    }
    if (url.pathname === "/rest/v1/conversations") {
      assert.equal(authorization, "Bearer student-test");
      assert.equal(url.searchParams.get("id"), `eq.${conversationId}`);
      assert.equal(url.searchParams.get("user_id"), "eq.student-one");
      return overrides.ownership?.() ?? Response.json({ id: conversationId });
    }
    if (url.pathname === "/rest/v1/messages") {
      assert.equal(authorization, "Bearer student-test");
      assert.equal(url.searchParams.get("conversation_id"), `eq.${conversationId}`);
      assert.equal(url.searchParams.get("select"), "id,role");
      assert.equal(url.searchParams.get("limit"), "200");
      return overrides.history?.() ?? Response.json([
        { id: assistantId, role: "assistant" }, { id: messageId, role: "user" },
      ]);
    }
    if (url.pathname === "/rest/v1/support_events") {
      assert.equal(authorization, "Bearer server-test");
      assert.equal(url.searchParams.get("conversation_id"), `eq.${conversationId}`);
      assert.equal(url.searchParams.get("message_id"), `in.(${messageId})`);
      assert.equal(url.searchParams.get("limit"), "200");
      assert.equal(url.searchParams.get("select"), "conversation_id,message_id,decision,review_status");
      return overrides.audit?.() ?? Response.json([
        { conversation_id: conversationId, message_id: messageId, decision: flags, review_status: "pending" },
      ]);
    }
    assert.fail(`Unexpected backend request: ${url.pathname}`);
  });
  return calls;
}

test("support history rejects invalid IDs and missing/empty bearer tokens before requesting storage", async (t) => {
  env(t);
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("Invalid input must not use storage"));
  for (const id of ["", "invalid", "null"]) assert.equal((await GET(request({ id }))).status, 400);
  for (const authorization of [null, "Bearer ", "Basic secret", "Bearer token extra"]) {
    assert.equal((await GET(request({ authorization }))).status, 401);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("support history verifies JWTs and never requests private rows after an expired session", async (t) => {
  env(t);
  const calls = backend(t, { auth: () => Response.json({ message: "Invalid JWT", code: "bad_jwt" }, { status: 401 }) });
  const response = await GET(request());
  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("auth or public storage outages produce a bounded unavailable response", async (t) => {
  env(t);
  const calls = backend(t, { auth: () => Response.json({ message: "Auth unavailable" }, { status: 503 }) });
  assert.equal((await GET(request())).status, 503);
  assert.ok(calls.every(({ url }) => url.pathname === "/auth/v1/user"));
});

test("support history cannot read another student's conversation even when audit access is configured", async (t) => {
  env(t);
  const calls = backend(t, { ownership: () => Response.json([]) });
  const response = await GET(request());
  assert.equal(response.status, 404);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ authorization }) => authorization !== "Bearer server-test"));
});

test("missing private audit configuration returns no invented notices after ownership is checked", async (t) => {
  env(t, { SUPABASE_SERVICE_ROLE_KEY: undefined });
  const calls = backend(t);
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: false, messages: [] });
  assert.equal(calls.length, 2);
});

test("missing audit tables and unavailable audit reads do not claim queued review", async (t) => {
  env(t);
  backend(t, { audit: () => Response.json({ message: "Table unavailable" }, { status: 404 }) });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: false, messages: [] });
});

test("successful history hydration exposes only restricted student support", async (t) => {
  env(t);
  const calls = backend(t, { audit: () => Response.json([
    { conversation_id: conversationId, message_id: messageId, review_status: "pending", decision: {
      ...flags, level: "IMMEDIATE_SAFETY", confidence: 0.98, model_version: "private-version",
      rules: ["private-rule"], state: { highest_level: "IMMEDIATE_SAFETY" },
      resources: [{ label: "untrusted", href: "javascript:alert(1)" }],
    } },
  ]) });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    available: true, messages: [{ message_id: messageId, support: {
      safety_response_required: true, review_status: "queued", resources: [],
    } }],
  });
  assert.equal(calls.length, 4);
  const privateIndex = calls.findIndex(({ authorization }) => authorization === "Bearer server-test");
  assert.equal(privateIndex, 3, "Private rows are queried only after ownership and canonical message IDs");
});

test("only canonical user-message IDs from the requested conversation can receive support", async (t) => {
  env(t);
  backend(t, { audit: () => Response.json([
    { conversation_id: foreignConversationId, message_id: messageId, decision: flags, review_status: "pending" },
    { conversation_id: conversationId, message_id: assistantId, decision: flags, review_status: "pending" },
    { conversation_id: conversationId, message_id: oldMessageId, decision: flags, review_status: "pending" },
    { conversation_id: conversationId, message_id: secondMessageId, decision: flags, review_status: "pending" },
    { conversation_id: conversationId, message_id: messageId, decision: flags, review_status: "unconfigured" },
    { conversation_id: conversationId, message_id: messageId, decision: flags, review_status: "pending" },
  ]) });
  const result = await loadSupportHistory(request(), conversationId);
  assert.deepEqual(result, { available: true, messages: [{ message_id: messageId, support: {
    safety_response_required: true, review_status: "unavailable", resources: [],
  } }] });
});

test("malformed decisions or unknown queue statuses are omitted without leaking raw metadata", async (t) => {
  env(t);
  const invalid = [null, [], {}, { safety_response_required: "true", requires_human_review: true },
    { safety_response_required: true, requires_human_review: false }];
  const fetch = backend(t, { audit: () => Response.json([
    ...invalid.map((decision) => ({ conversation_id: conversationId, message_id: messageId, decision, review_status: "pending" })),
    { conversation_id: conversationId, message_id: messageId, decision: flags, review_status: "unknown" },
  ]) });
  assert.deepEqual(await loadSupportHistory(request(), conversationId), { available: true, messages: [] });
  assert.equal(fetch.length, 4);
});

for (const status of ["reviewed", "resolved", "false_positive", "unconfigured"]) {
  test(`a ${status} event does not claim a pending review`, async (t) => {
    env(t);
    backend(t, { audit: () => Response.json([{ conversation_id: conversationId, message_id: messageId, decision: flags, review_status: status }]) });
    const result = await loadSupportHistory(request(), conversationId);
    assert.equal(result.messages[0].support.review_status, "unavailable");
  });
}

test("queue configuration must still be enabled before a pending event claims queued review", async (t) => {
  env(t, { SUPPORT_REVIEW_QUEUE_ENABLED: "false" });
  backend(t);
  const result = await loadSupportHistory(request(), conversationId);
  assert.equal(result.messages[0].support.review_status, "unavailable");
});

test("ordinary support restores a not-required notice without invented resources", async (t) => {
  env(t);
  backend(t, { audit: () => Response.json([{ conversation_id: conversationId, message_id: messageId,
    decision: { safety_response_required: false, requires_human_review: false }, review_status: "not_required" }]) });
  const result = await loadSupportHistory(request(), conversationId);
  assert.deepEqual(result.messages, [{ message_id: messageId, support: {
    safety_response_required: false, review_status: "not_required", resources: [],
  } }]);
});

test("a canonical history outage is reported without reading audit rows", async (t) => {
  env(t);
  const calls = backend(t, { history: () => Response.json({ message: "Storage unavailable" }, { status: 503 }) });
  assert.equal((await GET(request())).status, 503);
  assert.ok(calls.every(({ authorization }) => authorization !== "Bearer server-test"));
});

test("empty history avoids private lookups", async (t) => {
  env(t);
  const fetch = t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "student-one" });
    if (url.pathname === "/rest/v1/conversations") return Response.json({ id: conversationId });
    if (url.pathname === "/rest/v1/messages") return Response.json([]);
    assert.fail("No eligible user messages means no audit query");
  });
  assert.deepEqual(await loadSupportHistory(request(), conversationId), { available: true, messages: [] });
  assert.equal(fetch.mock.callCount(), 3);
});
