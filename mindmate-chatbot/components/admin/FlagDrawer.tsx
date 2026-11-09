"use client";

import { useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { STATUS_HELP, STATUS_LABEL, timeAgo, type Flag, type Status } from "./data";
import { CategoryTag, ConfidenceMeter, STATUS_ICON, STATUS_STYLE, StatusPill, StudentAvatar } from "./ui";

interface Props {
  flag: Flag | null;
  history: Flag[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Pick<Flag, "status" | "notes">>) => void;
}

function highlight(text: string, matched?: string) {
  if (!matched) return text;
  const i = text.toLowerCase().indexOf(matched.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-accent px-0.5 text-foreground underline decoration-foreground decoration-2 underline-offset-2">
        {text.slice(i, i + matched.length)}
      </mark>
      {text.slice(i + matched.length)}
    </>
  );
}

export default function FlagDrawer({ flag, history, onClose, onUpdate }: Props) {
  return (
    <Sheet open={!!flag} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
        {flag && <DrawerBody key={flag.id} flag={flag} history={history} onUpdate={onUpdate} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ flag, history, onUpdate }: Omit<Props, "onClose"> & { flag: Flag }) {
  const [notes, setNotes] = useState(flag.notes ?? "");

  const [pending, setPending] = useState<Status | null>(null);

  const confirm = () => {
    if (!pending) return;
    onUpdate(flag.id, { status: pending, notes });
    setPending(null);
  };

  const actions: { label: string; status: Status }[] = [
    { label: "Mark as reviewed", status: "reviewed" },
    { label: "Resolved", status: "resolved" },
    { label: "False positive", status: "false-positive" },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <SheetHeader className="border-b border-border p-5 text-left">
        <StatusPill status={flag.status} size="md" />
        <div className="flex items-center gap-3">
          <StudentAvatar id={flag.studentId} name={flag.studentName} size={48} />
          <SheetTitle className="font-serif text-2xl">
            {flag.studentName} <span className="font-mono text-sm text-muted-foreground">{flag.studentId}</span>
          </SheetTitle>
        </div>
        <div className="pt-1">
          <CategoryTag category={flag.category} />
        </div>
        <SheetDescription>
          {timeAgo(flag.createdAt)} · {flag.id}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 p-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversation</h3>
          <div className="space-y-2">
            {flag.context.map((m, i) => {
              const isStudent = m.from === "student";
              const isFlagged = m.text === flag.message;
              return (
                <div key={i} className={`flex ${isStudent ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] px-4 py-2.5 text-sm ${
                      isStudent ? "bg-foreground text-primary-foreground" : "bg-secondary text-foreground"
                    } ${isStudent ? "rounded-[18px_18px_4px_18px]" : "rounded-[18px_18px_18px_4px]"} ${
                      isFlagged ? "ring-2 ring-foreground/30 ring-offset-2" : ""
                    }`}
                  >
                    {isFlagged ? (
                      <span className="[&_mark]:text-foreground [&_mark]:bg-background">{highlight(m.text, flag.matched)}</span>
                    ) : (
                      m.text
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {(flag.confidence !== undefined || flag.signals?.length) && (
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Why it was flagged</h3>
              {flag.confidence !== undefined && <ConfidenceMeter value={flag.confidence} />}
            </div>
            {flag.signals && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {flag.signals.map((s) => (
                  <li key={s} className="rounded-full border border-border bg-background px-2.5 py-1 text-xs">
                    {s}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Automated screening to support early identification. Professional judgment decides next steps.
            </p>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Student flag history ({history.length})
          </h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <CategoryTag category={h.category} />
                <span className="text-xs text-muted-foreground">{timeAgo(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <label htmlFor="notes" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Internal notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Add context for the next reviewer"
            className="w-full resize-none rounded-xl border-[1.5px] border-border bg-secondary px-3 py-2.5 text-sm outline-none transition-colors focus:border-foreground focus:bg-background"
          />
        </section>
      </div>

      <div className="sticky bottom-0 space-y-3 border-t border-border bg-background p-5">
        <div className="grid grid-cols-2 gap-2">
          {actions.map(({ label, status }) => {
            const Icon = STATUS_ICON[status];
            const current = flag.status === status;
            return (
              <button
                key={status}
                onClick={() => setPending(status)}
                disabled={current}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all hover:opacity-85 active:scale-[0.97] disabled:cursor-default disabled:opacity-100 ${
                  status === "reviewed" ? "col-span-2" : ""
                } ${STATUS_STYLE[status]} ${current ? "ring-2 ring-foreground/20 ring-offset-2" : ""}`}
              >
                <Icon className="size-4" aria-hidden />
                {current ? `${STATUS_LABEL[status]} (current)` : label}
              </button>
            );
          })}
        </div>
      </div>

      <AlertDialog.Root open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <AlertDialog.Content className="admin-design fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-xl outline-none">
            {pending && (
              <>
                <div className={`mx-auto flex size-11 items-center justify-center rounded-full border ${STATUS_STYLE[pending]}`}>
                  {(() => {
                    const Icon = STATUS_ICON[pending];
                    return <Icon className="size-5" aria-hidden />;
                  })()}
                </div>
                <AlertDialog.Title className="mt-4 text-center font-serif text-xl">
                  Change status to {STATUS_LABEL[pending]}?
                </AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-center text-sm text-muted-foreground">
                  {STATUS_HELP[pending]} This will be saved with your notes for {flag.studentName} ({flag.id}).
                </AlertDialog.Description>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  <AlertDialog.Cancel className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-accent">
                    Cancel
                  </AlertDialog.Cancel>
                  <button
                    onClick={confirm}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all hover:opacity-85 active:scale-[0.97] ${STATUS_STYLE[pending]}`}
                  >
                    Yes, confirm
                  </button>
                </div>
              </>
            )}
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
