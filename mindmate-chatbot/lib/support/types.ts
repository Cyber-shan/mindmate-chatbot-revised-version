export const LEVELS = ["LOW", "MODERATE", "HIGH_CONCERN", "IMMEDIATE_SAFETY"] as const;
export type SupportLevel = (typeof LEVELS)[number];
// Keep persisted/model class keys stable; use these names and meanings for display.
export const SUPPORT_PRIORITIES = {
  LOW: {
    label: "Low priority",
    description: "Routine supportive response; no direct counselor attention indicated by the available message.",
  },
  MODERATE: {
    label: "Moderate priority",
    description: "Counselor attention recommended, but not urgently.",
  },
  HIGH_CONCERN: {
    label: "High priority",
    description: "Counselor attention recommended as soon as possible.",
  },
  IMMEDIATE_SAFETY: {
    label: "Immediate attention",
    description: "Potential safety-related content requiring priority human review.",
  },
} as const satisfies Record<SupportLevel, { label: string; description: string }>;

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Scores = Record<SupportLevel, number>;

export type ModelPrediction = {
  scores: Scores;
  model_version: string;
  model_mode: "reviewed" | "prototype";
  thresholds: { immediate: number; high: number; confidence: number };
};

export type ConversationState = {
  highest_level: SupportLevel;
  safety_question_active: boolean;
  safety_question_kind?: "safe" | "danger" | null;
  prior_high_concern: boolean;
  prior_immediate_concern: boolean;
};

export type SafetySignal = {
  level: SupportLevel;
  matched_rules: string[];
  current_action: boolean;
  direct_intent: boolean;
  first_person_concern: boolean;
  temporal_immediacy: boolean;
  contexts: string[];
};

export type SupportDecision = {
  level: SupportLevel;
  display_label: string;
  source: "rules_only" | "ml" | "hybrid" | "safety_override" | "conversation_context" | "uncertain_model";
  confidence: number | null;
  requires_human_review: boolean;
  safety_response_required: boolean;
  model: Scores | null;
  rules: string[];
  model_version: string | null;
  model_mode: ModelPrediction["model_mode"] | null;
  rule_version: string;
  rule_review_status: string;
  subject: "student" | "other";
  state: ConversationState;
};

// Only this limited, actionable information is sent to the student interface.
export type StudentSupport = {
  safety_response_required: boolean;
  review_status: "queued" | "unavailable" | "not_required";
  resources: { label: string; href: string }[];
};

export function higher(a: SupportLevel, b: SupportLevel): SupportLevel {
  return LEVELS[Math.max(LEVELS.indexOf(a), LEVELS.indexOf(b))];
}
