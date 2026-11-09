import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { predict } from "./classifier.ts";
import { ruleVersion } from "./safety.ts";
import { LEVELS } from "./types.ts";
import type { AlgorithmOverview, AlgorithmRuntime, ClassMetrics, ContextEvaluation, EvaluationMetrics, EvaluationReport, MetricInterval, PartitionAudit, ReportStatus } from "./overview-types.ts";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid report object");
  return value as ObjectValue;
}
function number(value: unknown, maximum = Infinity, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum || (integer && !Number.isInteger(value))) throw new Error("Invalid report number");
  return value;
}
const count = (value: unknown) => number(value, Infinity, true);
const rate = (value: unknown) => number(value, 1);
const nullableRate = (value: unknown) => value === null ? null : rate(value);
const nullableCount = (value: unknown) => value === null ? null : count(value);
function string(value: unknown, maximum = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("Invalid report string");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid report flag");
  return value;
}
function numericFields<K extends string>(value: ObjectValue, keys: readonly K[], parser: (value: unknown) => number): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, parser(value[key])])) as Record<K, number>;
}
function matrix(value: unknown): number[][] {
  if (!Array.isArray(value) || value.length !== 4 || value.some((row) => !Array.isArray(row) || row.length !== 4)) throw new Error("Invalid confusion matrix");
  return value.map((row: unknown[]) => row.map(count));
}
function classOrder(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4 || !LEVELS.every((label, index) => value[index] === label)) throw new Error("Unsupported class order");
  return [...LEVELS];
}
function interval(value: unknown): MetricInterval {
  const data = object(value);
  const lower = nullableRate(data.lower), upper = nullableRate(data.upper);
  if ((lower === null) !== (upper === null) || (lower !== null && upper !== null && lower > upper)) throw new Error("Invalid interval bounds");
  const status = string(data.status, 80);
  if (!["estimated", "insufficient_groups", "no_observed_variation"].includes(status) || (status === "estimated") !== (lower !== null)) throw new Error("Invalid interval status");
  return { lower, upper, valid_resamples: count(data.valid_resamples), status };
}
function equalMetric(actual: number | null, expected: number | null) {
  if (actual === null || expected === null ? actual !== expected : Math.abs(actual - expected) > 1e-8) throw new Error("Inconsistent evaluation metric");
}
const divide = (numerator: number, denominator: number) => denominator ? numerator / denominator : 0;

