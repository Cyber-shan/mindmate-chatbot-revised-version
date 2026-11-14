import { createClient } from "@supabase/supabase-js";

export function isLocalSupabaseUrl(url) {
  return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}

export function requireSupabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing or invalid. Check .env.local."); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || (isLocalSupabaseUrl(url) ? url.protocol !== "http:" : url.protocol !== "https:")) {
    throw new Error("Supabase must use a hosted HTTPS origin or a local HTTP origin, without credentials, paths or query parameters.");
  }
  return url;
}

export function requirePublicSupabaseKey(value) {
  let role;
  try { role = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString()).role; } catch { /* Publishable keys are not JWTs. */ }
  if (!value?.trim() || /\s/.test(value)) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or invalid in .env.local.");
  if (value.startsWith("sb_secret_") || role === "service_role") {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must contain a publishable or anon key. Keep the secret/service-role key in SUPABASE_SERVICE_ROLE_KEY only.");
  }
  return value;
}

/** Read-only checks; hosted schema changes are applied explicitly through migrations. */
export async function verifyHostedSupabase({ env = process.env, signal, fetchImpl = fetch } = {}) {
  const url = requireSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (isLocalSupabaseUrl(url)) throw new Error("Configure your hosted Supabase project in .env.local first. See SUPABASE_SETUP.md.");
  const publicKey = requirePublicSupabaseKey(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key?.trim() || /\s/.test(key) || key === publicKey || key.startsWith("sb_publishable_")) {
    throw new Error("Add the hosted project's server-only secret or service-role key as SUPABASE_SERVICE_ROLE_KEY in .env.local. See SUPABASE_SETUP.md.");
  }
  const boundedFetch = (input, init) => fetchImpl(input, {
    ...init, redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]),
  });
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } };
  const server = createClient(url.origin, key, options);
  try {
    const auth = await boundedFetch(new URL("/auth/v1/settings", url), { headers: { apikey: publicKey } });
    await auth.arrayBuffer();
    if (!auth.ok) throw new Error("The hosted Supabase publishable key or Auth service is unavailable. Check the project URL, key and project status.");
    // An admin-only endpoint verifies that the configured key really has server access.
    const { error: credentialError } = await server.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (credentialError) throw new Error("The hosted Supabase server key was rejected. Use a secret or service-role key from the same project.");
    for (const table of ["conversations", "messages", "support_events"]) {
      const { error } = await server.from(table).select("id").limit(0).retry(false);
      if (error) throw new Error(`Hosted Supabase cannot read ${table}. Apply this project's migrations and check server-role permissions; see SUPABASE_SETUP.md.`);
    }
  } catch (error) {
    signal?.throwIfAborted();
    // Never expose SDK errors or response bodies containing credentials/account details.
    if (error instanceof Error && (error.message.startsWith("The hosted Supabase") || error.message.startsWith("Hosted Supabase cannot read"))) throw error;
    throw new Error("Unable to verify hosted Supabase. Check your internet connection and the project status; see SUPABASE_SETUP.md.");
  }
  return { url, key };
}

/** Reuse this launch's verified hosted APIs instead of probing local health/OpenAPI routes. */
export function createHostedSupabaseReadinessCheck(options = {}) {
  let verification;
  return async () => {
    options.signal?.throwIfAborted();
    verification ??= verifyHostedSupabase(options);
    await verification;
    options.signal?.throwIfAborted();
    return true;
  };
}
