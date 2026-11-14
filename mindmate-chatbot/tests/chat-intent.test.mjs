import assert from "node:assert/strict";
import { test } from "node:test";
import { assessSupport } from "../lib/support/assess.ts";
import { prioritize } from "../lib/support/policy.ts";
import { hasPersonalDistress } from "../lib/support/intent.ts";
import { loadConversation } from "../lib/support/store.ts";

const synthetic = { model_mode: "prototype", model_version: "test", scores: { LOW: 0.01, MODERATE: 0.01, HIGH_CONCERN: 0.01, IMMEDIATE_SAFETY: 0.97 }, thresholds: { immediate: 0.2, high: 0.4, confidence: 0.4 } };
const ordinary = ["Hello", "What are the things that a person can do to not play games", "What are your thoughts on the current ongoing crisis", "How can I reduce gaming and focus on my studies?", "What is depression?", "I want to understand mental health for my assignment", "I am not depressed; I just want study tips"];
for (const message of ordinary) test(`ordinary requests do not become synthetic safety emergencies: ${message}`, () => {
  const decision = prioritize(message, [], synthetic);
  assert.equal(decision.level, "LOW");
  assert.equal(decision.safety_response_required, false);
  assert.equal(decision.model, null);
  assert.equal(hasPersonalDistress(message), false);
});
test("ordinary prototype requests skip the classifier call entirely", async (t) => {
  const before = process.env.DISTRESS_CLASSIFIER_MODE; process.env.DISTRESS_CLASSIFIER_MODE = "prototype";
  t.after(() => { if (before === undefined) delete process.env.DISTRESS_CLASSIFIER_MODE; else process.env.DISTRESS_CLASSIFIER_MODE = before; });
  t.mock.method(globalThis, "fetch", () => assert.fail("Ordinary questions do not need a classifier round trip"));
  for (const message of ordinary) assert.equal((await assessSupport(message)).level, "LOW");
});
test("personal distress can receive extra support without an unsupported prototype crisis workflow", () => {
  const result = prioritize("I feel lonely and emotionally exhausted", [], synthetic);
  assert.equal(result.level, "MODERATE");
  assert.equal(result.model_mode, "prototype");
  assert.equal(result.safety_response_required, false);
  assert.equal(prioritize("I feel completely hopeless", [], synthetic).level, "HIGH_CONCERN");
  assert.equal(prioritize("I want to hurt myself", [], synthetic).level, "IMMEDIATE_SAFETY");
});
test("a false assistant safety question cannot turn a neutral conversation into a safety workflow", () => {
  const history = [{ role: "user", content: ordinary[1] }, { role: "assistant", content: "That sounds difficult. Are you safe right now?" }];
  const result = prioritize(ordinary[2], history, synthetic);
  assert.equal(result.level, "LOW"); assert.equal(result.state.safety_question_active, false);
  assert.equal(prioritize("Not really", history).level, "LOW");
  const genuine = [{ role: "user", content: "I feel completely hopeless" }, history[1]];
  assert.equal(prioritize("Not really", genuine).level, "IMMEDIATE_SAFETY");
});
test("old prototype-only saved state is repaired only with a complete safe canonical history", async (t) => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public", SUPABASE_SERVICE_ROLE_KEY: "server" })) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  const conversation = "11111111-1111-4111-8111-111111111111", message = "22222222-2222-4222-8222-222222222222";
  let genuine = false;
  t.mock.method(globalThis, "fetch", async (input) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/user")) return Response.json({ id: "owner" });
    if (path.endsWith("/messages")) return Response.json([{ id: message, role: "user", content: ordinary[2] }, { id: "assistant", role: "assistant", content: "Are you safe right now?" }, { id: "earlier", role: "user", content: genuine ? "I feel completely hopeless" : ordinary[1] }]);
    return Response.json({ decision: { model_mode: "prototype", state: { highest_level: "IMMEDIATE_SAFETY", safety_question_active: true, prior_high_concern: true, prior_immediate_concern: true } } });
  });
  const request = () => new Request("http://localhost/api/chat", { headers: { Authorization: "Bearer student" } });
  assert.equal((await loadConversation(request(), conversation, message)).previous, undefined);
  genuine = true;
  assert.equal((await loadConversation(request(), conversation, message)).previous.safety_question_active, true);
});
