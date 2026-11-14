import { PRIORITY_ORDER, type DetectedAccount, type WorkflowStatus } from "./detection-types.ts";
import type { SupportLevel } from "../support/types.ts";

export type QueueFilters = { search: string; priority: SupportLevel | "all"; view: "unresolved" | "all" | "closed"; status: WorkflowStatus | "all"; assignee: string; hours: number; sort: "priority" | "waiting" | "latest" };
export function filterQueue(accounts: DetectedAccount[], filters: QueueFilters, now: number) {
  const needle = filters.search.trim().toLowerCase();
  const rank = (account: DetectedAccount) => account.priority ? PRIORITY_ORDER.indexOf(account.priority) : PRIORITY_ORDER.length;
  const wait = (account: DetectedAccount) => Date.parse(account.priority_since ?? account.latest_detection_at);
  return accounts.filter((account) => {
    if (filters.view === "unresolved" && !account.priority || filters.view === "closed" && account.priority) return false;
    if (filters.priority !== "all" && account.priority !== filters.priority) return false;
    if (needle && !`${account.name} ${account.email ?? ""} ${account.student_id}`.toLowerCase().includes(needle)) return false;
    return account.review_items.some((item) => (filters.view !== "unresolved" || !["resolved", "false_positive"].includes(item.status))
      && (filters.status === "all" || item.status === filters.status)
      && (filters.assignee === "all" || (filters.assignee === "unassigned" ? item.assignee_id === null : item.assignee_id === filters.assignee))
      && (!filters.hours || Date.parse(item.created_at) >= now - filters.hours * 3600000));
  }).sort((a, b) => (filters.sort === "priority" ? rank(a) - rank(b) || wait(a) - wait(b)
    : filters.sort === "waiting" ? Number(!a.priority) - Number(!b.priority) || wait(a) - wait(b)
    : Date.parse(b.latest_detection_at) - Date.parse(a.latest_detection_at)) || a.student_id.localeCompare(b.student_id));
}

export function waitingTime(value: string | null, now: number) {
  if (!value) return "—";
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  if (!Number.isFinite(minutes)) return "Unknown time";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