function verifyMetrics(data: EvaluationMetrics) {
  const rows = data.confusion_matrix.map((row) => row.reduce((sum, entry) => sum + entry, 0));
  const columns = LEVELS.map((_, index) => data.confusion_matrix.reduce((sum, row) => sum + row[index], 0));
  let correct = 0, under = 0, over = 0, highTP = 0, highFN = 0, highFP = 0, macroF1 = 0;
  data.confusion_matrix.forEach((row, actual) => row.forEach((value, predicted) => {
    if (actual === predicted) correct += value;
    if (predicted < actual) under += value;
    if (predicted > actual) over += value;
    if (actual >= 2 && predicted >= 2) highTP += value;
    if (actual >= 2 && predicted < 2) highFN += value;
    if (actual < 2 && predicted >= 2) highFP += value;
  }));
  for (const [index, label] of LEVELS.entries()) {
    const item = data.per_class[label], tp = data.confusion_matrix[index][index];
    const expected = { support: rows[index], true_positive: tp, false_positive: columns[index] - tp,
      false_negative: rows[index] - tp, true_negative: data.sample_count - rows[index] - columns[index] + tp, predicted_count: columns[index] };
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) equalMetric(item[key], expected[key]);
    equalMetric(item.precision, divide(tp, columns[index])); equalMetric(item.recall, divide(tp, rows[index]));
    const f1 = divide(2 * tp, rows[index] + columns[index]);
    equalMetric(item["f1-score"], f1); macroF1 += f1 / 4;
    if (item.precision_defined !== (columns[index] > 0) || item.recall_defined !== (rows[index] > 0)) throw new Error("Inconsistent class support flags");
  }
  const highActual = rows[2] + rows[3], lowerActual = rows[0] + rows[1];
  const expectedErrors = { correct, incorrect: data.sample_count - correct, under_prioritized: under, over_prioritized: over,
    immediate_safety_actual: rows[3], immediate_safety_false_negative: rows[3] - data.confusion_matrix[3][3],
    immediate_safety_false_positive: columns[3] - data.confusion_matrix[3][3], high_priority_actual: highActual,
    high_priority_false_negative: highFN, high_priority_false_positive: highFP, lower_priority_actual: lowerActual };
  for (const key of Object.keys(expectedErrors) as (keyof typeof expectedErrors)[]) equalMetric(data.error_counts[key], expectedErrors[key]);
  equalMetric(data.accuracy_informational, correct / data.sample_count); equalMetric(data.macro_f1, macroF1);
  equalMetric(data.immediate_recall, rows[3] ? data.confusion_matrix[3][3] / rows[3] : null);
  equalMetric(data.immediate_false_negative_rate, rows[3] ? expectedErrors.immediate_safety_false_negative / rows[3] : null);
  equalMetric(data.combined_recall, highActual ? highTP / highActual : null);
  equalMetric(data.critical_false_negative_rate, highActual ? highFN / highActual : null);
  equalMetric(data.combined_false_positive_rate, lowerActual ? highFP / lowerActual : null);
  equalMetric(data.combined_f2, divide(5 * highTP, 5 * highTP + 4 * highFN + highFP));
  const uncertainty = data.uncertainty;
  if (uncertainty.confidence_threshold === null) {
    if ([uncertainty.low_confidence_count, uncertainty.low_confidence_rate, uncertainty.low_confidence_error_count].some((item) => item !== null)) throw new Error("Unconfigured uncertainty must be unavailable");
  } else {
    if (!uncertainty.confidence_threshold || uncertainty.low_confidence_count === null || uncertainty.low_confidence_error_count === null
      || uncertainty.low_confidence_count > data.sample_count || uncertainty.low_confidence_error_count > Math.min(uncertainty.low_confidence_count, data.error_counts.incorrect)) throw new Error("Invalid uncertainty counts");
    equalMetric(uncertainty.low_confidence_rate, uncertainty.low_confidence_count / data.sample_count);
  }
  const intervals = data.confidence_intervals;
  if (intervals.confidence_level !== 0.95 || !intervals.resamples || !intervals.independent_group_count || intervals.independent_group_count > data.sample_count) throw new Error("Invalid uncertainty interval metadata");
  const allBounds = [...Object.values(intervals.metrics), ...Object.values(intervals.per_class).flatMap((item) => Object.values(item))];
  for (const bounds of allBounds) {
    if (bounds.valid_resamples > intervals.resamples || (bounds.status !== "insufficient_groups" && (intervals.independent_group_count < 2 || bounds.valid_resamples < 0.9 * intervals.resamples))) throw new Error("Invalid interval resample counts");
  }
}
function audit(value: unknown): PartitionAudit {
  const data = object(value), partitions = object(data.partitions);
  const requiredFields = ["student_id", "conversation_id", "text", "template_family"];
  if (!Array.isArray(data.checked_fields) || data.checked_fields.length !== requiredFields.length || !requiredFields.every((field) => (data.checked_fields as unknown[]).includes(field))) throw new Error("Invalid audit fields");
  const names = Object.keys(partitions);
  if (!names.length || names.some((name) => !["train", "validation", "test", "fit", "calibration"].includes(name))) throw new Error("Invalid audit partitions");
  return {
    passed: boolean(data.passed), checked_fields: data.checked_fields as string[],
    partitions: Object.fromEntries(names.map((name) => {
      const item = object(partitions[name]);
      const summary = {
        ...numericFields(item, ["message_count", "student_count", "conversation_count", "independent_group_count"] as const, count),
        class_counts: numericFields(object(item.class_counts), LEVELS, count),
      };
      if (Object.values(summary.class_counts).reduce((sum, entry) => sum + entry, 0) !== summary.message_count
        || summary.independent_group_count > summary.student_count || summary.student_count > summary.conversation_count || summary.conversation_count > summary.message_count) throw new Error("Inconsistent audit counts");
      return [name, summary];
    })),
  };
}
function metrics(value: unknown): EvaluationMetrics {
  const data = object(value), errors = object(data.error_counts), uncertainty = object(data.uncertainty);
  const calibration = object(data.calibration), ci = object(data.confidence_intervals), perClass = object(data.per_class);
  const ciMetrics = object(ci.metrics), ciClasses = object(ci.per_class);
  const confusion = matrix(data.confusion_matrix), samples = count(data.sample_count);
  if (!samples || confusion.flat().reduce((sum, entry) => sum + entry, 0) !== samples) throw new Error("Inconsistent sample count");
  const per_class = Object.fromEntries(LEVELS.map((label, index) => {
    const item = object(perClass[label]);
    const parsed: ClassMetrics = {
      ...numericFields(item, ["precision", "recall", "f1-score"] as const, rate),
      ...numericFields(item, ["support", "true_positive", "false_positive", "false_negative", "true_negative", "predicted_count"] as const, count),
      precision_defined: boolean(item.precision_defined), recall_defined: boolean(item.recall_defined),
    };
    if (parsed.support !== confusion[index].reduce((sum, entry) => sum + entry, 0) || parsed.true_positive !== confusion[index][index]) throw new Error("Inconsistent class counts");
    return [label, parsed];
  })) as Record<(typeof LEVELS)[number], ClassMetrics>;
  const counts = numericFields(errors, ["correct", "incorrect", "under_prioritized", "over_prioritized", "immediate_safety_actual", "immediate_safety_false_negative", "immediate_safety_false_positive", "high_priority_actual", "high_priority_false_negative", "high_priority_false_positive", "lower_priority_actual"] as const, count);
  if (counts.correct + counts.incorrect !== samples || counts.under_prioritized + counts.over_prioritized !== counts.incorrect) throw new Error("Inconsistent error counts");
  const result: EvaluationMetrics = {
    sample_count: samples,
    ...numericFields(data, ["accuracy_informational", "macro_f1", "combined_f2"] as const, rate),
    immediate_recall: nullableRate(data.immediate_recall), combined_recall: nullableRate(data.combined_recall),
    critical_false_negative_rate: nullableRate(data.critical_false_negative_rate), immediate_false_negative_rate: nullableRate(data.immediate_false_negative_rate),
    combined_false_positive_rate: nullableRate(data.combined_false_positive_rate),
    confusion_matrix: confusion, class_order: classOrder(data.class_order), per_class, error_counts: counts,
    uncertainty: {
      confidence_threshold: nullableRate(uncertainty.confidence_threshold), low_confidence_count: nullableCount(uncertainty.low_confidence_count),
      low_confidence_rate: nullableRate(uncertainty.low_confidence_rate), low_confidence_error_count: nullableCount(uncertainty.low_confidence_error_count),
      mean_normalized_entropy: rate(uncertainty.mean_normalized_entropy), confidence_definition: string(uncertainty.confidence_definition),
    },
    confidence_intervals: {
      method: string(ci.method), confidence_level: rate(ci.confidence_level), resamples: count(ci.resamples), seed: count(ci.seed),
      sampling_unit: string(ci.sampling_unit), independent_group_count: count(ci.independent_group_count), small_group_warning: boolean(ci.small_group_warning), limitations: string(ci.limitations),
      metrics: Object.fromEntries(["accuracy_informational", "macro_f1", "immediate_recall", "combined_recall", "critical_false_negative_rate", "combined_false_positive_rate"].map((key) => [key, interval(ciMetrics[key])])),
      per_class: Object.fromEntries(LEVELS.map((label) => {
        const item = object(ciClasses[label]);
        return [label, { precision: interval(item.precision), recall: interval(item.recall), f1: interval(item.f1) }];
      })) as EvaluationMetrics["confidence_intervals"]["per_class"],
    },
    calibration: { ece_10_bins: rate(calibration.ece_10_bins), multiclass_brier: number(calibration.multiclass_brier, 2), scope: string(calibration.scope) },
  };
  verifyMetrics(result);
  return result;
}

