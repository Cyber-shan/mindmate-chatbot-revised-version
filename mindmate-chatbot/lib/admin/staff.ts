import { createClient } from "@supabase/supabase-js";

export class StaffReportError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function boundedFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => fetch(input, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000), ...(init?.signal ? [init.signal] : [])]),
  });
}

export async function requireStaff(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer \S+$/.test(authorization)) {
    throw new StaffReportError("Sign in with your administrator account to view student reports.", 401);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey) throw new StaffReportError("Administrator sign-in is unavailable. Check the local Supabase configuration.", 503);
  const client = createClient(url, publicKey, {
    global: { fetch: boundedFetch(request.signal) }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser(authorization.slice(7));
  if (error) throw new StaffReportError("Unable to verify administrator access. Please sign in again.", !error.status || error.status >= 500 ? 503 : 401);
  if (!user || !uuid.test(user.id) || user.is_anonymous) throw new StaffReportError("Please sign in again with your administrator account.", 401);
  // user_metadata is editable by students and must never grant staff access.
  const role = user.app_metadata?.mindmate_role;
  const allowedEmails = (process.env.MINDMATE_ADMIN_EMAILS ?? "").split(/[,\n]/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const allowlisted = Boolean(user.email_confirmed_at && user.email && allowedEmails.includes(user.email.toLowerCase()));
  if (role !== "admin" && role !== "counselor" && !allowlisted) {
    throw new StaffReportError("This account does not have administrator access to student reports.", 403);
  }
  return { id: user.id, email: user.email ?? null };
}

export function staffDataClient(signal: AbortSignal) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StaffReportError("Private detection storage is unavailable. Restart with npm run dev and check the support-history setup message.", 503);
  return createClient(url, key, {
    global: { fetch: boundedFetch(signal) }, auth: { persistSession: false, autoRefreshToken: false },
  });
}
