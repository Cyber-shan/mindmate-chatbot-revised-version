"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, FileText, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { StudentDetectionReport as Report } from "@/lib/admin/detection-types";
import { SUPPORT_PRIORITIES } from "@/lib/support/types";
import { studentReportCsv } from "@/lib/admin/report-export";
import { AccountPriority, downloadCsv, fetchReport, reportDate, ReportRequestError, WaitingSince, WorkflowBadge } from "./detection-ui";
import ReviewEditor from "./ReviewEditor";

export default function StudentDetectionReport({ studentId, token, onClose, onDenied, onUpdated, onReturnFocus }: {
  studentId: string; token: string; onClose: () => void; onDenied: (message: string) => void; onUpdated: () => void; onReturnFocus: () => void;
}) {
  const [state, setState] = useState<{ data: Report | null; error: string | null }>({ data: null, error: null });
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const requestToken = useRef(token);
  useEffect(() => { requestToken.current = token; }, [token]);
  const dirty = Object.values(drafts).some(Boolean);
  const markDirty = useCallback((id: string, value: boolean) => setDrafts((previous) => previous[id] === value ? previous : { ...previous, [id]: value }), []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchReport<Report>(requestToken.current, controller.signal, studentId).then((data) => {
      if (!controller.signal.aborted) setState({ data, error: null });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      if (error instanceof ReportRequestError && [401, 403].includes(error.status)) { onDenied(error.message); return; }
      setState((previous) => ({ data: previous.data, error: error instanceof Error ? error.message : "The account report could not be loaded." }));
    });
    return () => controller.abort();
  }, [studentId, revision, onDenied]);
  const { data, error } = state;
  const index = Math.max(0, data?.events.findIndex((event) => event.id === selected) ?? 0);
  const active = data?.events[index]?.id;
  const choose = (id: string) => { setSelected(id); requestAnimationFrame(() => { const target = document.getElementById(`detection-${id}`); target?.scrollIntoView({ block: "start" }); target?.focus({ preventScroll: true }); }); };
  const close = () => { if (!dirty || window.confirm("Discard unsaved review changes and close this report?")) onClose(); };
  return <Dialog.Root open modal onOpenChange={(value) => { if (!value) close(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
    <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }} aria-describedby="student-report-description" className="admin-design fixed inset-y-0 right-0 z-50 flex h-dvh w-full flex-col bg-background shadow-2xl focus:outline-none sm:max-w-3xl" data-testid="student-detection-report">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5 sm:p-6"><div className="min-w-0"><p className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground"><FileText className="size-4" /> Student detection report</p><Dialog.Title className="break-words font-serif text-2xl">{data?.student.name ?? "Account report"}</Dialog.Title><Dialog.Description id="student-report-description" className="mt-1 break-all text-sm text-muted-foreground">{data?.student.email ?? studentId}</Dialog.Description></div><Dialog.Close aria-label="Close student report" className="shrink-0 rounded-full border border-border p-2.5 hover:bg-card"><X className="size-5" /></Dialog.Close></div>
      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 sm:p-6">
        {!data && !error && <p role="status" className="flex items-center gap-2 py-12 text-sm"><LoaderCircle className="size-4 animate-spin" /> Loading saved detections…</p>}
        {error && <div role="alert" className="rounded-xl border border-warning-border bg-warning-surface p-4 text-sm text-warning"><p>{error} {data && "The previous report remains visible."}</p><button className="mt-3 font-semibold underline" onClick={() => setRevision((value) => value + 1)}>Retry report</button></div>}
        {data && <>
          <div className="space-y-2 text-xs leading-5 text-muted-foreground"><p>This is a fixed report snapshot. New detections do not replace these details automatically. All times: Asia/Manila (PHT, UTC+08:00).</p><button disabled={dirty} title={dirty ? "Save your changes before reloading the full report" : undefined} className="inline-flex items-center gap-2 text-sm font-semibold underline disabled:opacity-40" onClick={() => setRevision((value) => value + 1)}><RefreshCw className="size-3.5" /> Reload report</button></div>
          <section className="rounded-2xl border border-border bg-card p-4"><h2 className="mb-3 text-sm font-semibold">Account-level priority · highest unresolved detection</h2><AccountPriority level={data.student.priority} />{data.student.priority && <p className="mt-3 text-sm leading-6 text-muted-foreground">{SUPPORT_PRIORITIES[data.student.priority].description}</p>}<p className="mt-3 text-sm leading-6">{data.student.priority_since ? <>Waiting <WaitingSince value={data.student.priority_since} now={now} /> at this priority since {reportDate(data.student.priority_since)}.</> : "All saved detections for this account are closed."}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">A lower-priority message does not clear an unresolved higher-priority detection. Resolve each detection explicitly when staff follow-up is complete.</p></section>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">{[["Unresolved detections", data.student.unresolved_detections], ["Total detections", data.student.total_detections], ["Conversations", data.student.conversation_count]].map(([label, value]) => <div key={label} className="rounded-xl border border-border p-3"><dt className="text-xs leading-5 text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Account details</summary><dl className="mt-3 space-y-2"><div><dt className="text-muted-foreground">Account ID</dt><dd className="break-all font-mono text-xs">{studentId}</dd></div><div><dt className="text-muted-foreground">First detected</dt><dd>{reportDate(data.student.first_detection_at)}</dd></div><div><dt className="text-muted-foreground">Latest detection</dt><dd>{reportDate(data.student.latest_detection_at)}</dd></div></dl></details>
          <section><h2 className="text-lg font-semibold">Individual detections</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Unresolved detections appear first, ordered by priority and waiting time. Showing {data.events.length} of {data.total_events}.{data.total_events > data.events.length && " The 100 highest-priority entries are shown; account totals include all detections."}</p>
            <nav aria-label="Detection navigation" className="sticky top-0 z-10 mt-4 flex items-center justify-between gap-2 rounded-xl border border-border bg-background p-3"><button disabled={index === 0} onClick={() => choose(data.events[index - 1].id)} aria-label="Previous detection" className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-2 text-sm disabled:opacity-40"><ChevronLeft className="size-4" /> Previous</button><span className="text-sm tabular-nums">{index + 1} / {data.events.length}</span><button disabled={index >= data.events.length - 1} onClick={() => choose(data.events[index + 1].id)} aria-label="Next detection" className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-2 text-sm disabled:opacity-40">Next <ChevronRight className="size-4" /></button></nav>
            <ol className="mt-4 space-y-5">{data.events.map((event, position) => <li key={event.id} id={`detection-${event.id}`} tabIndex={-1} className={`scroll-mt-20 rounded-2xl border p-4 focus:outline-none ${active === event.id ? "border-foreground" : "border-border"}`} data-testid="detection-report-entry" data-level={event.level}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Detection {position + 1} · individual priority</p><div className="flex flex-wrap items-center justify-between gap-3"><AccountPriority level={event.level} /><WorkflowBadge status={event.workflow_status} /></div>
              <p className="mt-3 text-sm text-muted-foreground">Time since detection: <WaitingSince value={event.created_at} now={now} /> · <time dateTime={event.created_at}>{reportDate(event.created_at)}</time></p>
              <p className="mt-2 break-all text-sm text-muted-foreground">Assignee: {data.staff_members.find((member) => member.id === event.assignee_id)?.email ?? (event.assignee_id ? "Former staff member" : "Unassigned")}</p>
              {event.message !== null ? <blockquote className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-card p-4 text-sm leading-6">{event.message}</blockquote> : <p className="mt-3 text-sm text-muted-foreground">The original message is unavailable.</p>}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground"><span>{event.subject === "other" ? "Concern about another person" : event.subject === "student" ? "Student concern" : "Subject not recorded"}</span><span>{event.model_mode === "prototype" ? "Prototype model contributed" : event.model_mode === "reviewed" ? "Reviewed model contributed" : "Rules or conversation context"}</span>{event.source && <span>{event.source.replaceAll("_", " ")}</span>}</div>
              {active !== event.id && <button onClick={() => choose(event.id)} className="mt-4 min-h-10 rounded-lg border border-border px-3 py-2 text-sm font-semibold">Review this detection</button>}
              <ReviewEditor event={event} members={data.staff_members} token={token} open={active === event.id} onSaved={() => { setSelected(event.id); setRevision((value) => value + 1); onUpdated(); }} onDirty={markDirty} onDenied={onDenied} />
              <details className="mt-4 text-xs text-muted-foreground"><summary className="cursor-pointer">Record references</summary><p className="mt-2 break-all font-mono leading-6">Detection: {event.id}<br />Conversation: {event.conversation_id}<br />Message: {event.message_id}</p></details>
            </li>)}</ol>
          </section>
        </>}
      </div>
      {data && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card p-4"><p className="text-xs text-muted-foreground">Snapshot: {reportDate(data.generated_at)}{dirty && " · Unsaved review changes"}</p><button onClick={() => downloadCsv(studentReportCsv(data), `mindmate-student-report-${data.student.student_id}.csv`)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-foreground px-3 py-2 text-sm font-semibold text-primary-foreground"><Download className="size-4" /> Download account CSV</button></div>}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
