import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { algorithmOverview, parseContextReport, parseEvaluationReport } from "../lib/support/overview.ts";
import { ruleVersion } from "../lib/support/safety.ts";
import { LEVELS } from "../lib/support/types.ts";
import { GET } from "../app/api/admin/algorithm/overview/route.ts";

const bound = { lower: null, upper: null, valid_resamples: 1000, status: "no_observed_variation" };
const matrix = LEVELS.map((_, i) => LEVELS.map((__, j) => i === j ? 2 : 0));
const counts = { correct: 8, incorrect: 0, under_prioritized: 0, over_prioritized: 0,
  immediate_safety_actual: 2, immediate_safety_false_negative: 0, immediate_safety_false_positive: 0,
  high_priority_actual: 4, high_priority_false_negative: 0, high_priority_false_positive: 0, lower_priority_actual: 4 };
const audit = (names) => ({ passed: true, checked_fields: ["student_id", "conversation_id", "text", "template_family"],
  partitions: Object.fromEntries(names.map((name) => {
    const messages = name === "train" ? 24 : name === "fit" ? 16 : 8;
    return [name, { message_count: messages, student_count: messages / 4, conversation_count: messages / 4,
      independent_group_count: messages / 4, class_counts: Object.fromEntries(LEVELS.map((label) => [label, messages / 4])) }];
  })) });
function metricFixture() {
  return {
    sample_count: 8, accuracy_informational: 1, macro_f1: 1, immediate_recall: 1, combined_recall: 1,
    critical_false_negative_rate: 0, immediate_false_negative_rate: 0, combined_false_positive_rate: 0, combined_f2: 1,
    confusion_matrix: matrix, class_order: LEVELS,
    per_class: Object.fromEntries(LEVELS.map((label) => [label, { precision: 1, recall: 1, "f1-score": 1, support: 2,
      true_positive: 2, false_positive: 0, false_negative: 0, true_negative: 6, predicted_count: 2, precision_defined: true, recall_defined: true }])),
    error_counts: counts,
    uncertainty: { confidence_threshold: 0.4, low_confidence_count: 0, low_confidence_rate: 0, low_confidence_error_count: 0, mean_normalized_entropy: 0.1, confidence_definition: "Raw class probability" },
    confidence_intervals: { method: "whole-group percentile bootstrap", confidence_level: 0.95, resamples: 1000, seed: 42,
      sampling_unit: "connected groups", independent_group_count: 2, small_group_warning: true, limitations: "Fixtures do not establish population accuracy.",
      metrics: Object.fromEntries(["accuracy_informational", "macro_f1", "immediate_recall", "combined_recall", "critical_false_negative_rate", "combined_false_positive_rate"].map((key) => [key, bound])),
      per_class: Object.fromEntries(LEVELS.map((label) => [label, { precision: bound, recall: bound, f1: bound }])) },
    calibration: { ece_10_bins: 0.1, multiclass_brier: 0.2, scope: "Raw probabilities before policy thresholds" },
  };
}
function reportFixture() {
  return { model_version: "synthetic-fixture", model_mode: "prototype", synthetic_data: true, language: "en",
    created_at: "2026-11-09T00:00:00Z", evaluation_scope: "Synthetic engineering fixture", release_approved: false,
    split_sizes: { train: 24, validation: 8, test: 8 }, partition_audit: audit(["train", "validation", "test"]),
    calibration_audit: Array.from({ length: 3 }, () => audit(["fit", "calibration"])), validation: metricFixture(), test: metricFixture(),
    review: { reviewer: "PRIVATE REVIEWER" }, dataset_path: "PRIVATE PATH", source_messages: ["PRIVATE MESSAGE"] };
}
function contextFixture() {
  return { model_version: "synthetic-fixture", rule_version: ruleVersion, evaluation_scope: "Fixed synthetic challenge fixtures",
    sample_count: 8, error_count: 0, categories: { negation: { total: 8, correct: 8, errors: 0 } }, class_order: LEVELS, confusion_matrix: matrix,
    per_class: Object.fromEntries(LEVELS.map((label) => [label, { support: 2, true_positive: 2, false_positive: 0, false_negative: 0, precision: 1, recall: 1, f1: 1 }])),
    uncertainty: { confidence_intervals: null, reason: "Curated fixtures are not population samples." }, cases: [{ text: "PRIVATE CASE", student_id: "PRIVATE ID" }] };
}
const readReport = async (name) => name === "evaluation.json" ? reportFixture() : contextFixture();
function configure(t, values = {}) {
  for (const key of ["DISTRESS_CLASSIFIER_URL", "DISTRESS_CLASSIFIER_MODE", "DISTRESS_CLASSIFIER_TOKEN", "MINDMATE_ALGORITHM_REPORT_DIR"]) {
    const before = process.env[key];
    if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key];
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}

