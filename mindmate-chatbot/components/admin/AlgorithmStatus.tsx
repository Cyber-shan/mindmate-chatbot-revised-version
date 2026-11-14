"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { useAlgorithmOverview } from "./AlgorithmProvider";
import { dateTime } from "./algorithm-ui";

export default function AlgorithmStatus({ variant = "compact" }: {
  variant?: "indicator" | "compact" | "details";
}) {
  const { data, loading, error, refresh, privateReports } = useAlgorithmOverview();
  const ready = Boolean(data?.runtime.status === "ready" && !error);
  const checking = !data && loading;
  const warning = !ready && !checking;
  const detailed = variant === "details";
  const inline = variant === "indicator" && !warning;
  const title = checking ? "Checking classification service…"
    : error || !data ? "Classification status unavailable"
      : ready ? "Classification service available"
        : data.runtime.status === "rules_only" ? "Rules-only classification"
          : data.runtime.status === "incompatible" ? "Classifier connection needs attention"
            : "Classifier unavailable";
  const description = error || !data
    ? detailed && error ? error : "Classification service availability could not be confirmed. Try refreshing."
    : detailed || ready ? data.runtime.message
      : data.runtime.status === "rules_only"
        ? "The trained classifier is not configured. Safety rules and conversation handling remain active."
        : "The trained classifier cannot be used right now. Safety rules and conversation handling remain active; decisions may differ without the model.";
  const Icon = checking ? LoaderCircle : ready ? CheckCircle2 : AlertCircle;

  return <section aria-label="Live classification status" className={inline ? "inline-flex max-w-full items-center gap-3" : `rounded-xl border ${detailed ? "px-4 py-4 md:px-5" : "px-3 py-2.5"} ${warning ? "border-warning-border bg-warning-surface/60" : "border-border bg-card"}`}>
    <div className={`flex min-w-0 flex-wrap justify-between gap-3 ${detailed || warning ? "items-start" : "items-center"}`}>
      <div className={`min-w-0 flex-1 ${warning || detailed ? "basis-full sm:basis-0" : ""}`}>
        <p data-testid="algorithm-runtime-status" role="status" className={`flex items-center gap-2 ${detailed ? "text-sm" : "text-xs"} font-semibold`}><Icon className={`size-4 shrink-0 ${checking ? "animate-spin text-muted-foreground" : ready ? "text-success" : "text-warning"}`} aria-hidden />{title}</p>
        {(warning || detailed) && <p className="mt-1 text-xs leading-5 text-muted-foreground">{checking ? "Checking the classifier connection." : description}</p>}
        {error && data && <p className="mt-1 text-xs text-warning">Last successful check: <time dateTime={data.checked_at}>{dateTime(data.checked_at)}</time>. Current availability is unknown.</p>}
      </div>
      {!inline && <div className="ml-auto flex shrink-0 items-center gap-3">
        {!detailed && privateReports && <Link href="/model-lab" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" aria-label="View classification service details">Details</Link>}
        <button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 !text-xs font-semibold hover:bg-accent disabled:cursor-wait disabled:opacity-60" aria-label="Refresh classification status">{loading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />} Refresh</button>
      </div>}
    </div>
    {inline && privateReports && <Link href="/model-lab" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" aria-label="View classification service details">Details</Link>}
    {detailed && data && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
      <span className="rounded-md bg-background px-2 py-1 font-semibold">{data.runtime.synthetic_data ? "Synthetic English prototype" : data.runtime.status === "ready" ? "Reviewed classifier" : "Rules and context fallback"}</span>
      <span>Rules: {data.runtime.rule_version}</span>
      {data.runtime.model_version && <span className="min-w-0 break-all">Model: {data.runtime.model_version}</span>}
      <time dateTime={data.checked_at}>{error ? "Last successful check" : "Checked"} {dateTime(data.checked_at)}</time>
    </div>}
  </section>;
}
