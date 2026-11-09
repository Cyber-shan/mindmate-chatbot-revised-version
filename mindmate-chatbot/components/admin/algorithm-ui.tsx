import type { ReactNode } from "react";
import type { MetricInterval } from "@/lib/support/overview-types";
import { SUPPORT_PRIORITIES, type SupportLevel } from "@/lib/support/types";

export const PRIORITIES: Record<SupportLevel, { label: string; description: string; color: string; background: string }> = {
  LOW: { ...SUPPORT_PRIORITIES.LOW, color: "var(--priority-low)", background: "var(--priority-low-surface)" },
  MODERATE: { ...SUPPORT_PRIORITIES.MODERATE, color: "var(--priority-moderate)", background: "var(--priority-moderate-surface)" },
  HIGH_CONCERN: { ...SUPPORT_PRIORITIES.HIGH_CONCERN, color: "var(--priority-high)", background: "var(--priority-high-surface)" },
  IMMEDIATE_SAFETY: { ...SUPPORT_PRIORITIES.IMMEDIATE_SAFETY, color: "var(--priority-immediate)", background: "var(--priority-immediate-surface)" },
};

export function percent(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "Unavailable";
}

export function number(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "Unavailable";
}

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function intervalText(interval?: MetricInterval): string {
  if (!interval) return "Unavailable";
  if (interval.lower !== null && interval.upper !== null) return `${percent(interval.lower)}–${percent(interval.upper)}`;
  if (interval.status === "no_observed_variation") return "Not estimable: no observed variation";
  if (interval.status === "insufficient_groups") return "Not estimable: insufficient groups or class support";
  return "Not estimable";
}

export function PriorityBadge({ level }: { level: SupportLevel }) {
  const style = PRIORITIES[level];
  return <span className="inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: style.color, background: style.background }}>{style.label}</span>;
}

export function MetricCard({ label, value, description, children }: { label: string; value: string; description?: string; children?: ReactNode }) {
  return <div className="min-w-0 rounded-2xl border border-border bg-card p-4 md:p-5">
    <p className="text-xs font-semibold text-muted-foreground">{label}</p>
    <p className="mt-3 break-words font-serif text-3xl tabular-nums text-foreground">{value}</p>
    {description && <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>}
    {children}
  </div>;
}

export function SectionTitle({ title, description }: { title: string; description?: string }) {
  return <div><h2 className="!text-base font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}</div>;
}
