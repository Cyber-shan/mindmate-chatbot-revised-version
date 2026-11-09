"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AlgorithmOverview } from "@/lib/support/overview-types";
import type { AlgorithmTestResult } from "@/lib/support/testing";
import { useStaffSession } from "./StaffSession";

export type RecentAlgorithmTest = { id: string; recorded_at: string; result: AlgorithmTestResult };
type AlgorithmState = {
  data: AlgorithmOverview | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  recentTests: RecentAlgorithmTest[];
  recordTest: (result: AlgorithmTestResult) => void;
  privateReports: boolean;
};
const Context = createContext<AlgorithmState | null>(null);

export function AlgorithmProvider({ children, privateReports = false }: { children: ReactNode; privateReports?: boolean }) {
  const { session } = useStaffSession();
  const scope = privateReports ? session?.user.id ?? null : "status";
  const token = privateReports ? session?.access_token : undefined;
  const [snapshot, setSnapshot] = useState<{ scope: string | null; data: AlgorithmOverview | null; error: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentTests, setRecentTests] = useState<RecentAlgorithmTest[]>([]);
  const active = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    active.current?.abort();
    if (privateReports && !token) { setSnapshot(null); setLoading(false); return; }
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    try {
      const response = await fetch(privateReports ? "/api/admin/algorithm/overview" : "/api/admin/algorithm/status", {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.status === 401 || response.status === 403) {
        if (!controller.signal.aborted) setSnapshot({ scope, data: null, error: "Owner access could not be verified. Please sign in again." });
        return;
      }
      if (!response.ok) throw new Error("The classification status could not be loaded. Please try again.");
      const result = await response.json() as AlgorithmOverview;
      if (!result?.runtime || typeof result.checked_at !== "string") throw new Error("The classification status was incomplete. Please try again.");
      if (!controller.signal.aborted) setSnapshot({ scope, data: result, error: null });
    } catch (failure) {
      if (!controller.signal.aborted) setSnapshot((previous) => ({ scope, data: previous?.scope === scope ? previous.data : null, error: failure instanceof Error ? failure.message : "The classification status could not be loaded." }));
    } finally {
      if (active.current === controller) { active.current = null; setLoading(false); }
    }
  }, [privateReports, scope, token]);
  const recordTest = useCallback((result: AlgorithmTestResult) => {
    setRecentTests((previous) => [{ id: crypto.randomUUID(), recorded_at: new Date().toISOString(), result }, ...previous].slice(0, 20));
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); active.current?.abort(); };
  }, [refresh]);

  const data = snapshot?.scope === scope ? snapshot.data : null;
  const error = snapshot?.scope === scope ? snapshot.error : null;
  return <Context.Provider value={{ data, loading, error, refresh, recentTests, recordTest, privateReports }}>{children}</Context.Provider>;
}

export function useAlgorithmOverview() {
  const context = useContext(Context);
  if (!context) throw new Error("Algorithm views must be inside AlgorithmProvider.");
  return context;
}
