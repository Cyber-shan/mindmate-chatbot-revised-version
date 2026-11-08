import type { ReactNode } from "react";
import { connection } from "next/server";
import AdminLayout from "@/components/admin/AdminLayout";
import { createAdminData } from "@/components/admin/data";

export default async function Layout({ children }: { children: ReactNode }) {
  await connection();
  const { flags, trendData } = createAdminData();

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-css-tags -- Preserve the exported remote font import outside the CSS bundle. */}
      <link
        rel="stylesheet"
        href="/admin/fonts.css"
        precedence="admin-fonts"
      />
      <AdminLayout initialFlags={flags} trendData={trendData}>
        {children}
      </AdminLayout>
    </>
  );
}
