import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireLocalHttpUrl, waitUntil } from "./local-startup.mjs";

export const SUPPORT_MIGRATION = "20261108090000";
const migrationName = "create_support_events";
const migrationHash = "5fbe4309d254f51af01b67a6e208fd81cb64c3a6a7fff56f3d6185902f377505";
// Only these errors contain messages that are safe to show during startup.
class LocalAuditSetupError extends Error {}

const inspectSql = `select
  to_regclass('public.support_events') is not null as table_exists,
  to_regclass('supabase_migrations.schema_migrations') is not null as history_exists,
  to_regclass('public.conversations') is not null and to_regclass('public.messages') is not null as chat_ready,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.support_events')), false) as rls_enabled,
  case when to_regclass('public.support_events') is null then false else
    has_table_privilege('anon', 'public.support_events', 'SELECT,INSERT,UPDATE,DELETE') or
    has_table_privilege('authenticated', 'public.support_events', 'SELECT,INSERT,UPDATE,DELETE') end as student_access`;

function parseJson(output) {
  try { return JSON.parse(output.replace(/^\uFEFF/, "")); } catch { throw new LocalAuditSetupError("The local Supabase CLI returned invalid setup metadata."); }
}

function parseBooleanRow(output, fields) {
  const result = parseJson(output);
  // CLI versions can return a bare result array or an envelope with rows.
  // Extra envelope fields (such as the CLI's untrusted-data warning) are ignored.
  const rows = Array.isArray(result) ? result : result?.rows;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object" || Array.isArray(rows[0])) {
    throw new LocalAuditSetupError("The local Supabase schema check returned an unsupported result format. Check the installed Supabase CLI.");
  }
  return Object.fromEntries(fields.map((field) => {
    const value = rows[0][field];
    // PostgreSQL boolean text must be decoded explicitly: Boolean("false") is true.
    if (value === true || value === "true" || value === "t") return [field, true];
    if (value === false || value === "false" || value === "f") return [field, false];
    throw new LocalAuditSetupError("The local Supabase schema check did not return the expected boolean setup metadata.");
  }));
}

function parseState(output) {
  return parseBooleanRow(output, ["table_exists", "history_exists", "chat_ready", "rls_enabled", "student_access"]);
}

function requirePrivateTable(state) {
  if (!state.table_exists || !state.rls_enabled || state.student_access) {
    throw new LocalAuditSetupError("The local support-history table is missing or its privacy permissions need repair. No existing table or permissions were changed automatically.");
  }
}

export function supportMigrationSql(migration) {
  const normalized = migration.replace(/\r\n/g, "\n").trim();
  if (createHash("sha256").update(normalized).digest("hex") !== migrationHash) {
    throw new LocalAuditSetupError("The support-history migration differs from the reviewed local setup script. Automatic schema setup was skipped.");
  }
  const literal = (value) => `'${value.replace(/'/g, "''")}'`;
  // The installed CLI prepares one statement; a DO block is atomic on failure.
  return `do $mindmate_support_setup$
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '10s', true);
  perform pg_advisory_xact_lock(hashtextextended('mindmate-local-support-history-v1', 0));
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text not null primary key,
    statements text[],
    name text
  );
  if exists (select 1 from supabase_migrations.schema_migrations where version = '${SUPPORT_MIGRATION}') then
    if to_regclass('public.support_events') is null then
      raise exception 'Support-history migration is recorded but its table is missing';
    end if;
  elsif to_regclass('public.support_events') is not null then
    raise exception 'Support-history table already exists without matching migration metadata';
  else
    execute ${literal(normalized)};
    insert into supabase_migrations.schema_migrations (version, name, statements)
      values ('${SUPPORT_MIGRATION}', '${migrationName}', array[${literal(normalized)}]);
  end if;
  perform pg_notify('pgrst', 'reload schema');
end
$mindmate_support_setup$;`;
}

