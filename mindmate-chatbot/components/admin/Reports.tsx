"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useAdmin } from "./AdminLayout";
import { CATEGORY_LABEL, CATEGORY_ORDER, STATUS_HELP, STATUS_LABEL, STATUS_ORDER, timeAgo, type Category, type Status } from "./data";
import FlagDrawer from "./FlagDrawer";
import { CATEGORY_COLOR, CategoryDot, ColorGuide, ConfidenceMeter, STATUS_ICON, StatusPill, CategoryTag, StudentAvatar } from "./ui";

export default function Reports() {
  const { flags, updateFlag } = useAdmin();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");

  const rawCategory = params.get("category");
  const category = (CATEGORY_ORDER as string[]).includes(rawCategory ?? "") ? (rawCategory as Category) : "all";
  const rawStatus = params.get("status");
  const status = (STATUS_ORDER as string[]).includes(rawStatus ?? "") ? (rawStatus as Status) : "all";
  const selected = flags.find((f) => f.id === params.get("open")) ?? null;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const rows = useMemo(
    () =>
      flags
        .filter((f) => category === "all" || f.category === category)
        .filter((f) => status === "all" || f.status === status)
        .filter((f) => !q || `${f.message} ${f.studentName} ${f.studentId}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [flags, q, category, status],
  );

  const tabs: { id: Category | "all"; label: string; count: number }[] = [
    { id: "all", label: "All", count: flags.length },
    ...CATEGORY_ORDER.map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: flags.filter((f) => f.category === c).length })),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <div>
        <h1 className="font-serif text-3xl">Flagged reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Messages the screening tool flagged for professional review. Most recent first.</p>
      </div>

      <ColorGuide />

      <div role="tablist" aria-label="Category" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {tabs.map((t) => {
          const active = category === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setParam("category", t.id === "all" ? null : t.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                active ? "border-foreground bg-foreground text-white" : "border-border hover:bg-accent"
              }`}
            >
              {t.id !== "all" && <CategoryDot category={t.id} />}
              {t.label}
              <span className={`font-mono text-xs ${active ? "text-white/70" : "text-muted-foreground"}`}>{t.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search messages or students"
            aria-label="Search"
            className="w-full rounded-xl border-[1.5px] border-border bg-secondary py-2 pl-9 pr-3 text-sm outline-none focus:border-foreground focus:bg-white"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Status</span>
        {(["all", ...STATUS_ORDER] as const).map((st) => {
          const active = status === st;
          const Icon = st === "all" ? null : STATUS_ICON[st];
          const count = st === "all" ? flags.length : flags.filter((f) => f.status === st).length;
          return (
            <button
              key={st}
              title={st === "all" ? "All statuses" : STATUS_HELP[st]}
              aria-pressed={active}
              onClick={() => setParam("status", st === "all" ? null : st)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                active ? "border-foreground bg-foreground text-white" : "border-border bg-white hover:bg-accent"
              }`}
            >
              {Icon && <Icon className="size-3.5" aria-hidden />}
              {st === "all" ? "All" : STATUS_LABEL[st]}
              <span className={`font-mono ${active ? "text-white/70" : "text-muted-foreground"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {rows.length} {rows.length === 1 ? "report" : "reports"}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          No reports match these filters.
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border">
          {rows.map((f) => (
            <li key={f.id} className="border-b border-border last:border-b-0">
              <button
                onClick={() => setParam("open", f.id)}
                style={{ borderLeft: `4px solid ${CATEGORY_COLOR[f.category].fg}` }}
                className={`grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 py-4 text-left transition-colors hover:bg-card md:grid-cols-[auto_1fr_auto_auto] md:items-center ${
                  f.status === "new" ? "bg-white" : f.status === "reviewed" ? "bg-card" : "bg-card/60 opacity-70"
                }`}
              >
                <StudentAvatar id={f.studentId} name={f.studentName} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {f.studentName} <span className="font-mono text-xs font-normal text-muted-foreground">{f.studentId}</span>
                  </p>
                  <p
                    className={`mt-0.5 line-clamp-2 text-sm ${
                      f.status === "new" ? "font-medium text-foreground" : "text-muted-foreground"
                    } ${f.status === "false-positive" ? "line-through decoration-muted-foreground/40" : ""}`}
                  >
                    “{f.message}”
                  </p>
                  <div className="mt-1.5">
                    <CategoryTag category={f.category} />
                  </div>
                </div>
                <div className="col-start-2 flex items-center gap-3 md:col-start-auto md:items-end">
                  {f.confidence !== undefined && <ConfidenceMeter value={f.confidence} />}
                </div>
                <div className="col-start-2 flex items-center justify-between gap-3 md:col-start-auto md:min-w-[110px] md:flex-col md:items-end md:gap-1.5">
                  <StatusPill status={f.status} />
                  <span className="text-xs text-muted-foreground">{timeAgo(f.createdAt)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <FlagDrawer
        flag={selected}
        history={selected ? flags.filter((f) => f.studentId === selected.studentId) : []}
        onClose={() => setParam("open", null)}
        onUpdate={updateFlag}
      />
    </div>
  );
}
