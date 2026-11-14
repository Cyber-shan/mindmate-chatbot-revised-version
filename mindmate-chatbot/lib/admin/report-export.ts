import type { DetectedAccount, StudentDetectionReport } from "./detection-types.ts";
import { SUPPORT_PRIORITIES, type SupportLevel } from "../support/types.ts";

const label = (value: SupportLevel | null) => value ? SUPPORT_PRIORITIES[value].label : "No unresolved detections";

function cell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  // Quoting alone does not stop spreadsheet software from evaluating a formula.
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function csv(rows: (string | number | null)[][]) {
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function accountSummaryCsv(accounts: DetectedAccount[], generatedAt: string) {
  return csv([
    ["Student name", "Email", "Account ID", "Highest unresolved account priority", "Unresolved detections", "Total detections", "Conversations", "Priority since (UTC)", "Latest detection (UTC)", "Report generated at (UTC)", "Priority detection review status", "Priority detection assignee ID"],
    ...accounts.map((account) => [account.name, account.email, account.student_id, label(account.priority), account.unresolved_detections, account.total_detections, account.conversation_count, account.priority_since, account.latest_detection_at, generatedAt, account.workflow_status ?? "needs_review", account.assignee_id ?? null]),
  ]);
}

export function studentReportCsv(report: StudentDetectionReport) {
  return csv([
    ["Student name", "Email", "Account ID", "Detection ID", "Individual detection priority", "Review status", "Detected at (UTC)", "Conversation ID", "Message", "Concern subject", "Decision source", "Report generated at (UTC)", "Account priority", "Assignee ID"],
    ...report.events.map((event) => [report.student.name, report.student.email, report.student.student_id, event.id, label(event.level), event.workflow_status ?? event.review_status, event.created_at, event.conversation_id, event.message, event.subject, event.source, report.generated_at, label(report.student.priority), event.assignee_id ?? null]),
  ]);
}
