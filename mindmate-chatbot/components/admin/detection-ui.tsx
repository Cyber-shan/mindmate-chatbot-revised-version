import type { SupportLevel } from "@/lib/support/types";
import type { ReviewStatus } from "@/lib/admin/detection-types";
import { PriorityBadge } from "./algorithm-ui";

export function AccountPriority({ level }: { level: SupportLevel | null }) {
  return level ? <PriorityBadge level={level} /> : <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">No unresolved detections</span>;
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  not_required: "No review requested", unconfigured: "Review requests unavailable", pending: "Awaiting review",
  reviewed: "Reviewed · follow-up open", resolved: "Resolved", false_positive: "Closed · false positive",
};

export function reportDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
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
