"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, LoaderCircle, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { PRIORITY_ORDER, type DetectionDashboard } from "@/lib/admin/detection-types";
import type { SupportLevel } from "@/lib/support/types";
import { SUPPORT_PRIORITIES } from "@/lib/support/types";
import { accountSummaryCsv } from "@/lib/admin/report-export";
import { PRIORITIES } from "./algorithm-ui";
import { downloadCsv, fetchReport, reportDate, ReportRequestError } from "./detection-ui";
import { useStaffSession } from "./StaffSession";
import StudentDetectionReport from "./StudentDetectionReport";
import DetectionQueue from "./DetectionQueue";
import AlgorithmStatus from "./AlgorithmStatus";

type Resource = { owner: string; data: DetectionDashboard | null; error: string | null; denied: boolean; busy: boolean };
export default function DetectedStudents() {
  const router = useRouter();
  const { session, loading, error: sessionError } = useStaffSession();
  const owner = session?.user.id ?? "";
  const token = session?.access_token ?? "";
  const [resource, setResource] = useState<Resource>({ owner: "", data: null, error: null, denied: false, busy: false });
  const [revision, setRevision] = useState(0);
  const [priority, setPriority] = useState<SupportLevel | "all">("all");
  const [selected, setSelected] = useState<{ owner: string; id: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const paused = useRef(false);
  const reportTrigger = useRef<HTMLButtonElement | null>(null);
  const dashboardRoot = useRef<HTMLDivElement>(null);
  const reportOpen = selected?.owner === owner;
  useEffect(() => { paused.current = reportOpen; }, [reportOpen]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
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
        if (!controller.signal.aborted) { setResource({ owner, data, error: null, denied: false, busy: false }); setNow(Date.now()); }
      } catch (error) {
        if (!controller.signal.aborted) {
          const denied = error instanceof ReportRequestError && [401, 403].includes(error.status);
          setResource((previous) => ({ owner, data: !denied && previous.owner === owner ? previous.data : null, error: error instanceof Error ? error.message : "The student report could not be loaded.", denied, busy: false }));
        }
      } finally { pending = false; }
    }
    void load();
    const refresh = () => { if (!document.hidden && !paused.current) void load(); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [owner, token, revision]);
  const deny = useCallback((message: string) => { setResource({ owner, data: null, error: message, denied: true, busy: false }); }, [owner]);
  const current = resource.owner === owner && owner ? resource : null;
  const data = current?.data ?? null;
  if (loading || (!session && !sessionError)) return <div role="status" className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Checking administrator session…</div>;
  if (sessionError || current?.denied) return <div className="mx-auto max-w-2xl px-5 py-14"><ShieldAlert className="mb-5 size-9" /><h1 className="font-serif text-3xl">Administrator access required</h1><p role="alert" className="mt-3 text-sm">{sessionError || current?.error}</p><Link href="/admin/login" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-primary-foreground">Sign in as administrator <ArrowRight className="size-4" /></Link></div>;
  const stale = data && now - Date.parse(data.generated_at) > 90000;
  return <div ref={dashboardRoot} className="mx-auto w-full max-w-[1800px] space-y-6 px-4 py-7 md:px-7 xl:px-10" data-testid="detection-dashboard">
    <header className="flex flex-wrap items-start justify-between gap-5"><div><p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Staff review queue</p><h1 className="font-serif text-3xl">Student support dashboard</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">Review saved detections, assign follow-up and record staff actions. Each account retains its highest unresolved priority across all conversations.</p></div><button onClick={() => setRevision((value) => value + 1)} disabled={current?.busy} aria-label="Refresh student detections" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-card disabled:opacity-50"><RefreshCw className={`size-4 ${current?.busy ? "animate-spin" : ""}`} /> Refresh</button></header>
    <AlgorithmStatus variant="indicator" />
    {current?.error && <div role="alert" className="rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm leading-6 text-warning">{current.error}{data && ` Showing the previous snapshot from ${reportDate(data.generated_at)}.`}<button onClick={() => setRevision((value) => value + 1)} className="ml-2 font-semibold underline">Retry</button></div>}
    {!data && !current?.error && <p role="status" className="flex items-center gap-2 py-8 text-sm"><LoaderCircle className="size-4 animate-spin" /> Loading private detection records…</p>}
    {data && <>
      <section aria-label="Accounts with unresolved detections by priority" className="grid grid-cols-2 gap-3 xl:grid-cols-4">{PRIORITY_ORDER.map((level) => <button key={level} onClick={() => setPriority((value) => value === level ? "all" : level)} aria-pressed={priority === level} className={`rounded-2xl border p-4 text-left sm:p-5 ${priority === level ? "border-foreground ring-1 ring-foreground" : "border-border"}`} data-testid={`priority-count-${level}`}><CircleAlert className="size-5" style={{ color: PRIORITIES[level].color }} aria-hidden="true" /><p className="mt-3 text-3xl font-semibold tabular-nums">{data.accounts_by_priority[level]}</p><p className="mt-1 text-sm font-semibold" style={{ color: PRIORITIES[level].color }}>{PRIORITIES[level].label}</p><p className="mt-1 text-xs text-muted-foreground">accounts with unresolved detections</p><p className="mt-3 text-sm leading-6 text-muted-foreground">{SUPPORT_PRIORITIES[level].description}</p></button>)}</section>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-4 text-sm"><p className="flex flex-wrap gap-x-6 gap-y-2"><span className="inline-flex items-center gap-2"><Users className="size-4" /><strong>{data.students.filter((account) => account.priority).length}</strong> accounts with unresolved detections</span><span><strong>{data.unresolved_detections}</strong> unresolved detections</span></p><div className="space-y-1 text-xs text-muted-foreground" role="status" aria-live="polite"><p>{current?.busy ? "Refreshing… Previous snapshot remains visible." : stale ? "Snapshot is stale" : "Snapshot up to date"} · Updated {reportDate(data.generated_at)}</p><p>{reportOpen ? "Auto-refresh paused while reviewing. Report details stay fixed until you save or reload." : "Auto-refresh every 30 seconds while this tab is visible."} All times: Asia/Manila (PHT, UTC+08:00).</p></div></div>
      {data.identity_unavailable > 0 && <p role="status" className="text-sm text-warning">Account details are unavailable for {data.identity_unavailable} accounts. Their IDs and detections remain included.</p>}
      <DetectionQueue data={data} now={now} priority={priority} onPriority={setPriority} onSelect={(id, trigger) => { reportTrigger.current = trigger; setSelected({ owner, id }); }} onExport={(accounts) => downloadCsv(accountSummaryCsv(accounts, data.generated_at), `mindmate-detected-accounts-${data.generated_at.slice(0, 10)}.csv`)} />
      <p className="text-sm leading-6 text-muted-foreground">Only resolved and false-positive detections leave the unresolved count. Assigned, contacted and reviewed cases remain open until explicitly closed. A lower-priority message never clears a higher-priority unresolved detection. Automated priorities support staff review and are not a diagnosis.</p>
      {reportOpen && selected && <StudentDetectionReport key={`${owner}:${selected.id}`} studentId={selected.id} token={token} onClose={() => { setSelected(null); setRevision((value) => value + 1); }} onDenied={deny} onUpdated={() => setRevision((value) => value + 1)} onReturnFocus={() => { const target = reportTrigger.current?.isConnected ? reportTrigger.current : dashboardRoot.current?.querySelector<HTMLButtonElement>('[aria-label="Refresh student detections"]'); target?.focus(); }} />}
    </>}
  </div>;
}
