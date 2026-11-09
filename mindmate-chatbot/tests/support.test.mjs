import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSafety, normalize } from "../lib/support/safety.ts";
import { prioritize } from "../lib/support/policy.ts";
import { predict } from "../lib/support/classifier.ts";
import { safetyReply } from "../lib/support/responses.ts";

for (const [message, expected] of [
  ["I'm worried about tomorrow's exam.", "LOW"],
  ["I've been sad every day for weeks.", "MODERATE"],
  ["I can't sleep.", "MODERATE"],
  ["I feel completely hopeless.", "HIGH_CONCERN"],
  ["I don't want to live.", "HIGH_CONCERN"],
  ["I want to hurt myself.", "IMMEDIATE_SAFETY"],
  ["I'm going to kill myself tonight.", "IMMEDIATE_SAFETY"],
  ["I just took too many pills.", "IMMEDIATE_SAFETY"],
  ["I am cutting myself now.", "IMMEDIATE_SAFETY"],
  ["I don't want to hurt myself.", "LOW"],
  ["I am not suicidal.", "LOW"],
  ["I don't want to hurt myself, but I will hurt myself tonight.", "IMMEDIATE_SAFETY"],
  ["I used to think about hurting myself but I'm safe now.", "HIGH_CONCERN"],
  ["My friend told me that he wants to hurt himself.", "HIGH_CONCERN"],
  ['My friend said "I want to kill myself".', "HIGH_CONCERN"],
  ["For our psychology assignment, what does self-harm mean?", "LOW"],
  ['For my assignment, explain the phrase "I want to hurt myself".', "LOW"],
  ["For my assignment, what does 'I want to hurt myself' mean?", "LOW"],
  ["I finished my assignment, but I want to hurt myself.", "IMMEDIATE_SAFETY"],
  ["I want to k1ll myself.", "IMMEDIATE_SAFETY"],
  ["I want to ki\u200bll myself.", "IMMEDIATE_SAFETY"],
  ["I’m gonna kill myself.", "IMMEDIATE_SAFETY"],
  ["Gusto kong magpakamatay.", "IMMEDIATE_SAFETY"],
  ["Ayoko nang mabuhay.", "HIGH_CONCERN"],
  ["Lagi akong malungkot.", "MODERATE"],
]) {
  test(`safety regression: ${message}`, () => assert.equal(analyzeSafety(message).level, expected));
}

test("normalization preserves negation and the original input", () => {
  const original = "  I DON’T want to hurt myself.  ";
  assert.equal(normalize(original), "i don't want to hurt myself.");
  assert.equal(original, "  I DON’T want to hurt myself.  ");
});

const history = [
  { role: "user", content: "I feel hopeless." },
  { role: "assistant", content: "Are you safe right now?" },
];
for (const answer of ["No", "Not really", "I'm not sure", "Hindi", "I don't know", "I'm not safe"]) {
  test(`safety question context: ${answer}`, () => {
    const result = prioritize(answer, history);
    assert.equal(result.level, "IMMEDIATE_SAFETY");
    assert.equal(result.requires_human_review, true);
  });
}

test("short replies have no safety meaning without a question", () => assert.equal(prioritize("Not really").level, "LOW"));
test("yes to a question about danger means urgent support", () => {
  assert.equal(prioritize("Yes", [{ role: "assistant", content: "Are you thinking about hurting yourself?" }]).level, "IMMEDIATE_SAFETY");
});
test("no to a question about danger is not confused with no to a safety question", () => {
  assert.equal(prioritize("No", [{ role: "assistant", content: "Are you thinking about hurting yourself?" }]).level, "LOW");
});
test("an unanswered safety question survives unrelated replies", () => assert.equal(prioritize("Everything", history).level, "HIGH_CONCERN"));
test("a positive safety answer exits the question while retaining a support floor", () => assert.equal(prioritize("Yes, I am safe now", history).level, "MODERATE"));
test("a positive prefix cannot hide a new safety disclosure", () => assert.equal(prioritize("Yes, but I want to hurt myself", history).level, "IMMEDIATE_SAFETY"));
test("third-party support addresses the other person", () => {
  const result = prioritize("My friend wants to hurt himself.");
  assert.equal(result.subject, "other");
  assert.match(safetyReply(result), /Are they in immediate danger/);
});
test("a first-person disclosure takes precedence over third-party context", () => {
  const result = prioritize("My friend wants to hurt himself. I want to hurt myself too.");
  assert.equal(result.level, "IMMEDIATE_SAFETY");
  assert.equal(result.subject, "student");
  assert.match(safetyReply(result), /Are you safe right now/);
});

