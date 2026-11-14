"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, FileText, LoaderCircle, X } from "lucide-react";
import type { StudentDetectionReport as Report } from "@/lib/admin/detection-types";
import { SUPPORT_PRIORITIES } from "@/lib/support/types";
import { studentReportCsv } from "@/lib/admin/report-export";
import { AccountPriority, downloadCsv, fetchReport, reportDate, ReportRequestError, REVIEW_LABEL } from "./detection-ui";

export default function StudentDetectionReport({ studentId, token, onClose, onDenied }: {
  studentId: string; token: string; onClose: () => void; onDenied: (message: string) => void;
}) {
  const [state, setState] = useState<{ data: Report | null; error: string | null }>({ data: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetchReport<Report>(token, controller.signal, studentId).then((data) => {
      if (!controller.signal.aborted) setState({ data, error: null });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      if (error instanceof ReportRequestError && [401, 403].includes(error.status)) { onDenied(error.message); return; }
      setState({ data: null, error: error instanceof Error ? error.message : "The account report could not be loaded." });
    });
    return () => controller.abort();
  }, [studentId, token, revision, onDenied]);
  const { data, error } = state;

  return <Dialog.Root open onOpenChange={(value) => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
    <Dialog.Content aria-describedby="student-report-description" className="admin-design fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-background shadow-2xl focus:outline-none" data-testid="student-detection-report">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5 sm:p-7"><div><p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><FileText className="size-4" /> Student detection report</p><Dialog.Title className="font-serif text-2xl">{data?.student.name ?? "Account report"}</Dialog.Title><Dialog.Description id="student-report-description" className="mt-1 break-all text-xs text-muted-foreground">{data?.student.email ?? studentId}</Dialog.Description></div><Dialog.Close aria-label="Close student report" className="rounded-full border border-border p-2 hover:bg-card"><X className="size-4" /></Dialog.Close></div>
      <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-7">
        {!data && !error && <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading saved detections…</p>}
        {error && <div role="alert" className="rounded-xl border border-warning-border bg-warning-surface p-4 text-sm text-warning"><p>{error}</p><button className="mt-3 font-semibold underline" onClick={() => setRevision((value) => value + 1)}>Retry report</button></div>}
        {data && <>
          <section className="rounded-2xl border border-border bg-card p-4"><p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Highest unresolved priority</p><AccountPriority level={data.student.priority} />{data.student.priority && <p className="mt-3 text-xs leading-5 text-muted-foreground">{SUPPORT_PRIORITIES[data.student.priority].description}</p>}<p className="mt-3 text-xs leading-5 text-muted-foreground">{data.student.priority_since ? `Waiting since ${reportDate(data.student.priority_since)}. A newer lower-priority message does not clear this detection.` : "Every saved detection for this account has been resolved or marked as a false positive."}</p></section>
          <dl className="grid grid-cols-3 gap-3">{[["Unresolved", data.student.unresolved_detections], ["All detections", data.student.total_detections], ["Conversations", data.student.conversation_count]].map(([label, value]) => <div key={label} className="rounded-xl border border-border p-3"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
          <section><h2 className="text-sm font-semibold">Account details</h2><dl className="mt-3 space-y-2 text-xs"><div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Account ID</dt><dd className="break-all font-mono">{data.student.student_id}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">First detected</dt><dd>{reportDate(data.student.first_detection_at)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Latest detection</dt><dd>{reportDate(data.student.latest_detection_at)}</dd></div></dl></section>
          <section><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Detected messages</h2><span className="text-[11px] text-muted-foreground">{data.events.length} of {data.total_events}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">Unresolved detections appear first, ordered by priority and waiting time.{data.total_events > data.events.length ? " This report shows the 100 highest-priority entries; account totals include all saved detections." : ""}</p>
            <ol className="mt-4 space-y-4">{data.events.map((event) => <li key={event.id} className="rounded-2xl border border-border p-4" data-testid="detection-report-entry" data-level={event.level}>
              <div className="flex flex-wrap items-center justify-between gap-2"><AccountPriority level={event.level} /><time className="text-[11px] text-muted-foreground" dateTime={event.created_at}>{reportDate(event.created_at)}</time></div>
              <p className="mt-2 text-[11px] font-medium text-muted-foreground">{REVIEW_LABEL[event.review_status]}</p>
              {event.message !== null ? <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-card p-3 text-sm leading-6">{event.message}</blockquote> : <p className="mt-3 text-xs text-muted-foreground">The original message is unavailable.</p>}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span>{event.subject === "other" ? "Concern about another person" : event.subject === "student" ? "Student concern" : "Subject not recorded"}</span><span>{event.model_mode === "prototype" ? "Prototype model contributed" : event.model_mode === "reviewed" ? "Reviewed model contributed" : "Rules or conversation context"}</span>{event.source && <span>{event.source.replaceAll("_", " ")}</span>}</div>
              <details className="mt-3 text-[10px] text-muted-foreground"><summary className="cursor-pointer">Record references</summary><p className="mt-2 break-all font-mono">Detection: {event.id}<br />Conversation: {event.conversation_id}<br />Message: {event.message_id}</p></details>
            </li>)}</ol>
          </section>
        </>}
      </div>
      {data && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card p-5"><p className="text-[10px] text-muted-foreground">Report generated {reportDate(data.generated_at)}</p><button onClick={() => downloadCsv(studentReportCsv(data), `mindmate-student-report-${data.student.student_id}.csv`)} className="inline-flex items-center gap-2 rounded-xl bg-foreground px-3 py-2 text-xs font-semibold text-primary-foreground"><Download className="size-3.5" /> Download account CSV</button></div>}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
