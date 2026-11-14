import AdminLogin from "@/components/admin/AdminLogin";

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AdminLogin returnTo={next === "/model-lab" || next === "/model-lab/reports" ? next : "/admin"} />;
}