// Thresholds below are test fixtures only, never production defaults.
const model = (scores) => ({ scores, model_version: "test-fixture", model_mode: "reviewed", thresholds: { immediate: 0.2, high: 0.4, confidence: 0.6 } });
test("a confident low ML prediction cannot lower direct safety intent", () => {
  const result = prioritize("I want to hurt myself", [], model({ LOW: 0.97, MODERATE: 0.01, HIGH_CONCERN: 0.01, IMMEDIATE_SAFETY: 0.01 }));
  assert.equal(result.level, "IMMEDIATE_SAFETY");
  assert.equal(result.source, "safety_override");
});
test("uncertainty never lowers a high ML classification", () => {
  const result = prioritize("Something is wrong", [], model({ LOW: 0.25, MODERATE: 0.25, HIGH_CONCERN: 0.35, IMMEDIATE_SAFETY: 0.15 }));
  assert.equal(result.level, "HIGH_CONCERN");
  assert.equal(result.requires_human_review, true);
});
test("an asymmetric threshold catches immediate concern below argmax", () => {
  assert.equal(prioritize("Something is wrong", [], model({ LOW: 0.45, MODERATE: 0.25, HIGH_CONCERN: 0.05, IMMEDIATE_SAFETY: 0.25 })).level, "IMMEDIATE_SAFETY");
});
test("uncertain low predictions receive additional support", () => {
  const result = prioritize("Something is wrong", [], model({ LOW: 0.45, MODERATE: 0.35, HIGH_CONCERN: 0.15, IMMEDIATE_SAFETY: 0.05 }));
  assert.equal(result.level, "MODERATE");
  assert.equal(result.source, "uncertain_model");
});
test("rules-only decisions do not fabricate confidence or model versions", () => {
  const result = prioritize("Exam stress");
  assert.equal(result.model, null);
  assert.equal(result.confidence, null);
  assert.equal(result.model_version, null);
  assert.equal(result.rule_review_status, "requires_clinician_review");
});

function classifierEnv(t) {
  const before = process.env.DISTRESS_CLASSIFIER_URL;
  process.env.DISTRESS_CLASSIFIER_URL = "http://127.0.0.1:8001";
  t.after(() => { if (before === undefined) delete process.env.DISTRESS_CLASSIFIER_URL; else process.env.DISTRESS_CLASSIFIER_URL = before; });
}
test("classifier failures and unreviewed models leave rules available", async (t) => {
  classifierEnv(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  assert.equal(await predict("hello"), null);
  fetch.mock.mockImplementation(async () => Response.json({ release_approved: false }));
  assert.equal(await predict("hello"), null);
  fetch.mock.mockImplementation(async () => Response.json({ release_approved: true, model_version: "bad", scores: { LOW: 1 } }));
  assert.equal(await predict("hello"), null);
});
test("classifier accepts only complete, normalized reviewed predictions", async (t) => {
  classifierEnv(t);
  const prediction = model({ LOW: 0.7, MODERATE: 0.2, HIGH_CONCERN: 0.08, IMMEDIATE_SAFETY: 0.02 });
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...prediction, release_approved: true }));
  assert.deepEqual(await predict("hello"), prediction);
});
