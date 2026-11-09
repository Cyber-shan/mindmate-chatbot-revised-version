"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AlgorithmOverview } from "@/lib/support/overview-types";
import type { AlgorithmTestResult } from "@/lib/support/testing";

export type RecentAlgorithmTest = { id: string; recorded_at: string; result: AlgorithmTestResult };
type AlgorithmState = {
  data: AlgorithmOverview | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  recentTests: RecentAlgorithmTest[];
  recordTest: (result: AlgorithmTestResult) => void;
};
const Context = createContext<AlgorithmState | null>(null);

export function AlgorithmProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AlgorithmOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentTests, setRecentTests] = useState<RecentAlgorithmTest[]>([]);
  const active = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/algorithm/overview", {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw new Error("The algorithm status could not be loaded. Please try again.");
      const result = await response.json() as AlgorithmOverview;
      if (!result?.runtime || typeof result.checked_at !== "string") throw new Error("The algorithm status was incomplete. Please try again.");
      if (!controller.signal.aborted) { setData(result); setError(null); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The algorithm status could not be loaded.");
    } finally {
      if (active.current === controller) { active.current = null; setLoading(false); }
    }
  }, []);
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

  return <Context.Provider value={{ data, loading, error, refresh, recentTests, recordTest }}>{children}</Context.Provider>;
}

export function useAlgorithmOverview() {
  const context = useContext(Context);
  if (!context) throw new Error("Algorithm views must be inside AlgorithmProvider.");
  return context;
}
