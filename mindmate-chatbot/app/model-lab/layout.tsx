import type { ReactNode } from "react";
import { connection } from "next/server";
import AdminLayout from "@/components/admin/AdminLayout";
import { AlgorithmProvider } from "@/components/admin/AlgorithmProvider";
import { StaffSessionProvider } from "@/components/admin/StaffSession";
import { requireOwnerPage } from "@/lib/admin/owner-page";

export const metadata = { title: "MindMate Support-priority classification", robots: { index: false, follow: false } };

export default async function Layout({ children }: { children: ReactNode }) {
  await connection();
  await requireOwnerPage();
  return <>
    {/* eslint-disable-next-line @next/next/no-css-tags -- Match the existing admin font loading. */}
    <link rel="stylesheet" href="/admin/fonts.css" precedence="admin-fonts" />
    <StaffSessionProvider><AlgorithmProvider privateReports>
      <AdminLayout privateTools>{children}</AdminLayout>
    </AlgorithmProvider></StaffSessionProvider>
  </>;
}
