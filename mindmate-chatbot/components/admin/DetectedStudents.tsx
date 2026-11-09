"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Download, FileText, LoaderCircle, RefreshCw, Search, ShieldAlert, Users, X } from "lucide-react";
import { PRIORITY_ORDER, type DetectionDashboard } from "@/lib/admin/detection-types";
import type { SupportLevel } from "@/lib/support/types";
import { accountSummaryCsv } from "@/lib/admin/report-export";
import { PRIORITIES } from "./algorithm-ui";
import { AccountPriority, downloadCsv, fetchReport, reportDate, ReportRequestError } from "./detection-ui";
import { useStaffSession } from "./StaffSession";
import StudentDetectionReport from "./StudentDetectionReport";

type Resource = { owner: string; data: DetectionDashboard | null; error: string | null; denied: boolean; busy: boolean };

export default function DetectedStudents() {
  const router = useRouter();
  const { session, loading, error: sessionError } = useStaffSession();
  const owner = session?.user.id ?? "";
  const token = session?.access_token ?? "";
  const [resource, setResource] = useState<Resource>({ owner: "", data: null, error: null, denied: false, busy: false });
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<SupportLevel | "all">("all");
  const [view, setView] = useState<"unresolved" | "all" | "closed">("unresolved");
  const [selected, setSelected] = useState<{ owner: string; id: string } | null>(null);

  useEffect(() => { if (!loading && !session && !sessionError) router.replace("/admin/login"); }, [loading, session, sessionError, router]);
  useEffect(() => {
    if (!owner || !token) return;
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setResource((previous) => ({ owner, data: previous.owner === owner ? previous.data : null, error: null, denied: false, busy: true }));
      try {
        const data = await fetchReport<DetectionDashboard>(token, controller.signal);
        if (!controller.signal.aborted) setResource({ owner, data, error: null, denied: false, busy: false });
      } catch (error) {
        if (!controller.signal.aborted) {
          const denied = error instanceof ReportRequestError && [401, 403].includes(error.status);
          setResource((previous) => ({ owner, data: !denied && previous.owner === owner ? previous.data : null, error: error instanceof Error ? error.message : "The student report could not be loaded.", denied, busy: false }));
        }
      } finally { pending = false; }
    }
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [owner, token, revision]);

  const deny = useCallback((message: string) => { setResource({ owner, data: null, error: message, denied: true, busy: false }); }, [owner]);
  // Report state is scoped to the current account even before effect cleanup runs.
  const current = resource.owner === owner && owner ? resource : null;
  const data = current?.data ?? null;
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.students ?? []).filter((student) => (view === "all" || (view === "unresolved" ? student.priority !== null : student.priority === null))
      && (priority === "all" || student.priority === priority)
      && (!needle || `${student.name} ${student.email ?? ""} ${student.student_id}`.toLowerCase().includes(needle)));
  }, [data, search, priority, view]);

  if (loading || (!session && !sessionError)) return <div role="status" className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Checking administrator session…</div>;
  if (sessionError || current?.denied) return <div className="mx-auto max-w-2xl px-5 py-14"><ShieldAlert className="mb-5 size-9 text-muted-foreground" /><h1 className="font-serif text-3xl">Administrator access required</h1><p role="alert" className="mt-3 text-sm leading-6 text-muted-foreground">{sessionError || current?.error}</p><Link href="/admin/login" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-primary-foreground">Sign in as administrator <ArrowRight className="size-4" /></Link></div>;

  const totalActive = data?.students.filter((student) => student.priority !== null).length ?? 0;
  return <div className="mx-auto max-w-7xl space-y-6 px-4 py-7 md:px-8 md:py-9" data-testid="detection-dashboard">
    <header className="flex flex-wrap items-start justify-between gap-5"><div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"><span className={`size-1.5 rounded-full ${data && !current?.error ? "bg-success" : "bg-gray-400"}`} /> Saved student detections</div><h1 className="font-serif text-3xl">Student support dashboard</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">See which student accounts need attention first. Each account keeps its highest unresolved priority across all conversations.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setRevision((value) => value + 1)} disabled={current?.busy} aria-label="Refresh student detections" className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-semibold hover:bg-card disabled:opacity-50"><RefreshCw className={`size-3.5 ${current?.busy ? "animate-spin" : ""}`} /> Refresh</button><button onClick={() => { if (data) downloadCsv(accountSummaryCsv(shown, data.generated_at), `mindmate-detected-accounts-${new Date(data.generated_at).toISOString().slice(0, 10)}.csv`); }} disabled={!data || !shown.length} className="inline-flex items-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-85 disabled:opacity-40"><Download className="size-3.5" /> Export report</button></div></header>

    {current?.error && <div role="alert" className="rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-xs leading-5 text-warning">{current.error}{data && ` Showing the previous snapshot from ${reportDate(data.generated_at)}.`}<button onClick={() => setRevision((value) => value + 1)} className="ml-2 font-semibold underline">Retry</button></div>}
    {!data && !current?.error && <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading private detection records…</p>}
    {data && <>
      <section aria-label="Student accounts by priority" className="grid grid-cols-2 gap-3 xl:grid-cols-4">{PRIORITY_ORDER.map((level, index) => {
        const style = PRIORITIES[level];
        return <button key={level} onClick={() => { setPriority((current) => current === level ? "all" : level); setView("unresolved"); }} aria-pressed={priority === level} className={`rounded-2xl border p-4 text-left transition-shadow hover:shadow-sm sm:p-5 ${priority === level ? "border-foreground ring-1 ring-foreground" : "border-border"}`} data-testid={`priority-count-${level}`}>
          <div className="flex items-center justify-between gap-1"><span className="size-2 rounded-full" style={{ background: style.color }} /><span className="text-[10px] text-muted-foreground">Priority {index + 1}</span></div><p className="mt-4 text-3xl font-semibold tabular-nums">{data.accounts_by_priority[level]}</p><p className="mt-1 text-xs font-semibold" style={{ color: style.color }}>{style.label}</p><p className="mt-1 text-[10px] text-muted-foreground">{data.accounts_by_priority[level] === 1 ? "student account" : "student accounts"}</p>
        </button>;
      })}</section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-xs"><p className="flex flex-wrap items-center gap-x-5 gap-y-2"><span className="inline-flex items-center gap-1.5"><Users className="size-3.5" /> <strong>{totalActive}</strong> accounts with unresolved detections</span><span><strong>{data.unresolved_detections}</strong> unresolved detections</span></p><p className="text-[10px] text-muted-foreground">Updated {reportDate(data.generated_at)} · Refreshes every 30 seconds</p></div>
      {!data.review_queue_enabled && <p className="rounded-xl border border-border px-4 py-3 text-xs leading-5 text-muted-foreground">Review requests are disabled. Saved detections are visible here, but viewing a report does not contact a student or counselor.</p>}
      {data.identity_unavailable > 0 && <p role="status" className="text-xs text-warning">Account details could not be loaded for {data.identity_unavailable} {data.identity_unavailable === 1 ? "account" : "accounts"}. Their detections and account IDs are still included.</p>}

      <section className="overflow-hidden rounded-2xl border border-border">
        <div className="space-y-4 border-b border-border p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Detected student accounts</h2><p className="mt-1 text-[11px] text-muted-foreground">Priority first, then oldest unresolved detection within each group.</p></div><select aria-label="Detection status" value={view} onChange={(event) => { setView(event.target.value as typeof view); setPriority("all"); }} className="rounded-lg border border-border bg-background px-3 py-2 text-xs"><option value="unresolved">Unresolved accounts</option><option value="all">All detected accounts</option><option value="closed">Closed accounts</option></select></div>
          <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-0 flex-1 basis-60"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search detected accounts" placeholder="Search name, email, or account ID" className="h-10 w-full rounded-xl border border-border bg-card pl-10 pr-9 text-xs outline-none focus:ring-2 focus:ring-ring" />{search && <button onClick={() => setSearch("")} aria-label="Clear account search" className="absolute inset-y-0 right-1 px-2 text-muted-foreground"><X className="size-3.5" /></button>}</div>{priority !== "all" && <button onClick={() => setPriority("all")} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-2 text-[11px] font-semibold">{PRIORITIES[priority].label}<X className="size-3" /><span className="sr-only">Clear priority filter</span></button>}<p aria-live="polite" className="text-[11px] text-muted-foreground">{shown.length} of {data.students.length} accounts</p></div>
        </div>

        {shown.length === 0 ? <div className="px-5 py-14 text-center"><CheckCircle2 className="mx-auto mb-3 size-8 text-muted-foreground" /><h3 className="text-sm font-semibold">{data.students.length ? "No accounts match these filters" : "No saved detections yet"}</h3><p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">{data.students.length ? "Try another name, clear the priority filter, or select all detected accounts." : "Accounts appear after a signed-in student sends a message and its detection is saved. Prototype tester messages do not create student records."}</p></div> : <>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th scope="col" className="px-5 py-3 font-medium">Student account</th><th scope="col" className="px-4 py-3 font-medium">Priority</th><th scope="col" className="px-4 py-3 font-medium">Unresolved</th><th scope="col" className="px-4 py-3 font-medium">Priority since</th><th scope="col" className="px-5 py-3 font-medium"><span className="sr-only">Report</span></th></tr></thead><tbody className="divide-y divide-border">{shown.map((student) => <tr key={student.student_id} className="hover:bg-card/60" data-testid="detected-account-row" data-priority={student.priority ?? "CLOSED"} data-student-id={student.student_id}><td className="max-w-72 px-5 py-4"><p className="truncate text-sm font-semibold">{student.name}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{student.email ?? student.student_id}</p><p className="mt-1 text-[10px] text-muted-foreground">{student.conversation_count} {student.conversation_count === 1 ? "conversation" : "conversations"} · {student.total_detections} {student.total_detections === 1 ? "detection" : "detections"}</p></td><td className="px-4 py-4"><AccountPriority level={student.priority} /></td><td className="px-4 py-4 font-semibold tabular-nums">{student.unresolved_detections}</td><td className="px-4 py-4 text-[11px] text-muted-foreground">{reportDate(student.priority_since)}</td><td className="px-5 py-4"><button onClick={() => setSelected({ owner, id: student.student_id })} aria-label={`View report for ${student.name}`} className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-semibold hover:bg-accent"><FileText className="size-3.5" /> View report</button></td></tr>)}</tbody></table></div>
          <ul className="divide-y divide-border md:hidden">{shown.map((student) => <li key={student.student_id} className="space-y-3 p-4" data-testid="detected-account-card" data-priority={student.priority ?? "CLOSED"}><div className="flex flex-wrap items-center justify-between gap-2"><AccountPriority level={student.priority} /><span className="text-[10px] text-muted-foreground">{student.unresolved_detections} unresolved</span></div><div><p className="break-words text-sm font-semibold">{student.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{student.email ?? student.student_id}</p></div><div className="flex items-center justify-between gap-2"><p className="text-[10px] text-muted-foreground">Since {reportDate(student.priority_since)}</p><button onClick={() => setSelected({ owner, id: student.student_id })} aria-label={`View report for ${student.name}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold"><FileText className="size-3.5" /> View report</button></div></li>)}</ul>
        </>}
      </section>
      <p className="text-[11px] leading-6 text-muted-foreground">Unresolved means the detection has not been marked resolved or false positive. An account is counted once under its highest unresolved priority. Automated priorities support staff review and are not a diagnosis.</p>
      {selected?.owner === owner && <StudentDetectionReport key={`${owner}:${selected.id}`} studentId={selected.id} token={token} onClose={() => setSelected(null)} onDenied={deny} />}
    </>}
  </div>;
}
