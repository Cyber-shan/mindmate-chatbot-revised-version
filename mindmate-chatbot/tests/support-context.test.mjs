import assert from "node:assert/strict";
import { test } from "node:test";
import { prioritize } from "../lib/support/policy.ts";
import { assessSupport } from "../lib/support/assess.ts";
import { POST } from "../app/api/admin/algorithm/route.ts";
import { CONTEXT_CHALLENGES } from "./fixtures/support-context.mjs";

for (const example of CONTEXT_CHALLENGES) {
  test(`English ${example.kind} challenge: ${example.message}`, () => {
    const result = prioritize(example.message, example.history ?? []);
    assert.equal(result.level, example.expected);
    assert.equal(result.subject, example.subject ?? "student");
    assert.equal(result.safety_response_required, ["HIGH_CONCERN", "IMMEDIATE_SAFETY"].includes(example.expected));
    // A configured synthetic classifier may not undo the contextual interpretation.
    const synthetic = {
      model_mode: "prototype", model_version: "context-fixture",
      scores: { LOW: 0.01, MODERATE: 0.01, HIGH_CONCERN: 0.01, IMMEDIATE_SAFETY: 0.97 },
      thresholds: { immediate: 0.2, high: 0.4, confidence: 0.6 },
    };
    if (["negation", "quotation", "historical"].includes(example.kind)) {
      assert.equal(prioritize(example.message, example.history ?? [], synthetic).level, example.expected);
    }
  });
}

test("a saved unresolved question is resolved by later canonical history", () => {
  const previous = { highest_level: "HIGH_CONCERN", prior_high_concern: true, prior_immediate_concern: false, safety_question_active: true, safety_question_kind: "safe" };
  const history = [{ role: "assistant", content: "Are you safe right now?" }, { role: "user", content: "Yes, I am safe now." }];
  const resolved = prioritize("I would like help planning my homework.", history, null, previous);
  assert.equal(resolved.level, "MODERATE");
  assert.equal(resolved.state.safety_question_active, false);
  assert.equal(previous.safety_question_active, true, "Saved state must not be mutated");
  assert.equal(prioritize("Not really", [], null, previous).level, "IMMEDIATE_SAFETY");
});

test("resolved history does not erase a later safety question", () => {
  const history = [
    { role: "assistant", content: "Are you safe right now?" }, { role: "user", content: "Yes, I am safe now." },
    { role: "assistant", content: "Are you thinking about hurting yourself?" },
  ];
  assert.equal(prioritize("Yes", history).level, "IMMEDIATE_SAFETY");
});

test("text-only model predictions cannot reinterpret a contextual safety answer", () => {
  const history = [{ role: "user", content: "I feel hopeless." }, { role: "assistant", content: "Are you safe right now?" }];
  const model = { model_mode: "reviewed", model_version: "context-free-fixture",
    scores: { LOW: 0.01, MODERATE: 0.01, HIGH_CONCERN: 0.01, IMMEDIATE_SAFETY: 0.97 },
    thresholds: { immediate: 0.2, high: 0.4, confidence: 0.6 } };
  const result = prioritize("Yes, I am safe now", history, model);
  assert.equal(result.level, "MODERATE");
  assert.equal(result.model, null);
  assert.equal(result.state.safety_question_active, false);
});

test("the live assessment and admin route retain English context behavior without external services", async (t) => {
  const before = process.env.DISTRESS_CLASSIFIER_URL;
  delete process.env.DISTRESS_CLASSIFIER_URL;
  t.after(() => { if (before === undefined) delete process.env.DISTRESS_CLASSIFIER_URL; else process.env.DISTRESS_CLASSIFIER_URL = before; });
  t.mock.method(globalThis, "fetch", () => assert.fail("Rules-only challenges must not need external services"));
  for (const example of CONTEXT_CHALLENGES) {
    const result = await assessSupport(example.message, example.history ?? []);
    assert.equal(result.level, example.expected, example.message);
    const response = await POST(new Request("http://localhost/api/admin/algorithm", {
      method: "POST", body: JSON.stringify({ message: example.message, history: example.history ?? [] }),
    }));
    assert.equal(response.status, 200);
    const admin = await response.json();
    assert.equal(admin.evaluated_message, example.message);
    assert.equal(admin.decision.level, example.expected, example.message);
  }
});
