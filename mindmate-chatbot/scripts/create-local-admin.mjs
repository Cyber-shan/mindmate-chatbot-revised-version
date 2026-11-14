import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { requireLocalHttpUrl } from "./local-startup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
createRequire(import.meta.url)("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });

async function main() {
  const args = process.argv.slice(2);
  const prepareOnly = args.length === 1 && args[0] === "--prepare-only";
  if (!prepareOnly && args.length && (args.length !== 2 || args[0] !== "--email")) throw new Error("Usage: npm run create:admin -- --email admin@mindmate.local, or npm run setup:admin for existing accounts.");
  const email = (args[1] ?? "admin@mindmate.local").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new Error("Enter a valid administrator email address.");
  const configured = requireLocalHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "Supabase");
  if (configured.pathname !== "/" || configured.search || configured.hash) throw new Error("Administrator setup requires the configured local Supabase HTTP origin.");
  let status;
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, "node_modules", "supabase", "dist", "supabase.js"), "status", "--output", "json", "--workdir", root], { cwd: root, windowsHide: true, timeout: 20_000, maxBuffer: 1_000_000 });
    status = JSON.parse(stdout);
  } catch { throw new Error("Local Supabase discovery failed. Start the project with npm run dev, then retry administrator setup."); }
  if (requireLocalHttpUrl(status?.API_URL, "Local Supabase status").origin !== configured.origin) throw new Error("Supabase discovery does not match this project's configured local origin. No account was created.");
  const key = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (typeof key !== "string" || !key.trim() || /\s/.test(key)) throw new Error("Local administrator setup could not obtain a usable server credential.");
  // Existing chat migrations grant student access but not server-role reads.
  // Apply only this reviewed, idempotent read grant; never broaden student access.
  const reviewedGrant = `do $mindmate_staff_access$
begin
  grant select on public.conversations, public.messages to service_role;
  perform pg_notify('pgrst', 'reload schema');
end
$mindmate_staff_access$;`;
  const migration = await readFile(path.join(root, "supabase", "migrations", "20261109090000_enable_staff_support_reports.sql"), "utf8");
  if (migration.replace(/\r\n/g, "\n").trim() !== reviewedGrant) throw new Error("The staff-report permission migration differs from its reviewed setup script. Automatic setup was skipped.");
  try {
    await promisify(execFile)(process.execPath, [path.join(root, "node_modules", "supabase", "dist", "supabase.js"), "db", "query", "--local", "--output-format", "json", reviewedGrant, "--workdir", root], { cwd: root, windowsHide: true, timeout: 20_000, maxBuffer: 1_000_000 });
  } catch { throw new Error("Local staff-report read access could not be prepared. Start npm run dev and check the chat-history tables before retrying."); }
  if (prepareOnly) { process.stdout.write(JSON.stringify({ prepared: true, accounts_changed: false }) + "\n"); return; }
  const client = createClient(configured.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
  });
  const password = randomBytes(18).toString("base64url") + "!Aa7";
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { mindmate_role: "admin" }, user_metadata: { name: "MindMate Administrator" } });
  if (error || !data.user) {
    if (error?.code === "email_exists" || error?.code === "user_already_exists") throw new Error("This email already has an account. No existing password or role was changed. Use --email with a different administrator email.");
    throw new Error("The local administrator account could not be created. No existing account was modified.");
  }
  // This is the newly generated account password only, never a Supabase service key.
  // It is intentionally printed once for the owner and never written to a file.
  process.stdout.write(JSON.stringify({ email, password, user_id: data.user.id, login_path: "/admin/login" }) + "\n");
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : "Local administrator setup failed.");
  process.exitCode = 1;
}
