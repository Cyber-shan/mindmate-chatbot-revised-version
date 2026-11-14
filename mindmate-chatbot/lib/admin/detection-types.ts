import type { SupportLevel } from "../support/types.ts";

export const PRIORITY_ORDER = ["IMMEDIATE_SAFETY", "HIGH_CONCERN", "MODERATE", "LOW"] as const;
export type ReviewStatus = "not_required" | "unconfigured" | "pending" | "reviewed" | "resolved" | "false_positive";
export type PriorityCounts = Record<SupportLevel, number>;
export const WORKFLOW_LABELS = { needs_review: "Needs review", assigned: "Assigned", contact_attempted: "Contact attempted", reviewed: "Reviewed · follow-up open", resolved: "Resolved", false_positive: "False positive" } as const;
export type WorkflowStatus = keyof typeof WORKFLOW_LABELS;
export type StaffMember = { id: string; email: string; name: string };
export type ReviewItem = { status: WorkflowStatus; assignee_id: string | null; created_at: string };
export type ReviewHistory = { id: string; event_id: string; version: number; actor_email: string; from_status: WorkflowStatus; to_status: WorkflowStatus; from_assignee_email: string | null; to_assignee_email: string | null; note: string; created_at: string };

export type DetectedAccount = {
  student_id: string;
  name: string;
  email: string | null;
  identity_available: boolean;
  priority: SupportLevel | null;
  priority_since: string | null;
  latest_detection_at: string;
  first_detection_at: string;
  total_detections: number;
  unresolved_detections: number;
  conversation_count: number;
  unresolved_by_priority: PriorityCounts;
  workflow_status: WorkflowStatus;
  assignee_id: string | null;
  review_items: ReviewItem[];
};

export type DetectionDashboard = {
  generated_at: string;
  staff: { email: string | null };
  students: DetectedAccount[];
  accounts_by_priority: PriorityCounts;
  total_detections: number;
  unresolved_detections: number;
  identity_unavailable: number;
  review_queue_enabled: boolean;
  staff_members: StaffMember[];
};

export type DetectionReportEntry = {
  id: string;
  conversation_id: string;
  message_id: string;
  level: SupportLevel;
  review_status: ReviewStatus;
  created_at: string;
  message: string | null;
  source: string | null;
  subject: "student" | "other" | null;
  model_mode: "prototype" | "reviewed" | null;
  workflow_status: WorkflowStatus;
  assignee_id: string | null;
  workflow_version: number;
};

export type StudentDetectionReport = {
  generated_at: string;
  student: DetectedAccount;
  events: DetectionReportEntry[];
  total_events: number;
  review_queue_enabled: boolean;
  staff_members: StaffMember[];
};
