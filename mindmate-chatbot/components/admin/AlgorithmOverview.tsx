"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, FlaskConical, Layers3, ShieldCheck } from "lucide-react";
import { useAlgorithmOverview } from "./AlgorithmProvider";
import AlgorithmStatus from "./AlgorithmStatus";
import { dateTime, MetricCard, number, percent, PriorityBadge, SectionTitle } from "./algorithm-ui";

export default function AlgorithmOverview() {
  const { data, loading, recentTests } = useAlgorithmOverview();
  const evaluation = data?.evaluation;
  const context = data?.context;
  const total = evaluation ? Object.values(evaluation.split_sizes).reduce((sum, count) => sum + count, 0) : 0;
  const calibrationPassed = Boolean(evaluation?.calibration_audit.length && evaluation.calibration_audit.every((fold) => fold.passed));

  return <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><Layers3 className="size-4" /> Support-priority classification</p><h1 className="font-serif text-3xl">Classification overview</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Prioritize counselor attention from the available message, from routine supportive responses to potential safety-related content requiring priority human review. Inspect live service health, saved model evaluation, and test decisions.</p></div>
      <Link href="/admin/tester" className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-85"><FlaskConical className="size-4" /> Test a message</Link>
    </header>

    <AlgorithmStatus variant="details" />

    {!evaluation ? <section className="rounded-2xl border border-dashed border-border p-8 text-center"><h2 className="!text-base font-semibold">{loading ? "Loading saved evaluation…" : "No current evaluation is available"}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{loading ? "The report is read from the trained model's saved artifacts." : "Start the full development app to prepare the prototype model, then refresh its status. The message tester can still use the independent rules when the classifier is unavailable."}</p></section> : <>
      <section aria-label="Evaluation source" className="rounded-2xl border border-border bg-card px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{evaluation.synthetic_data ? "Synthetic English evaluation" : "Saved classifier evaluation"}</p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{evaluation.model_version}</p></div><time className="text-xs text-muted-foreground" dateTime={evaluation.created_at}>Trained {dateTime(evaluation.created_at)}</time></div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{evaluation.evaluation_scope}</p>
        {data?.evaluation_status === "stale" && <p role="status" className="mt-3 rounded-lg bg-warning-surface p-3 text-xs text-warning">This saved report does not match the currently connected model. Its metrics describe the saved version above.</p>}
      </section>

      <section aria-label="Saved classifier metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Validation macro F1" value={percent(evaluation.validation.macro_f1)} description={`${number(evaluation.validation.sample_count)} validation messages across all four classes.`} />
        <MetricCard label="Regression macro F1" value={percent(evaluation.test.macro_f1)} description="Synthetic regression results, not real-student accuracy." />
        <MetricCard label="Immediate-attention recall" value={percent(evaluation.test.immediate_recall)} description={`${number(evaluation.test.error_counts.immediate_safety_false_negative)} misses out of ${number(evaluation.test.error_counts.immediate_safety_actual)} regression examples.`} />
        <MetricCard label="High-priority false positives" value={percent(evaluation.test.combined_false_positive_rate)} description={`${number(evaluation.test.error_counts.high_priority_false_positive)} lower-priority regression messages were escalated.`} />
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border p-5"><SectionTitle title="Training and evaluation partitions" description={`${number(total)} labeled messages in the saved dataset. Related messages stay in one partition.`} />
          <div className="mt-5 space-y-4">{(["train", "validation", "test"] as const).map((name) => {
            const count = evaluation.split_sizes[name];
            const groups = evaluation.partition_audit.partitions[name]?.independent_group_count;
            return <div key={name}><div className="flex items-baseline justify-between gap-3 text-xs"><span className="font-semibold">{name === "train" ? "Training" : name === "test" ? "Regression evaluation" : "Validation"}</span><span className="tabular-nums text-muted-foreground">{number(count)} messages · {number(groups)} groups</span></div><div className="mt-2 h-2 rounded-full bg-card"><div className="h-full rounded-full bg-foreground/75" style={{ width: `${total ? count / total * 100 : 0}%` }} /></div></div>;
          })}</div>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">A group can contain many related messages. More messages do not necessarily mean more independent evidence.</p>
        </section>
        <section className="rounded-2xl border border-border p-5"><SectionTitle title="Separation and context checks" description="Aggregate evidence from saved training and policy verification." />
          <dl className="mt-5 space-y-4 text-sm"><div className="flex items-start justify-between gap-4"><dt className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /> Holdout separation</dt><dd className="font-semibold">{evaluation.partition_audit.passed ? "Passed" : "Needs review"}</dd></div><div className="flex items-start justify-between gap-4"><dt>Grouped calibration folds</dt><dd className="font-semibold">{calibrationPassed ? `${evaluation.calibration_audit.length}/${evaluation.calibration_audit.length} passed` : "Not verified"}</dd></div><div className="flex items-start justify-between gap-4"><dt>English context challenges</dt><dd className="font-semibold">{context ? `${number(context.sample_count - context.error_count)}/${number(context.sample_count)} matched` : "Report unavailable"}</dd></div></dl>
          {data?.context_status === "stale" && <p className="mt-4 rounded-lg bg-warning-surface p-3 text-xs leading-5 text-warning">Context results belong to an earlier model or rule version. Re-run verification before treating them as current.</p>}
          <Link href="/model-lab/reports" className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold hover:underline">Inspect per-class errors and uncertainty <ArrowRight className="size-3.5" /></Link>
        </section>
      </div>
    </>}

    <section className="overflow-hidden rounded-2xl border border-border" aria-label="Recent classification tests">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-4"><SectionTitle title="Recent tests in this session" description="Your actual tester decisions for this visit. Refreshing clears this list. Student records and review requests are separate." /><span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold">{recentTests.length} recent</span></div>
      {recentTests.length === 0 ? <div className="px-5 py-9 text-center"><CheckCircle2 className="mx-auto mb-3 size-6 text-muted-foreground" /><p className="text-sm font-medium">No messages tested in this session</p><p className="mt-1 text-xs text-muted-foreground">Open Classification tester and analyze a message to see its real result here.</p><Link href="/admin/tester" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold hover:underline">Open tester <ArrowRight className="size-3.5" /></Link></div> : <ul className="divide-y divide-border">{recentTests.slice(0, 8).map(({ id, recorded_at, result }) => <li key={id} className="flex flex-wrap items-center gap-3 px-5 py-4"><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm">{result.evaluated_message}</p><p className="mt-1 text-[11px] text-muted-foreground">{dateTime(recorded_at)} · {result.history_count} previous messages · {result.decision.model_mode === "prototype" ? "Synthetic model contributed" : result.decision.model_mode === "reviewed" ? "Reviewed model contributed" : "Rules or conversation context"}</p></div><PriorityBadge level={result.decision.level} /></li>)}</ul>}
    </section>
  </div>;
}
