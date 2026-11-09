import type { SupportLevel } from "./types.ts";

export type ReportStatus = "ready" | "missing" | "invalid" | "stale";
export type MetricInterval = {
  lower: number | null;
  upper: number | null;
  valid_resamples: number;
  status: string;
};
export type ClassMetrics = {
  precision: number;
  recall: number;
  "f1-score": number;
  support: number;
  true_positive: number;
  false_positive: number;
  false_negative: number;
  true_negative: number;
  predicted_count: number;
  precision_defined: boolean;
  recall_defined: boolean;
};
export type EvaluationMetrics = {
  sample_count: number;
  accuracy_informational: number;
  macro_f1: number;
  immediate_recall: number | null;
  combined_recall: number | null;
  critical_false_negative_rate: number | null;
  immediate_false_negative_rate: number | null;
  combined_false_positive_rate: number | null;
  combined_f2: number;
  confusion_matrix: number[][];
  class_order: SupportLevel[];
  per_class: Record<SupportLevel, ClassMetrics>;
  error_counts: {
    correct: number; incorrect: number; under_prioritized: number; over_prioritized: number;
    immediate_safety_actual: number; immediate_safety_false_negative: number; immediate_safety_false_positive: number;
    high_priority_actual: number; high_priority_false_negative: number; high_priority_false_positive: number;
    lower_priority_actual: number;
  };
  uncertainty: {
    confidence_threshold: number | null;
    low_confidence_count: number | null;
    low_confidence_rate: number | null;
    low_confidence_error_count: number | null;
    mean_normalized_entropy: number;
    confidence_definition: string;
  };
  confidence_intervals: {
    method: string; confidence_level: number; resamples: number; seed: number;
    sampling_unit: string; independent_group_count: number; small_group_warning: boolean; limitations: string;
    metrics: Record<string, MetricInterval>;
    per_class: Record<SupportLevel, { precision: MetricInterval; recall: MetricInterval; f1: MetricInterval }>;
  };
  calibration: { ece_10_bins: number; multiclass_brier: number; scope: string };
};
export type PartitionSummary = {
  message_count: number; student_count: number; conversation_count: number; independent_group_count: number;
  class_counts: Record<SupportLevel, number>;
};
export type PartitionAudit = {
  passed: boolean;
  checked_fields: string[];
  partitions: Record<string, PartitionSummary>;
};
export type EvaluationReport = {
  model_version: string;
  model_mode: "prototype" | "reviewed" | "research";
  synthetic_data: boolean;
  language: string;
  created_at: string;
  evaluation_scope: string;
  release_approved: boolean;
  split_sizes: { train: number; validation: number; test: number };
  partition_audit: PartitionAudit;
  calibration_audit: PartitionAudit[];
  validation: EvaluationMetrics;
  test: EvaluationMetrics;
};
export type ContextEvaluation = {
  model_version: string;
  rule_version: string;
  evaluation_scope: string;
  sample_count: number;
  error_count: number;
  categories: Record<string, { total: number; correct: number; errors: number }>;
  class_order: SupportLevel[];
  confusion_matrix: number[][];
  per_class: Record<SupportLevel, {
    support: number; true_positive: number; false_positive: number; false_negative: number;
    precision: number | null; recall: number | null; f1: number | null;
  }>;
  uncertainty: { confidence_intervals: null; reason: string };
};
export type AlgorithmRuntime = {
  status: "ready" | "rules_only" | "unavailable" | "incompatible";
  configured_mode: "prototype" | "reviewed" | "rules_only" | "invalid";
  model_version: string | null;
  rule_version: string;
  language: string | null;
  synthetic_data: boolean;
  release_approved: boolean;
  message: string;
};
export type AlgorithmOverview = {
  checked_at: string;
  runtime: AlgorithmRuntime;
  evaluation: EvaluationReport | null;
  evaluation_status: ReportStatus;
  context: ContextEvaluation | null;
  context_status: ReportStatus;
};
