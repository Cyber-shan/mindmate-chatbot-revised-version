import { Suspense } from "react";
import Reports from "@/components/admin/Reports";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Reports />
    </Suspense>
  );
}
