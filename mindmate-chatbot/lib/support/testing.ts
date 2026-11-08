import type { SafetySignal, SupportDecision } from "./types.ts";

export type AlgorithmTestResult = {
  decision: SupportDecision;
  safety_signal: SafetySignal;
  evaluated_message: string;
  history_count: number;
  elapsed_ms: number;
  response_preview: string | null;
  test_only: true;
};