/** Memory-only credentials and one pinned local migration; no reset, remote CLI target, or queue activation. */
export async function prepareLocalAudit({ root, env, executeFile, log = () => {}, signal, fetchImpl = fetch, wait = waitUntil }) {
  const configured = requireLocalHttpUrl(env.NEXT_PUBLIC_SUPABASE_URL, "Supabase");
  if (configured.pathname !== "/" || configured.search || configured.hash) {
    throw new LocalAuditSetupError("Local support-history setup requires a Supabase HTTP origin without a path or query.");
  }
  const cli = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
  const runCli = async (args, action) => {
    signal?.throwIfAborted();
    try {
      return await executeFile(process.execPath, [cli, ...args, "--workdir", root], {
        cwd: root, env, windowsHide: true, timeout: 20_000, maxBuffer: 1_000_000, signal,
      });
    } catch {
      signal?.throwIfAborted();
      // CLI output can contain local credentials; never include it in errors or logs.
      throw new LocalAuditSetupError(`Local support-history ${action} failed. Check the local Supabase installation and database, then retry.`);
    }
  };
  const status = parseJson((await runCli(["status", "--output", "json"], "service discovery")).stdout);
  const discovered = requireLocalHttpUrl(status?.API_URL, "Local Supabase status");
  if (discovered.origin !== configured.origin) {
    throw new LocalAuditSetupError("The Supabase CLI project does not match the configured local API origin. No credentials or schema changes were applied.");
  }
  const existing = env.SUPABASE_SERVICE_ROLE_KEY;
  const serviceKey = existing || status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (typeof serviceKey !== "string" || !serviceKey.trim() || /\s/.test(serviceKey)) {
    throw new LocalAuditSetupError("Local Supabase did not provide a usable server-only support-history credential.");
  }
  const probe = async () => {
    try {
      const response = await fetchImpl(new URL("/rest/v1/support_events?select=message_id,decision,review_status&limit=0", configured), {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]),
        redirect: "error", cache: "no-store",
      });
      if (response.ok) { await response.arrayBuffer(); return "ready"; }
      if (response.status === 401 || response.status === 403) return "unauthorized";
      const body = await response.json().catch(() => null);
      return response.status === 404 && ["PGRST205", "42P01"].includes(body?.code) ? "missing" : "unavailable";
    } catch {
      signal?.throwIfAborted();
      return "unavailable";
    }
  };
  const firstProbe = await probe();
  if (firstProbe === "unauthorized") throw new LocalAuditSetupError("The configured local support-history credential was rejected. It was not overwritten.");
  if (firstProbe === "unavailable") throw new LocalAuditSetupError("The local support-history API is unavailable. No schema changes were applied.");
  const query = async (sql, action) => (await runCli(["db", "query", "--local", "--output-format", "json", sql], action)).stdout;
  let state = parseState(await query(inspectSql, "schema inspection"));
  let migrated = false;
  if (!state.table_exists) {
    if (firstProbe === "ready") throw new LocalAuditSetupError("Local Supabase API and database schema checks disagree. Automatic schema setup was skipped.");
    if (!state.chat_ready) throw new LocalAuditSetupError("The local chat-history schema must be available before support-history setup. No unrelated migrations were applied.");
    if (state.history_exists) {
      const metadata = parseBooleanRow(await query(`select exists (select 1 from supabase_migrations.schema_migrations where version = '${SUPPORT_MIGRATION}') as migration_applied`, "migration inspection"), ["migration_applied"]);
      if (metadata.migration_applied) throw new LocalAuditSetupError("The local support-history migration is marked applied but its table is missing. Automatic schema repair was skipped.");
    }
    const migrationPath = path.join(root, "supabase", "migrations", `${SUPPORT_MIGRATION}_${migrationName}.sql`);
    const migration = supportMigrationSql(await readFile(migrationPath, "utf8"));
    log("Preparing local support-history storage...");
    await query(migration, "migration");
    state = parseState(await query(inspectSql, "privacy verification"));
    migrated = true;
  } else if (firstProbe === "missing") {
    requirePrivateTable(state);
    await query("notify pgrst, 'reload schema'", "schema-cache refresh");
  }
  requirePrivateTable(state);
  await wait(async () => await probe() === "ready", { description: "Local support-history API", signal, timeoutMs: 10_000, intervalMs: 250 });
  if (!existing) env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  // Deliberately leave SUPPORT_REVIEW_QUEUE_ENABLED unchanged.
  log("Local support history is ready. Review requests keep the configured queue setting.");
  return { available: true, managedCredential: !existing, migrated };
}

/** Optional persistence must not prevent the app and classifier from starting. */
export async function prepareOptionalLocalAudit(options) {
  options.signal?.throwIfAborted();
  try {
    return await prepareLocalAudit(options);
  } catch (error) {
    // Ctrl+C must still stop startup rather than launching Next.js afterward.
    options.signal?.throwIfAborted();
    // Empty values also prevent Next.js from reloading a configured key from .env.
    // Only the launcher's child environment changes; saved configuration stays intact.
    options.env.SUPABASE_SERVICE_ROLE_KEY = "";
    options.env.SUPPORT_REVIEW_QUEUE_ENABLED = "false";
    const reason = error instanceof LocalAuditSetupError ? ` ${error.message}` : "";
    options.log?.(`Local support history is unavailable.${reason}`);
    options.log?.("Continuing with chat and the classifier. Saved support notices and review requests are unavailable for this run; restart after repairing local support-history setup to retry.");
    return { available: false };
  }
}
