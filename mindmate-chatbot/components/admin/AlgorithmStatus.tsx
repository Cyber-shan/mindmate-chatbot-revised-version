"use client";

import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useAlgorithmOverview } from "./AlgorithmProvider";
import { dateTime } from "./algorithm-ui";

export default function AlgorithmStatus() {
  const { data, loading, error, refresh } = useAlgorithmOverview();
  const ready = Boolean(data?.runtime.status === "ready" && !error);
  const title = !data ? loading ? "Checking algorithm services…" : "Algorithm status unavailable"
    : error ? "Status refresh failed" : data.runtime.status === "ready" ? "Classifier connected"
      : data.runtime.status === "rules_only" ? "Rules and context active" : "Classifier unavailable — rules remain active";
  const Icon = ready ? CheckCircle2 : data ? ShieldCheck : AlertCircle;

  return <section aria-label="Live algorithm status" className={`rounded-2xl border px-4 py-4 md:px-5 ${ready ? "border-success-border bg-success-surface/60" : "border-warning-border bg-warning-surface/60"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p data-testid="algorithm-runtime-status" role="status" className="flex items-center gap-2 text-sm font-semibold">{!data && loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Icon className={`size-4 shrink-0 ${ready ? "text-success" : "text-warning"}`} aria-hidden />}{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{error ?? data?.runtime.message ?? "Checking the classifier and reading saved evaluation artifacts."}</p>
        {error && data && <p className="mt-1 text-xs text-warning">The details below are from the last successful check.</p>}
      </div>
      <button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 !text-xs font-semibold hover:bg-accent disabled:cursor-wait disabled:opacity-60" aria-label="Refresh algorithm status">{loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh</button>
    </div>
    {data && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/5 pt-3 text-[11px] text-muted-foreground">
      <span className="rounded-md bg-background px-2 py-1 font-semibold">{data.runtime.synthetic_data ? "Synthetic English prototype" : data.runtime.status === "ready" ? "Reviewed classifier" : "Rules and context fallback"}</span>
      <span>Rules: {data.runtime.rule_version}</span>
      {data.runtime.model_version && <span className="min-w-0 break-all">Model: {data.runtime.model_version}</span>}
      <time dateTime={data.checked_at}>Checked {dateTime(data.checked_at)}</time>
    </div>}
  </section>;
}
