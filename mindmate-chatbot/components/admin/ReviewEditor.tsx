"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { WORKFLOW_LABELS, type DetectionReportEntry, type ReviewHistory, type StaffMember, type WorkflowStatus } from "@/lib/admin/detection-types";
import { reportDate, ReportRequestError } from "./detection-ui";
import { useStaffSession } from "./StaffSession";

type Snapshot = { history: ReviewHistory[]; review: { workflow_status: WorkflowStatus; workflow_version: number; assignee_id: string | null } };
export default function ReviewEditor({ event, members, token, open, onSaved, onDirty, onDenied }: {
  event: DetectionReportEntry; members: StaffMember[]; token: string; open: boolean;
  onSaved: () => void; onDirty: (id: string, dirty: boolean) => void; onDenied: (message: string) => void;
}) {
  const { session } = useStaffSession();
  const [status, setStatus] = useState(event.workflow_status);
  const [assignee, setAssignee] = useState(event.assignee_id ?? "");
  const [version, setVersion] = useState(event.workflow_version);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<ReviewHistory[] | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const write = useRef<AbortController | null>(null);
  const requestToken = useRef(token);
  useEffect(() => { requestToken.current = token; }, [token]);
  const editing = useRef(false);
  const dirty = !!note.trim() || status !== event.workflow_status || assignee !== (event.assignee_id ?? "");
  // Explicit report reloads update untouched forms. An existing draft retains its
  // original version so a concurrent change cannot silently overwrite it.
  useEffect(() => {
    let cancelled = false;
    if (!editing.current) void Promise.resolve().then(() => {
      if (!cancelled) { setStatus(event.workflow_status); setAssignee(event.assignee_id ?? ""); setVersion(event.workflow_version); }
    });
    return () => { cancelled = true; };
  }, [event.workflow_status, event.assignee_id, event.workflow_version]);
  useEffect(() => { editing.current = dirty; }, [dirty]);
  useEffect(() => { onDirty(event.id, dirty); }, [dirty, event.id, onDirty]);
  useEffect(() => () => onDirty(event.id, false), [event.id, onDirty]);
  useEffect(() => () => write.current?.abort(), []);
  const read = async (signal: AbortSignal): Promise<Snapshot> => {
    const response = await fetch(`/api/admin/reviews?event_id=${event.id}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
    const body = await response.json();
    if (!response.ok) throw new ReportRequestError(body.error ?? "Review history could not be loaded.", response.status);
    return body;
  };
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/admin/reviews?event_id=${event.id}`, { headers: { Authorization: `Bearer ${requestToken.current}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
        const body = await response.json();
        if (!response.ok) throw new ReportRequestError(body.error ?? "Review history could not be loaded.", response.status);
        if (!controller.signal.aborted) setHistory(body.history);
      } catch (failure) {
        if (!controller.signal.aborted) {
          if (failure instanceof ReportRequestError && [401, 403].includes(failure.status)) { onDenied(failure.message); return; }
          setError(failure instanceof Error ? failure.message : "Review history could not be loaded.");
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [event.id, open, revision, onDenied]);
  const reload = async () => {
    if (busy) return;
    const controller = new AbortController(); write.current = controller;
    setBusy(true);
    try {
      const snapshot = await read(controller.signal);
      setHistory(snapshot.history); setStatus(snapshot.review.workflow_status); setAssignee(snapshot.review.assignee_id ?? ""); setVersion(snapshot.review.workflow_version); setError(""); setSaved(false); onSaved();
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Reload failed."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const save = async (submit: React.FormEvent) => {
    submit.preventDefault();
    if (busy) return;
    const controller = new AbortController(); write.current = controller;
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/admin/reviews", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]), body: JSON.stringify({ event_id: event.id, expected_version: version, status, assignee_id: assignee || null, note }) });
      const body = await response.json();
      if (!response.ok) throw new ReportRequestError(body.error ?? "The review could not be saved.", response.status);
      if (!controller.signal.aborted) { setVersion(body.version); setNote(""); setSaved(true); setRevision((value) => value + 1); onSaved(); }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ReportRequestError && [401, 403].includes(failure.status)) { onDenied(failure.message); return; }
      setError(failure instanceof Error ? failure.message : "The review could not be saved. Your draft is still here.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const control = "mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm";
  return <div hidden={!open} className="mt-5 space-y-5 border-t border-border pt-5">
    <form onSubmit={save} className="space-y-4" aria-label="Update detection review">
      <h3 className="text-base font-semibold">Review this detection</h3>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Review status<select aria-label="Review status" value={status} onChange={(change) => { setStatus(change.target.value as WorkflowStatus); setSaved(false); }} disabled={busy} className={control}>{Object.entries(WORKFLOW_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-sm font-medium">Assignee<select aria-label="Review assignee" value={assignee} onChange={(change) => { setAssignee(change.target.value); setSaved(false); }} disabled={busy} className={control}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.email}</option>)}</select></label></div>
      {session && members.some((member) => member.id === session.user.id) && <button type="button" disabled={busy} className="text-sm font-semibold underline" onClick={() => { setAssignee(session.user.id); if (status === "needs_review") setStatus("assigned"); setSaved(false); }}>Assign to me</button>}
      <label className="block text-sm font-medium">Add a staff note<textarea aria-label="Staff note" value={note} onChange={(change) => { setNote(change.target.value); setSaved(false); }} maxLength={4000} rows={3} disabled={busy} placeholder="Record a review, contact attempt or next step. Notes are appended to the audit history." className={`${control} resize-y`} /><span className="mt-1 block text-xs font-normal text-muted-foreground">Staff only · {note.length}/4,000 characters · Saved notes cannot be edited.</span></label>
      {error && <div role="alert" className="rounded-lg border border-warning-border bg-warning-surface p-3 text-sm leading-6 text-warning"><p>{error}</p><button type="button" disabled={busy} onClick={() => void reload()} className="mt-2 font-semibold underline">Reload review (keeps your note)</button></div>}
      <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={busy || !dirty} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />} {busy ? "Saving…" : "Save review"}</button>{saved && <p role="status" className="inline-flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> Review saved</p>}{dirty && !busy && <span className="text-xs text-muted-foreground">Unsaved changes</span>}</div>
    </form>
    <section aria-label="Review audit history"><h3 className="text-sm font-semibold">Staff notes and audit history</h3>{history === null ? <p className="mt-2 text-sm text-muted-foreground">{error ? "History unavailable. Reload the review to retry." : "Loading history…"}</p> : !history.length ? <p className="mt-2 text-sm text-muted-foreground">No staff actions have been recorded yet.</p> : <ol className="mt-3 space-y-4">{[...history].reverse().map((entry) => <li key={entry.id} className="rounded-lg border border-border bg-card p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className="break-all">{entry.actor_email}</strong><time className="text-xs text-muted-foreground" dateTime={entry.created_at}>{reportDate(entry.created_at)}</time></div><p className="mt-2">{WORKFLOW_LABELS[entry.from_status]} → {WORKFLOW_LABELS[entry.to_status]}</p>{entry.from_assignee_email !== entry.to_assignee_email && <p className="mt-1 break-all text-xs text-muted-foreground">Assignee: {entry.from_assignee_email ?? "Unassigned"} → {entry.to_assignee_email ?? "Unassigned"}</p>}{entry.note && <p className="mt-3 whitespace-pre-wrap break-words leading-6">{entry.note}</p>}<p className="mt-2 text-xs text-muted-foreground">Audit entry {entry.version}</p></li>)}</ol>}</section>
  </div>;
}