/** Only aggregate evaluation fields are public; never return review identities, source paths, cases or message text. */
export function parseEvaluationReport(value: unknown): EvaluationReport {
  const data = object(value), mode = string(data.model_mode, 30), sizes = object(data.split_sizes);
  if (!["prototype", "research", "reviewed"].includes(mode) || !Array.isArray(data.calibration_audit) || data.calibration_audit.length !== 3) throw new Error("Invalid report mode or calibration audit");
  const created = string(data.created_at, 100);
  if (!Number.isFinite(Date.parse(created))) throw new Error("Invalid report date");
  const result: EvaluationReport = {
    model_version: string(data.model_version, 256), model_mode: mode as EvaluationReport["model_mode"], synthetic_data: boolean(data.synthetic_data),
    language: string(data.language, 80), created_at: created, evaluation_scope: string(data.evaluation_scope), release_approved: boolean(data.release_approved),
    split_sizes: numericFields(sizes, ["train", "validation", "test"] as const, count),
    partition_audit: audit(data.partition_audit), calibration_audit: data.calibration_audit.map(audit),
    validation: metrics(data.validation), test: metrics(data.test),
  };
  const partitions = result.partition_audit.partitions;
  for (const name of ["train", "validation", "test"] as const) {
    if (!partitions[name] || partitions[name].message_count !== result.split_sizes[name]) throw new Error("Inconsistent partition size");
    if (name !== "train") {
      if (result[name].sample_count !== result.split_sizes[name]) throw new Error("Inconsistent evaluation size");
      for (const label of LEVELS) equalMetric(result[name].per_class[label].support, partitions[name].class_counts[label]);
    }
  }
  for (const fold of result.calibration_audit) {
    const fitted = fold.partitions.fit, calibrated = fold.partitions.calibration;
    if (!fitted || !calibrated) throw new Error("Missing calibration partition");
    for (const key of ["message_count", "student_count", "conversation_count", "independent_group_count"] as const) equalMetric(fitted[key] + calibrated[key], partitions.train[key]);
    for (const label of LEVELS) equalMetric(fitted.class_counts[label] + calibrated.class_counts[label], partitions.train.class_counts[label]);
  }
  return result;
}
export function parseContextReport(value: unknown): ContextEvaluation {
  const data = object(value), categories = object(data.categories), classes = object(data.per_class), uncertainty = object(data.uncertainty);
  const categoryNames = Object.keys(categories);
  if (!categoryNames.length || categoryNames.some((key) => !["negation", "quotation", "historical", "conversation"].includes(key)) || uncertainty.confidence_intervals !== null) throw new Error("Invalid context report");
  const result: ContextEvaluation = {
    model_version: string(data.model_version, 256), rule_version: string(data.rule_version, 256), evaluation_scope: string(data.evaluation_scope),
    sample_count: count(data.sample_count), error_count: count(data.error_count),
    categories: Object.fromEntries(categoryNames.map((key) => [key, numericFields(object(categories[key]), ["total", "correct", "errors"] as const, count)])),
    class_order: classOrder(data.class_order), confusion_matrix: matrix(data.confusion_matrix),
    per_class: Object.fromEntries(LEVELS.map((label) => {
      const item = object(classes[label]);
      return [label, { ...numericFields(item, ["support", "true_positive", "false_positive", "false_negative"] as const, count),
        precision: nullableRate(item.precision), recall: nullableRate(item.recall), f1: nullableRate(item.f1) }];
    })) as ContextEvaluation["per_class"],
    uncertainty: { confidence_intervals: null, reason: string(uncertainty.reason) },
  };
  if (!result.sample_count || result.error_count > result.sample_count || result.confusion_matrix.flat().reduce((sum, entry) => sum + entry, 0) !== result.sample_count) throw new Error("Inconsistent context totals");
  let categoryTotal = 0, categoryErrors = 0, labelErrors = 0;
  for (const category of Object.values(result.categories)) {
    if (category.correct + category.errors !== category.total) throw new Error("Inconsistent context category");
    categoryTotal += category.total; categoryErrors += category.errors;
  }
  if (categoryTotal !== result.sample_count || categoryErrors !== result.error_count) throw new Error("Inconsistent context category totals");
  for (const [index, label] of LEVELS.entries()) {
    const item = result.per_class[label], tp = result.confusion_matrix[index][index];
    const actual = result.confusion_matrix[index].reduce((sum, entry) => sum + entry, 0);
    const assigned = result.confusion_matrix.reduce((sum, row) => sum + row[index], 0);
    equalMetric(item.support, actual); equalMetric(item.true_positive, tp); equalMetric(item.false_positive, assigned - tp); equalMetric(item.false_negative, actual - tp);
    equalMetric(item.precision, assigned ? tp / assigned : null); equalMetric(item.recall, actual ? tp / actual : null); equalMetric(item.f1, actual + assigned ? 2 * tp / (actual + assigned) : null);
    labelErrors += actual - tp;
  }
  if (labelErrors > result.error_count) throw new Error("Context errors cannot omit label mismatches");
  return result;
}

