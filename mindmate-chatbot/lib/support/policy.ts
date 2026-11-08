import { analyzeSafety, conversationState, ruleReviewStatus, ruleVersion, safeReply, unsafeReply } from "./safety.ts";
import { higher, LEVELS, type ChatMessage, type ConversationState, type ModelPrediction, type SupportDecision, type SupportLevel } from "./types.ts";

const labels: Record<SupportLevel, string> = {
  LOW: "Routine support", MODERATE: "Additional support",
  HIGH_CONCERN: "High support priority", IMMEDIATE_SAFETY: "Immediate safety support",
};

export function prioritize(message: string, history: ChatMessage[] = [], model: ModelPrediction | null = null, previous?: ConversationState): SupportDecision {
  const state = conversationState(history);
  if (previous) {
    state.highest_level = higher(state.highest_level, previous.highest_level);
    state.prior_high_concern ||= previous.prior_high_concern;
    state.prior_immediate_concern ||= previous.prior_immediate_concern;
    if (!state.safety_question_active && previous.safety_question_active) {
      state.safety_question_active = true;
      state.safety_question_kind = previous.safety_question_kind ?? "safe";
    }
  }
  const safety = analyzeSafety(message);
  if (safeReply(message, state.safety_question_kind) && (safety.level === "LOW" || safety.level === "MODERATE")) state.safety_question_active = false;
  let level = safety.level;
  let source: SupportDecision["source"] = "rules_only";
  let confidence: number | null = null;
  let uncertain = false;
  if (model) {
    const predicted = LEVELS.reduce((best, candidate) => model.scores[candidate] > model.scores[best] ? candidate : best);
    confidence = model.scores[predicted];
    let mlLevel = predicted;
    if (model.scores.IMMEDIATE_SAFETY >= model.thresholds.immediate) mlLevel = "IMMEDIATE_SAFETY";
    else if (model.scores.IMMEDIATE_SAFETY + model.scores.HIGH_CONCERN >= model.thresholds.high) mlLevel = higher(mlLevel, "HIGH_CONCERN");
    uncertain = confidence < model.thresholds.confidence;
    if (uncertain) mlLevel = higher(mlLevel, "MODERATE");
    level = higher(level, mlLevel);
    source = uncertain ? "uncertain_model" : safety.level !== "LOW" ? "hybrid" : "ml";
  }
  if (state.prior_high_concern) level = higher(level, "MODERATE");
  // An unresolved safety question cannot be dismissed by an unrelated or reassuring keyword.
  if (state.safety_question_active) level = higher(level, "HIGH_CONCERN");
  if (state.safety_question_active && unsafeReply(message, state.safety_question_kind)) {
    level = "IMMEDIATE_SAFETY"; source = "conversation_context";
    safety.matched_rules.push("unsafe_safety_question_reply");
  }
  if (safety.current_action || safety.level === "IMMEDIATE_SAFETY") source = "safety_override";
  state.highest_level = higher(state.highest_level, level);
  state.prior_high_concern ||= level === "HIGH_CONCERN" || level === "IMMEDIATE_SAFETY";
  state.prior_immediate_concern ||= level === "IMMEDIATE_SAFETY";
  const safetyResponse = level === "HIGH_CONCERN" || level === "IMMEDIATE_SAFETY";
  const subject = safety.contexts.includes("third_party") && !safety.first_person_concern ? "other" : "student";
  // The deterministic template asks a safety question about the student, except third-party-only cases.
  state.safety_question_active = safetyResponse && subject === "student";
  state.safety_question_kind = state.safety_question_active ? "safe" : null;
  return {
    level, display_label: labels[level], source, confidence,
    requires_human_review: safetyResponse || uncertain || (!model && level === "MODERATE"),
    safety_response_required: safetyResponse, model: model?.scores ?? null,
    rules: safety.matched_rules, model_version: model?.model_version ?? null,
    rule_version: ruleVersion, rule_review_status: ruleReviewStatus, state,
    subject,
  };
}
