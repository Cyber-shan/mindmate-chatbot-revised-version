"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStaffSession } from "./StaffSession";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AdminLogin({ returnTo = "/admin" }: { returnTo?: string }) {
  const router = useRouter();
  const { session } = useStaffSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(token: string) {
    const response = await fetch("/api/admin/detections?access=check", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to verify administrator access.");
    router.replace(returnTo);
    router.refresh();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const { data, error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.session) throw new Error("The email or password is incorrect. Please try again.");
      await verify(data.session.access_token);
      setPassword("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally { setBusy(false); }
  }

  return <div className="flex min-h-screen items-center justify-center bg-card px-5 py-12">
    <ThemeToggle className="fixed right-5 top-5 z-20" />
    <div className="w-full max-w-md">
      <Link href="/" className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Back to MindMate</Link>
      <section className="rounded-3xl border border-border bg-background p-7 shadow-sm sm:p-9">
        <div className="mb-7 flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-2xl bg-foreground text-primary-foreground"><ShieldCheck className="size-5" /></span><div><p className="font-serif text-xl">MindMate</p><p className="text-xs text-muted-foreground">Administrator workspace</p></div></div>
        <h1 className="font-serif text-3xl">Admin sign in</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Access support-priority classification reports and review student accounts in priority order.</p>
        <form onSubmit={submit} className="mt-7 space-y-5">
          <div><label htmlFor="admin-email" className="mb-2 block text-xs font-semibold">Admin email</label><input id="admin-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="admin@mindmate.local" /></div>
          <div><label htmlFor="admin-password" className="mb-2 block text-xs font-semibold">Password</label><div className="relative"><input id="admin-password" type={visible ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full rounded-xl border border-border bg-card pl-3 pr-12 text-sm outline-none focus:ring-2 focus:ring-ring" /><button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"} className="absolute inset-y-0 right-1 rounded-lg px-3 text-muted-foreground">{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
          {error && <p role="alert" className="rounded-xl border border-danger-border bg-danger-surface p-3 text-xs leading-5 text-destructive">{error}</p>}
          <button disabled={busy} type="submit" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-50">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{busy ? "Verifying access…" : "Sign in to dashboard"}</button>
        </form>
        {session && <div className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground"><p className="break-all">Current account: {session.user.email}</p><button disabled={busy} className="mt-1 font-semibold text-foreground underline disabled:opacity-50" onClick={async () => { setBusy(true); setError(null); try { await verify(session.access_token); } catch (error) { setError(error instanceof Error ? error.message : "Unable to verify access."); } finally { setBusy(false); } }}>Continue with this account</button></div>}
        <p className="mt-6 text-[11px] leading-5 text-muted-foreground">Access is limited to approved staff accounts. Student accounts cannot open private reports.</p>
      </section>
    </div>
  </div>;
}
