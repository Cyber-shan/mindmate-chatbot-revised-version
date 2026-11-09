import { Suspense } from "react";
import Link from "next/link";
import Reports from "@/components/admin/Reports";

export default function Page() {
  return <>
    <div className="mx-4 mt-6 rounded-xl border border-border bg-card px-4 py-3 text-xs leading-5 text-muted-foreground md:mx-8">
      <p className="font-semibold text-foreground">Synthetic sample reports</p>
      <p className="mt-1">These example students, flags, scores and review statuses demonstrate the review interface. They are not live algorithm results or a monitored counselor queue.</p>
      <Link href="/admin/reports" className="mt-2 inline-block font-semibold underline underline-offset-2">Open actual evaluation reports</Link>
    </div>
    <Suspense fallback={<p className="px-5 py-8 text-sm text-muted-foreground">Loading sample reports…</p>}><Reports /></Suspense>
  </>;
}
