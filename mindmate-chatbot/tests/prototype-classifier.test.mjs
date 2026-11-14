import assert from "node:assert/strict";
import { test } from "node:test";
import { predict } from "../lib/support/classifier.ts";
import { assessSupport } from "../lib/support/assess.ts";
import { POST } from "../app/api/admin/algorithm/route.ts";

const prototype = {
  model_mode: "prototype", synthetic_data: true, language: "en", release_approved: false, prototype_usable: true,
  model_version: "synthetic-test-fixture",
  scores: { LOW: 0.02, MODERATE: 0.03, HIGH_CONCERN: 0.93, IMMEDIATE_SAFETY: 0.02 },
  thresholds: { immediate: 0.2, high: 0.4, confidence: 0.6 },
};

function configure(t, mode = "prototype", url = "http://127.0.0.1:8001") {
  for (const [key, value] of Object.entries({ DISTRESS_CLASSIFIER_MODE: mode, DISTRESS_CLASSIFIER_URL: url })) {
    const before = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}

test("synthetic predictions require explicit prototype mode and retain their provenance", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(prototype));
  const result = await predict("Something has changed");
  assert.equal(result.model_mode, "prototype");
  assert.equal(result.model_version, prototype.model_version);
  assert.equal(fetch.mock.calls[0].arguments[1].redirect, "error");
  delete process.env.DISTRESS_CLASSIFIER_MODE;
  assert.equal(await predict("Something has changed"), null);
});

test("prototype mode rejects research, contradictory provenance, and malformed scores", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch");
  for (const changes of [
    { model_mode: "research" }, { synthetic_data: false }, { language: "tl" },
    { language: undefined }, { release_approved: true }, { model_mode: undefined }, { prototype_usable: false },
    { model_version: "" }, { scores: { ...prototype.scores, LOW: -1 } },
    { scores: { ...prototype.scores, LOW: 0.5 } }, { scores: { LOW: 1 } },
    { thresholds: null }, { thresholds: { ...prototype.thresholds, high: 0 } },
    { thresholds: { ...prototype.thresholds, confidence: 2 } },
  ]) {
    fetch.mock.mockImplementation(async () => Response.json({ ...prototype, ...changes }));
    assert.equal(await predict("hello"), null, JSON.stringify(changes));
  }
  fetch.mock.mockImplementation(async () => Response.json(null));
  assert.equal(await predict("hello"), null);
});

test("reviewed mode cannot accept synthetic artifacts claiming release approval", async (t) => {
  configure(t, "reviewed");
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...prototype, release_approved: true }));
  assert.equal(await predict("hello"), null);
});

test("prototype mode never sends test text or tokens to a remote or credential-bearing URL", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("Rejected configuration must not issue a request"));
  for (const url of ["http://example.com:8001", "http://127.0.0.1.example.com", "http://user:secret@localhost:8001", "https://localhost:8001", "not-a-url"]) {
    process.env.DISTRESS_CLASSIFIER_URL = url;
    assert.equal(await predict("hello"), null);
  }
  process.env.DISTRESS_CLASSIFIER_URL = "http://127.0.0.1:8001";
  process.env.DISTRESS_CLASSIFIER_MODE = "typo";
  assert.equal(await predict("hello"), null);
  assert.equal(fetch.mock.callCount(), 0);
});

test("admin tester executes the prototype model and exposes synthetic provenance", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => Response.json(prototype));
  const response = await POST(new Request("http://localhost/api/admin/algorithm", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Everything feels different lately" }),
  }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.decision.level, "HIGH_CONCERN");
  assert.equal(result.decision.model_mode, "prototype");
  assert.equal(result.decision.confidence, 0.93);
  assert.ok(result.response_preview);
});

test("prototype failures fall back to rules and direct safety never waits for ML", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const fallback = await assessSupport("I feel completely hopeless.");
  assert.equal(fallback.level, "HIGH_CONCERN");
  assert.equal(fallback.model_mode, null);
  assert.equal(fallback.confidence, null);
  const calls = fetch.mock.callCount();
  const immediate = await assessSupport("I want to hurt myself.");
  assert.equal(immediate.level, "IMMEDIATE_SAFETY");
  assert.equal(immediate.model_mode, null);
  assert.equal(fetch.mock.callCount(), calls);
});

test("a low prototype score cannot reduce a safety-rule priority", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ...prototype, scores: { LOW: 0.97, MODERATE: 0.01, HIGH_CONCERN: 0.01, IMMEDIATE_SAFETY: 0.01 },
  }));
  const result = await assessSupport("I feel completely hopeless.");
  assert.equal(result.level, "HIGH_CONCERN");
  assert.equal(result.model_mode, "prototype");
  assert.equal(result.safety_response_required, true);
});

test("the synthetic model abstains when rules recognize negated, academic, historical or third-party context", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    ...prototype, scores: { LOW: 0.01, MODERATE: 0.01, HIGH_CONCERN: 0.01, IMMEDIATE_SAFETY: 0.97 },
  }));
  for (const [message, level] of [
    ["I don't want to hurt myself.", "LOW"],
    ['For my assignment, explain the phrase "I want to hurt myself".', "LOW"],
    ["I cut myself a slice of cake.", "LOW"],
    ["I used to think about hurting myself but I'm safe now.", "HIGH_CONCERN"],
    ["My friend wants to hurt himself.", "HIGH_CONCERN"],
    ["I don't want to hurt myself, but I will hurt myself tonight.", "IMMEDIATE_SAFETY"],
  ]) {
    const result = await assessSupport(message);
    assert.equal(result.level, level, message);
    assert.equal(result.model_mode, null, message);
  }
});