async function runtime(signal?: AbortSignal): Promise<AlgorithmRuntime> {
  const url = process.env.DISTRESS_CLASSIFIER_URL;
  const configured = process.env.DISTRESS_CLASSIFIER_MODE ?? "reviewed";
  const base: AlgorithmRuntime = { status: "rules_only", configured_mode: !url ? "rules_only" : configured === "prototype" || configured === "reviewed" ? configured : "invalid",
    model_version: null, rule_version: ruleVersion, language: null, synthetic_data: false, release_approved: false,
    message: "The safety rules and conversation policy are active. No classifier is configured." };
  if (!url) return base;
  if (base.configured_mode === "invalid") return { ...base, status: "incompatible", message: "The classifier mode is invalid. Safety rules remain active." };
  try {
    const endpoint = new URL("/health", url);
    if (configured === "prototype" && (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || endpoint.username || endpoint.password)) {
      return { ...base, status: "incompatible", message: "Prototype classification requires a local HTTP service. Safety rules remain active." };
    }
    const response = await fetch(endpoint, { cache: "no-store", redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(1500), ...(signal ? [signal] : [])]),
      headers: process.env.DISTRESS_CLASSIFIER_TOKEN ? { Authorization: `Bearer ${process.env.DISTRESS_CLASSIFIER_TOKEN}` } : {},
    });
    if (!response.ok) throw new Error("Service unavailable");
    const health = object(await response.json());
    if (health.ready !== true) return { ...base, status: "unavailable", message: "The classifier service has no ready model. Safety rules remain active." };
    const provenanceMatches = configured === "prototype"
      ? health.model_mode === "prototype" && health.synthetic_data === true && health.language === "en" && health.prototype_usable === true && health.release_approved === false
      : health.release_approved === true && health.synthetic_data !== true && (health.model_mode === undefined || health.model_mode === "reviewed");
    if (!provenanceMatches) return { ...base, status: "incompatible", message: "The loaded model does not match the configured classifier mode. Safety rules remain active." };
    // Verify that the same prediction adapter used by chat accepts this service,
    // including authentication, normalized scores, thresholds and prototype provenance.
    const prediction = await predict("I am checking the prototype connection.", signal);
    if (!prediction || prediction.model_version !== health.model_version) return { ...base, status: "incompatible", message: "The classifier is responding but its model or prediction settings are incompatible. Safety rules remain active." };
    return { ...base, status: "ready", model_version: prediction.model_version,
      language: typeof health.language === "string" ? health.language : null,
      synthetic_data: health.synthetic_data === true, release_approved: health.release_approved === true,
      message: configured === "prototype" ? "The synthetic English classifier, safety rules and conversation policy are connected." : "The reviewed classifier, safety rules and conversation policy are connected.",
    };
  } catch {
    return { ...base, status: "unavailable", message: "The classifier is currently unavailable. Safety rules and conversation handling remain active." };
  }
}

