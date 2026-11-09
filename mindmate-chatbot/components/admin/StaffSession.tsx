"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type StaffSessionState = { session: Session | null; loading: boolean; error: string | null };
const StaffContext = createContext<StaffSessionState | null>(null);

export function StaffSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StaffSessionState>({ session: null, loading: true, error: null });
  useEffect(() => {
    let mounted = true;
    let revision = 0;
    let unsubscribe = () => {};
    try {
      const client = createClient();
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
        revision++;
        if (mounted) setState({ session, loading: false, error: null });
      });
      unsubscribe = () => subscription.unsubscribe();
      const initialRevision = revision;
      void client.auth.getSession().then(({ data, error }) => {
        if (mounted && revision === initialRevision) setState({ session: data.session, loading: false, error: error ? "Unable to read your sign-in session. Please sign in again." : null });
      }).catch(() => {
        if (mounted && revision === initialRevision) setState({ session: null, loading: false, error: "Administrator sign-in is unavailable. Please retry." });
      });
    } catch {
      // Defer this error state so setup failures cannot escape the effect.
      void Promise.resolve().then(() => { if (mounted) setState({ session: null, loading: false, error: "Administrator sign-in is unavailable. Check the local configuration." }); });
    }
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return <StaffContext.Provider value={state}>{children}</StaffContext.Provider>;
}

export function useStaffSession() {
  const state = useContext(StaffContext);
  if (!state) throw new Error("StaffSessionProvider is required.");
  return state;
}

export async function signOutStaff() {
  const { error } = await createClient().auth.signOut({ scope: "local" });
  if (error) throw new Error("Unable to sign out. Please retry.");
}
