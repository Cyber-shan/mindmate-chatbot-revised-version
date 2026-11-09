"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { useAdmin } from "./AdminLayout";
import { CATEGORY_LABEL, CATEGORY_ORDER, timeAgo, type Category, type Flag } from "./data";
import { CATEGORY_COLOR, CategoryDot, StudentAvatar } from "./ui";

export default function Students() {
  const { flags } = useAdmin();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");

  const students = useMemo(() => {
    const byStudent = new Map<string, Flag[]>();
    flags.forEach((f) => byStudent.set(f.studentId, [...(byStudent.get(f.studentId) ?? []), f]));
    return [...byStudent.entries()]
      .map(([id, list]) => {
        const latest = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
        const cats = CATEGORY_ORDER.filter((c) => list.some((f) => f.category === c));
        return { id, name: latest.studentName, list, latest, cats, open: list.filter((f) => f.status === "new").length };
      })
      .sort((a, b) => +new Date(b.latest.createdAt) - +new Date(a.latest.createdAt));
  }, [flags]);

  const needle = q.trim().toLowerCase();
  const shown = students.filter(
    (s) =>
      (cat === "all" || s.cats.includes(cat)) &&
      (!needle || `${s.name} ${s.id}`.toLowerCase().includes(needle)),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <div>
        <h1 className="font-serif text-3xl">Sample students</h1>
        <p className="mt-1 text-sm text-muted-foreground">Synthetic records for exploring the review interface. These are not real students or live algorithm decisions.</p>
        <p className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 text-muted-foreground">Sample messages and review statuses are demonstration data. Use Algorithm tester for live decisions and Evaluation reports for measured classifier results.</p>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by student name or ID"
            aria-label="Search students"
            className="h-11 w-full rounded-full border border-border bg-background pl-10 pr-10 text-sm outline-none focus:border-foreground"
          />
          {q && (
            <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {(["all", ...CATEGORY_ORDER] as const).map((c) => {
            const active = cat === c;
            return (
              <button
                key={c}
                onClick={() => setCat(c)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active ? "border-foreground bg-foreground text-background" : "border-border hover:bg-card"
                }`}
              >
                {c !== "all" && <CategoryDot category={c} />}
                {c === "all" ? "All categories" : CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {shown.length} of {students.length} students
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          No students match your search.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => (
            <li key={s.id}>
              <Link
                href={`/admin/sample-reports?open=${s.latest.id}`}
                className="block rounded-2xl border border-border p-4 transition-colors hover:bg-card"
              >
                <div className="flex items-center gap-3">
                  <StudentAvatar id={s.id} name={s.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{s.id}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.cats.map((c) => (
                    <span
                      key={c}
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ color: CATEGORY_COLOR[c].fg, background: CATEGORY_COLOR[c].bg }}
                    >
                      {CATEGORY_LABEL[c]}
                    </span>
                  ))}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Flags", s.list.length],
                    ["New", s.open],
                    ["Last", timeAgo(s.latest.createdAt)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-secondary py-2">
                      <dt className="text-[11px] text-muted-foreground">{k}</dt>
                      <dd className="text-sm font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
