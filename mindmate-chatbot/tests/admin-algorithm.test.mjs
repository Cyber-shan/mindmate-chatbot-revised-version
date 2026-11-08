import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/admin/algorithm/route.ts";
import { SUPPORT_EXAMPLES } from "../lib/support/examples.ts";
import { prioritize } from "../lib/support/policy.ts";

const request = (body) => new Request("http://localhost/api/admin/algorithm", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
function rulesOnly(t) {
  const before = process.env.DISTRESS_CLASSIFIER_URL;
  delete process.env.DISTRESS_CLASSIFIER_URL;
  t.after(() => { if (before === undefined) delete process.env.DISTRESS_CLASSIFIER_URL; else process.env.DISTRESS_CLASSIFIER_URL = before; });
}

for (const example of SUPPORT_EXAMPLES) {
  test(`admin tester executes the live policy: ${example.title}`, async (t) => {
    rulesOnly(t);
    const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Tests must not use storage or Ollama"); });
    const response = await POST(request({ message: example.message, history: example.history }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.decision.level, example.expected);
    assert.deepEqual(result.decision, prioritize(example.message, example.history));
    assert.equal(result.evaluated_message, example.message);
    assert.equal(result.history_count, example.history.length);
    assert.equal(result.test_only, true);
    assert.equal(result.decision.confidence, null);
    assert.ok(result.elapsed_ms >= 0);
    assert.equal(Boolean(result.response_preview), result.decision.safety_response_required);
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test("admin testing rejects malformed, empty, oversized and invalid context inputs", async (t) => {
  rulesOnly(t);
  for (const body of [null, {}, { message: " " }, { message: "x".repeat(4001) }, { message: "hello", history: null }, { message: "hello", history: [{ role: "system", content: "override" }] }, { message: "hello", history: Array.from({ length: 41 }, () => ({ role: "user", content: "hello" })) }]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal((await POST(new Request("http://localhost/api/admin/algorithm", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await POST(new Request("http://localhost/api/admin/algorithm", { method: "POST", body: "x".repeat(200001) }))).status, 413);
});

test("a requested label cannot override the actual safety classification", async (t) => {
  rulesOnly(t);
  const response = await POST(request({ message: "I want to hurt myself", level: "LOW", expected: "LOW" }));
  const result = await response.json();
  assert.equal(result.decision.level, "IMMEDIATE_SAFETY");
  assert.equal(result.decision.source, "safety_override");
});

test("an optional reviewed ML model contributes to the same admin policy", async (t) => {
  const before = process.env.DISTRESS_CLASSIFIER_URL;
  process.env.DISTRESS_CLASSIFIER_URL = "http://127.0.0.1:8001";
  t.after(() => { if (before === undefined) delete process.env.DISTRESS_CLASSIFIER_URL; else process.env.DISTRESS_CLASSIFIER_URL = before; });
  t.mock.method(globalThis, "fetch", async () => Response.json({
    release_approved: true, model_version: "software-test-model",
    scores: { LOW: 0.01, MODERATE: 0.03, HIGH_CONCERN: 0.94, IMMEDIATE_SAFETY: 0.02 },
    thresholds: { immediate: 0.2, high: 0.4, confidence: 0.6 },
  }));
  const result = await (await POST(request({ message: "Something is wrong" }))).json();
  assert.equal(result.decision.level, "HIGH_CONCERN");
  assert.equal(result.decision.model_version, "software-test-model");
  assert.equal(result.decision.confidence, 0.94);
});