test("overview exposes aggregate real report fields and excludes private review, identifiers and messages", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("No classifier is configured"));
  const result = await algorithmOverview({ readReport });
  assert.equal(result.runtime.status, "rules_only");
  assert.equal(result.evaluation_status, "ready");
  assert.equal(result.context_status, "ready");
  assert.equal(result.evaluation.test.per_class.IMMEDIATE_SAFETY.true_positive, 2);
  assert.equal(result.evaluation.test.confidence_intervals.metrics.immediate_recall.lower, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|source_messages|dataset_path|reviewer|student_id":"/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("runtime readiness verifies both model provenance and the prediction adapter used by chat", async (t) => {
  configure(t, { DISTRESS_CLASSIFIER_MODE: "prototype", DISTRESS_CLASSIFIER_URL: "http://127.0.0.1:8001", DISTRESS_CLASSIFIER_TOKEN: "private-fixture-token" });
  const health = { ready: true, model_version: "synthetic-fixture", model_mode: "prototype", synthetic_data: true, language: "en", release_approved: false, prototype_usable: true };
  const prediction = { ...health, scores: { LOW: 0.9, MODERATE: 0.05, HIGH_CONCERN: 0.03, IMMEDIATE_SAFETY: 0.02 }, thresholds: { immediate: 0.2, high: 0.4, confidence: 0.6 } };
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer private-fixture-token");
    return Response.json(String(url).endsWith("/health") ? health : prediction);
  });
  const result = await algorithmOverview({ readReport });
  assert.equal(result.runtime.status, "ready");
  assert.equal(result.runtime.synthetic_data, true);
  assert.equal(result.runtime.model_version, "synthetic-fixture");
  assert.equal(fetch.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(result), /private-fixture-token|127\.0\.0\.1/);
  fetch.mock.mockImplementation(async () => Response.json({ ...health, language: "tl" }));
  assert.equal((await algorithmOverview({ readReport })).runtime.status, "incompatible");
});

test("offline service and missing artifacts report honest fallbacks without invented metrics", async (t) => {
  configure(t, { DISTRESS_CLASSIFIER_MODE: "prototype", DISTRESS_CLASSIFIER_URL: "http://127.0.0.1:8001" });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const result = await algorithmOverview({ readReport: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } });
  assert.equal(result.runtime.status, "unavailable");
  assert.equal(result.evaluation_status, "missing");
  assert.equal(result.context_status, "missing");
  assert.equal(result.evaluation, null);
  assert.equal(result.context, null);
});

test("invalid, stale and unsupported artifacts are clearly distinguished", async (t) => {
  configure(t);
  assert.throws(() => parseEvaluationReport({ ...reportFixture(), test: { ...metricFixture(), sample_count: 99 } }));
  const missingCheck = reportFixture();
  missingCheck.partition_audit.checked_fields = ["student_id"];
  assert.throws(() => parseEvaluationReport(missingCheck));
  assert.throws(() => parseContextReport({ ...contextFixture(), confusion_matrix: [[1]] }));
  const result = await algorithmOverview({ readReport: async (name) => name === "evaluation.json" ? reportFixture() : { ...contextFixture(), rule_version: "old-rules" } });
  assert.equal(result.context_status, "stale");
  const invalid = await algorithmOverview({ readReport: async () => ({ malformed: true }) });
  assert.equal(invalid.evaluation_status, "invalid");
  assert.equal(invalid.context_status, "invalid");
});

