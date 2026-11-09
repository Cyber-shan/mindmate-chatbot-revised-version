import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSafety, normalize } from "../lib/support/safety.ts";
import { prioritize } from "../lib/support/policy.ts";
import { assessSupport } from "../lib/support/assess.ts";
import { CONTEXT_LANGUAGE_CASES, IMMEDIATE_LANGUAGE_MESSAGES } from "./fixtures/support-language.mjs";

for (const message of IMMEDIATE_LANGUAGE_MESSAGES) {
  test(`language variation activates the safety path: ${message}`, () => {
    const result = prioritize(message);
    assert.equal(result.level, "IMMEDIATE_SAFETY");
    assert.equal(result.source, "safety_override");
    assert.equal(result.safety_response_required, true);
    assert.equal(result.requires_human_review, true);
    assert.equal(result.state.safety_question_active, true);
  });
}

for (const [message, expected] of CONTEXT_LANGUAGE_CASES) {
  test(`language variation retains context (${expected}): ${message}`, () => {
    const result = prioritize(message);
    assert.equal(result.level, expected);
    assert.equal(result.safety_response_required, ["HIGH_CONCERN", "IMMEDIATE_SAFETY"].includes(expected));
  });
}

test("targeted normalization preserves negation, punctuation and original text", () => {
  const original = "  I DON’T wanna hurt my-self; im gonna ask for help.  ";
  const normalized = normalize(original);
  assert.equal(normalized, "i don't want to hurt myself; i'm going to ask for help.");
  assert.equal(original, "  I DON’T wanna hurt my-self; im gonna ask for help.  ");
  assert.equal(normalize(normalized), normalized);
});

test("language normalization leaves unrelated vocabulary intact", () => {
  assert.equal(normalize("My self esteem, diet and dye project; a skillful killer whale."),
    "my self esteem, diet and dye project; a skillful killer whale.");
});

test("slang and split spelling cannot be lowered by a confident LOW model", () => {
  const model = {
    scores: { LOW: 0.97, MODERATE: 0.01, HIGH_CONCERN: 0.01, IMMEDIATE_SAFETY: 0.01 },
    model_version: "software-test-fixture",
    thresholds: { immediate: 0.2, high: 0.4, confidence: 0.6 },
  };
  for (const message of IMMEDIATE_LANGUAGE_MESSAGES) {
    assert.equal(prioritize(message, [], model).level, "IMMEDIATE_SAFETY", message);
  }
});

test("immediate wording variations bypass even a configured, unavailable classifier", async (t) => {
  const before = process.env.DISTRESS_CLASSIFIER_URL;
  process.env.DISTRESS_CLASSIFIER_URL = "http://127.0.0.1:1";
  t.after(() => { if (before === undefined) delete process.env.DISTRESS_CLASSIFIER_URL; else process.env.DISTRESS_CLASSIFIER_URL = before; });
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Classifier must not delay the safety override"); });
  for (const message of IMMEDIATE_LANGUAGE_MESSAGES) {
    const result = await assessSupport(message);
    assert.equal(result.level, "IMMEDIATE_SAFETY", message);
    assert.equal(result.confidence, null);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("informal denials do not erase a later concern or change its subject", () => {
  assert.equal(prioritize("I don't wanna die and I want to hurt my self.").subject, "student");
  const other = prioritize('My friend said "I wanna die".');
  assert.equal(other.subject, "other");
  assert.equal(other.state.safety_question_active, false);
  const mixed = prioritize('My friend said "I wanna die", but I wanna hurt my self too.');
  assert.equal(mixed.subject, "student");
  assert.equal(mixed.state.safety_question_active, true);
});

test("informal messages participate in conversation safety state", () => {
  const history = [
    { role: "user", content: "i wanna die" },
    { role: "assistant", content: "Are you safe right now?" },
  ];
  const unknown = prioritize("idk", history);
  assert.equal(unknown.level, "IMMEDIATE_SAFETY");
  assert.equal(unknown.source, "conversation_context");
  assert.equal(prioritize("Yes, im safe now", history).level, "MODERATE");
  assert.equal(prioritize("Yes, im safe now", history).state.safety_question_active, false);
  assert.equal(prioritize("idk").level, "LOW");
});

test("changed safety behavior has a new draft rule version", () => {
  const result = prioritize("i wanna die");
  assert.equal(result.rule_version, "mindmate-safety-rules-v3-draft");
  assert.equal(result.rule_review_status, "requires_clinician_review");
  assert.equal(analyzeSafety("i wanna die").direct_intent, true);
});
