import type { SupportLevel } from "@/lib/support/types";
import type { ReviewStatus } from "@/lib/admin/detection-types";
import { PriorityBadge } from "./algorithm-ui";
import { WORKFLOW_LABELS, type WorkflowStatus } from "@/lib/admin/detection-types";
import { waitingTime } from "@/lib/admin/queue";
import { CircleAlert, Clock3 } from "lucide-react";

export function AccountPriority({ level }: { level: SupportLevel | null }) {
  return level ? <span className="inline-flex items-center gap-1.5"><CircleAlert className="size-4 shrink-0" aria-hidden="true" /><PriorityBadge level={level} /></span> : <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">No unresolved detections</span>;
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  not_required: "No review requested", unconfigured: "Review requests unavailable", pending: "Awaiting review",
  reviewed: "Reviewed · follow-up open", resolved: "Resolved", false_positive: "Closed · false positive",
};

export function reportDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value)) + " PHT" : "—";
}

export function WorkflowBadge({ status }: { status: WorkflowStatus }) {
  return <span className="inline-flex rounded-md border border-border bg-card px-2 py-1 text-xs font-medium">{WORKFLOW_LABELS[status]}</span>;
}
export function WaitingSince({ value, now }: { value: string | null; now: number }) {
  return <span className="inline-flex items-center gap-1.5" title={reportDate(value)}><Clock3 className="size-3.5 shrink-0" aria-hidden="true" /><time dateTime={value ?? undefined}>{waitingTime(value, now)}</time></span>;
}

export function downloadCsv(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class ReportRequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function fetchReport<T>(token: string, signal: AbortSignal, studentId?: string): Promise<T> {
  const response = await fetch(`/api/admin/detections${studentId ? `?student_id=${encodeURIComponent(studentId)}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
  });
  const body = await response.json();
  if (!response.ok) throw new ReportRequestError(body.error || "The student report could not be loaded.", response.status);
  return body as T;
}
