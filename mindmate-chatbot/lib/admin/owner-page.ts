import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOwnerId } from "./owner";
import { StaffReportError } from "./staff";

/** Verify the cookie session on the server before rendering either private page. */
export async function requireOwnerPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) notFound();
  const cookieStore = await cookies();
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      // Server Components cannot write cookies; the browser client refreshes them.
      setAll() {},
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) }) },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error && (!error.status || error.status >= 500)) {
    throw new Error("Owner access could not be verified. Please try again.");
  }
  if (!user || user.is_anonymous) redirect("/admin/login?next=/model-lab");
  try { requireOwnerId(user.id); }
  catch (error) {
    if (error instanceof StaffReportError) notFound();
    throw error;
  }
}