test("prototype status never probes remote or credential-bearing services", async (t) => {
  configure(t, { DISTRESS_CLASSIFIER_MODE: "prototype", DISTRESS_CLASSIFIER_URL: "http://example.com:8001" });
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("Invalid local service must not be contacted"));
  assert.equal((await algorithmOverview({ readReport })).runtime.status, "incompatible");
  process.env.DISTRESS_CLASSIFIER_URL = "http://user:password@localhost:8001";
  assert.equal((await algorithmOverview({ readReport })).runtime.status, "incompatible");
  assert.equal(fetch.mock.callCount(), 0);
});

test("overview HTTP endpoint reads configured artifacts with no-store caching", async (t) => {
  configure(t);
  const ownerId = "11111111-1111-4111-8111-111111111111";
  for (const [key, value] of Object.entries({ MINDMATE_OWNER_USER_ID: ownerId, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, "fetch", async (input) => {
    assert.equal(new URL(String(input)).pathname, "/auth/v1/user");
    return Response.json({ id: ownerId, email: "owner@mindmate.local", app_metadata: { mindmate_role: "admin" } });
  });
  const directory = await mkdtemp(path.join(tmpdir(), "mindmate-overview-test-"));
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(directory));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  t.after(() => rm(directory, { recursive: true, force: true }));
  process.env.MINDMATE_ALGORITHM_REPORT_DIR = directory;
  await writeFile(path.join(directory, "evaluation.json"), JSON.stringify(reportFixture()));
  await writeFile(path.join(directory, "context-evaluation.json"), JSON.stringify(contextFixture()));
  const response = await GET(new Request("http://localhost/api/admin/algorithm/overview", { headers: { Authorization: "Bearer owner-session" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  const result = await response.json();
  assert.equal(result.evaluation.test.error_counts.incorrect, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test("contradictory saved metrics, class errors and uncertainty cannot masquerade as real results", () => {
  const mutations = [
    (report) => { report.test.accuracy_informational = 0.75; },
    (report) => { report.test.macro_f1 = 0.5; },
    (report) => { report.test.error_counts.high_priority_false_negative = 999; },
    (report) => { report.test.per_class.LOW.false_positive = 999; },
    (report) => { report.test.per_class.MODERATE.precision_defined = false; },
    (report) => { report.test.immediate_recall = null; },
    (report) => { report.test.uncertainty.low_confidence_count = 20; },
    (report) => { report.test.confidence_intervals.metrics.macro_f1 = { ...bound, status: "estimated" }; },
    (report) => { report.test.confidence_intervals.per_class.LOW.precision.valid_resamples = 1001; },
    (report) => { report.partition_audit.partitions.train.class_counts.LOW = 5; },
    (report) => { report.split_sizes.train = 23; },
    (report) => { report.calibration_audit[0].partitions.fit = report.calibration_audit[0].partitions.calibration; },
  ];
  for (const mutate of mutations) {
    const report = structuredClone(reportFixture()); mutate(report);
    assert.throws(() => parseEvaluationReport(report));
  }
});

test("context report counts are coherent and may include subject errors without label errors", () => {
  assert.throws(() => parseContextReport({ ...contextFixture(), error_count: 2 }));
  const report = contextFixture();
  report.error_count = 1; report.categories.negation = { total: 8, correct: 7, errors: 1 };
  assert.equal(parseContextReport(report).error_count, 1);
});

test("saved evaluation and context become stale when a different valid model is connected", async (t) => {
  configure(t, { DISTRESS_CLASSIFIER_MODE: "prototype", DISTRESS_CLASSIFIER_URL: "http://127.0.0.1:8001" });
  const health = { ready: true, model_version: "new-model", model_mode: "prototype", synthetic_data: true, language: "en", release_approved: false, prototype_usable: true };
  t.mock.method(globalThis, "fetch", async (url) => Response.json(String(url).endsWith("/health") ? health : {
    ...health, scores: { LOW: 0.9, MODERATE: 0.05, HIGH_CONCERN: 0.03, IMMEDIATE_SAFETY: 0.02 }, thresholds: { immediate: 0.2, high: 0.4, confidence: 0.6 },
  }));
  const result = await algorithmOverview({ readReport });
  assert.equal(result.runtime.status, "ready");
  assert.equal(result.evaluation_status, "stale");
  assert.equal(result.context_status, "stale");
});