async function localReport(filename: string): Promise<unknown> {
  const directory = process.env.MINDMATE_ALGORITHM_REPORT_DIR ?? path.resolve(process.cwd(), "..", "mindmate-algorithm", "artifacts", "prototype");
  // Reports are runtime artifacts supplied beside the local app, not bundled source.
  // Explicitly avoid tracing the entire checkout for this operator-configured directory.
  const target = path.join(/* turbopackIgnore: true */ directory, filename);
  if ((await stat(/* turbopackIgnore: true */ target)).size > 2 * 1024 * 1024) throw new Error("Report too large");
  return JSON.parse(await readFile(/* turbopackIgnore: true */ target, "utf8"));
}
async function loadReport<T>(name: string, parser: (value: unknown) => T, reader: (name: string) => Promise<unknown>): Promise<{ report: T | null; status: ReportStatus }> {
  try { return { report: parser(await reader(name)), status: "ready" }; }
  catch (failure) { return { report: null, status: failure instanceof Error && "code" in failure && failure.code === "ENOENT" ? "missing" : "invalid" }; }
}
export async function algorithmOverview(options: { signal?: AbortSignal; readReport?: (name: string) => Promise<unknown> } = {}): Promise<AlgorithmOverview> {
  const [service, evaluation, context] = await Promise.all([
    runtime(options.signal), loadReport("evaluation.json", parseEvaluationReport, options.readReport ?? localReport),
    loadReport("context-evaluation.json", parseContextReport, options.readReport ?? localReport),
  ]);
  if (evaluation.report && service.model_version && evaluation.report.model_version !== service.model_version) evaluation.status = "stale";
  if (context.report && (context.report.rule_version !== ruleVersion || !evaluation.report || context.report.model_version !== evaluation.report.model_version || evaluation.status === "stale")) context.status = "stale";
  return { checked_at: new Date().toISOString(), runtime: service, evaluation: evaluation.report, evaluation_status: evaluation.status, context: context.report, context_status: context.status };
}
