import type { ReactNode } from "react";
import { connection } from "next/server";
import AdminLayout from "@/components/admin/AdminLayout";
import { createAdminData } from "@/components/admin/data";
import { AlgorithmProvider } from "@/components/admin/AlgorithmProvider";
import { StaffSessionProvider } from "@/components/admin/StaffSession";

export const metadata = { robots: { index: false, follow: false } };

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
      <StaffSessionProvider><AlgorithmProvider>
        <AdminLayout initialFlags={flags} trendData={trendData}>
          {children}
        </AdminLayout>
      </AlgorithmProvider></StaffSessionProvider>
    </>
  );
}
