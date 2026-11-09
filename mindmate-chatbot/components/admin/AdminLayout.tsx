"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Flag as FlagIcon, FlaskConical, LayoutDashboard, LayoutGrid, LogOut, Menu, Users, X } from "lucide-react";
import { type createTrendData, type Flag, type Status } from "./data";
import { signOutStaff, useStaffSession } from "./StaffSession";
import { ThemeToggle } from "@/components/theme-toggle";

export interface AdminContext {
  flags: Flag[];
  trendData: ReturnType<typeof createTrendData>;
  updateFlag: (id: string, patch: Partial<Pick<Flag, "status" | "notes">>) => void;
}

const AdminStateContext = createContext<AdminContext | null>(null);

export const useAdmin = () => {
  const context = useContext(AdminStateContext);
  if (!context) throw new Error("useAdmin must be used within AdminLayout");
  return context;
};

const NAV = [
  { to: "/admin", label: "Student dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/tester", label: "Algorithm tester", icon: FlaskConical, end: true },
  { to: "/admin/overview", label: "Algorithm overview", icon: LayoutGrid, end: true },
  { to: "/admin/reports", label: "Evaluation reports", icon: FlagIcon, end: false },
  { to: "/admin/students", label: "Sample students", icon: Users, end: false },
];

export default function AdminLayout({ children, initialFlags, trendData }: {
  children: ReactNode;
  initialFlags: Flag[];
  trendData: AdminContext["trendData"];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [flags, setFlags] = useState<Flag[]>(initialFlags);
  const [menuOpen, setMenuOpen] = useState(false);
  const { session } = useStaffSession();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const updateFlag: AdminContext["updateFlag"] = (id, patch) =>
    setFlags((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  if (pathname === "/admin/login") return <div className="admin-design min-h-screen">{children}</div>;

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-[60px] items-center gap-2 border-b border-border px-5">
        <span className="font-serif text-xl text-foreground">MindMate</span>
        <span className="rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
          Admin
        </span>
        <ThemeToggle className="ml-auto" />
      </div>

      <nav className="flex-1 space-y-1 p-3" aria-label="Admin">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <Link
            key={to}
            href={to}
            aria-current={(end ? pathname === to : pathname.startsWith(to)) ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            className={
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                (end ? pathname === to : pathname.startsWith(to)) ? "bg-foreground text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`
            }
          >
            <Icon className="size-4" aria-hidden />
            <span className="flex-1">{label}</span>
          </Link>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="flex size-9 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-primary-foreground">
            MM
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{session ? "Signed in" : "Admin workspace"}</p>
            <p className="truncate text-xs text-muted-foreground">{session?.user.email ?? "Prototype tools"}</p>
          </div>
          <button
            onClick={async () => {
              if (!session) { router.push("/admin/login"); return; }
              try { await signOutStaff(); router.replace("/admin/login"); }
              catch { setSignOutError("Unable to sign out. Please retry."); }
            }}
            aria-label={session ? "Sign out of administrator account" : "Administrator sign in"}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </div>
        {signOutError && <p role="alert" className="px-2 pb-2 text-xs text-destructive">{signOutError}</p>}
      </div>
    </div>
  );

  return (
    <AdminStateContext.Provider value={{ flags, trendData, updateFlag }}>
      <div className="admin-design flex h-screen w-full bg-background">
        <aside className="hidden w-64 shrink-0 border-r border-border md:block">{sidebar}</aside>

        {menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-64 border-r border-border shadow-xl">{sidebar}</aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[60px] items-center gap-3 border-b border-border px-4 md:hidden">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle menu"
              className="rounded-lg p-2 hover:bg-accent"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <span className="font-serif text-lg">MindMate Admin</span>
            <ThemeToggle className="ml-auto" />
          </header>
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </AdminStateContext.Provider>
  );
}

export type { Status };
