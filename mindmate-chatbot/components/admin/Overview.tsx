"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAdmin } from "./AdminLayout";
import { CATEGORY_LABEL, CATEGORY_ORDER, STATUS_HELP, STATUS_LABEL, STATUS_ORDER, timeAgo } from "./data";
import { CATEGORY_COLOR, CATEGORY_ICON, CategoryTag, ColorGuide, STATUS_ICON, STATUS_STYLE, StatusPill, StudentAvatar } from "./ui";

export default function Overview() {
  const { flags, trendData } = useAdmin();
  const open = flags.filter((f) => f.status === "new");
  const recent = [...open].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 4);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 md:px-8">
      <div>
        <h1 className="font-serif text-3xl text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {open.length} new flagged {open.length === 1 ? "message" : "messages"} to review. This tool only helps surface messages early; it does not make decisions.
        </p>
      </div>

      <section aria-label="New flags by category" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {CATEGORY_ORDER.map((c) => {
          const Icon = CATEGORY_ICON[c];
          const { fg, bg } = CATEGORY_COLOR[c];
          const n = open.filter((f) => f.category === c).length;
          return (
            <Link
              key={c}
              href={`/admin/reports?category=${c}`}
              style={{ background: bg, borderColor: fg + "33" }}
              className="flex flex-col rounded-2xl border p-4 transition-opacity hover:opacity-80"
            >
              <Icon className="size-4" style={{ color: fg }} aria-hidden />
              <p className="mt-3 font-serif text-4xl" style={{ color: fg }}>{n}</p>
              <p className="mt-1 text-xs font-semibold" style={{ color: fg }}>{CATEGORY_LABEL[c]}</p>
              
            </Link>
          );
        })}
      </section>

      <section aria-label="Review status">
        <h2 className="mb-3 text-sm font-semibold">Review status</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {STATUS_ORDER.map((st) => {
            const Icon = STATUS_ICON[st];
            const n = flags.filter((f) => f.status === st).length;
            return (
              <Link
                key={st}
                href={`/admin/reports?status=${st}`}
                title={STATUS_HELP[st]}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-opacity hover:opacity-85 ${STATUS_STYLE[st]}`}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <div>
                  <p className="font-serif text-2xl leading-none">{n}</p>
                  <p className="mt-1 text-xs font-semibold">{STATUS_LABEL[st]}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <ColorGuide />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-2xl border border-border p-5 lg:col-span-3">
          <h2 className="text-sm font-semibold">Flags per day, last 14 days</h2>
          <div className="mt-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ left: -20 }}>
                <CartesianGrid key="grid" vertical={false} stroke="#E8E8E5" />
                <XAxis key="x" dataKey="day" tick={{ fontSize: 11, fill: "#4A4A47" }} tickLine={false} axisLine={false} interval={2} />
                <YAxis key="y" allowDecimals={false} tick={{ fontSize: 11, fill: "#4A4A47" }} tickLine={false} axisLine={false} />
                <Tooltip key="t" contentStyle={{ borderRadius: 12, border: "1px solid #E8E8E5", fontSize: 12 }} />
                                <Line key="all" type="monotone" dataKey="All flags" stroke="#111110" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-border p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Needs recent</h2>
            <Link href="/admin/reports" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {recent.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">No new flagged messages.</li>}
            {recent.map((f) => (
              <li key={f.id}>
                <Link href={`/admin/reports?open=${f.id}`} className="flex gap-3 py-3 hover:bg-card">
                  <StudentAvatar id={f.studentId} name={f.studentName} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{f.studentName}</span> · {timeAgo(f.createdAt)}
                      </p>
                      <StatusPill status={f.status} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-foreground">{f.message}</p>
                    <div className="mt-1.5">
                      <CategoryTag category={f.category} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
