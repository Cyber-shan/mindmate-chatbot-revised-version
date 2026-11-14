import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isLocalSupabaseUrl, requireSupabaseUrl } from "./supabase-startup.mjs";

export const backupTables = ["auth.users", "auth.identities", "public.conversations", "public.messages", "public.support_events", "public.support_review_history"];

export function buildRestoreSql(dump) {
  if (!dump.includes("-- PostgreSQL database dump complete")) throw new Error("The database export is incomplete. No backup was saved.");
  // Recent pg_dump releases add psql-only safety markers. This export is also
  // intended for the hosted SQL editor, which accepts SQL rather than psql commands.
  let sql = dump;
  const restrict = /^\\restrict ([A-Za-z0-9]+)\r?\n/m.exec(sql);
  let marker;
  if (restrict && sql.slice(0, restrict.index).split(/\r?\n/).every((line) => !line.trim() || line.startsWith("--"))) {
    marker = restrict[1];
    sql = sql.slice(0, restrict.index) + sql.slice(restrict.index + restrict[0].length);
  }
  const footerAt = sql.lastIndexOf("-- PostgreSQL database dump complete");
  let footer = sql.slice(footerAt);
  if (marker) {
    const unrestrict = new RegExp(`^\\\\unrestrict ${marker}\\r?\\n?`, "m");
    if (!unrestrict.test(footer)) throw new Error("The database export is incomplete. No backup was saved.");
    footer = footer.replace(unrestrict, "");
  }
  if (footer.split(/\r?\n/).some((line) => line.trim() && !line.startsWith("--"))) throw new Error("The export contains unsupported psql commands. No backup was saved.");
  sql = sql.slice(0, footerAt) + footer;
  const occupied = backupTables.map((table) => `exists (select 1 from ${table})`).join("\n    or ");
  return `-- PRIVATE: account password hashes, account metadata and conversation history.
-- Apply MindMate's schema migrations to a NEW hosted project before importing.
-- This transaction refuses to merge into an occupied destination.
begin;
do $mindmate_empty_destination$
begin
  if ${occupied} then
    raise exception 'Destination contains accounts or MindMate records. Use an empty project; no data was imported.';
  end if;
end
$mindmate_empty_destination$;
-- Preserve original timestamps and IDs while loading related rows. In particular,
-- the message trigger must not overwrite conversation updated_at during import.
set local session_replication_role = replica;

${sql.trim()}

-- Foreign-key triggers were paused during the import; verify all copied links.
do $mindmate_import_links$
begin
  if exists (select 1 from auth.identities i left join auth.users u on u.id = i.user_id where u.id is null)
    or exists (select 1 from public.conversations c left join auth.users u on u.id = c.user_id where u.id is null)
    or exists (select 1 from public.messages m left join public.conversations c on c.id = m.conversation_id where c.id is null)
    or exists (select 1 from public.support_events e left join public.conversations c on c.id = e.conversation_id left join public.messages m on m.id = e.message_id where c.id is null or m.id is null)
    or exists (select 1 from public.support_review_history h left join public.support_events e on e.id = h.event_id where e.id is null) then
    raise exception 'Imported data has missing account or conversation links. The import was rolled back.';
  end if;
end
$mindmate_import_links$;
commit;
`;
}

async function findDocker(env) {
  const windows = process.platform === "win32";
  const binary = windows ? "docker.exe" : "docker";
  const candidates = (env.PATH ?? "").split(path.delimiter).filter(Boolean)
    .map((directory) => path.join(directory.replace(/^"|"$/g, ""), binary));
  if (windows) candidates.push(
    path.join(env.LOCALAPPDATA ?? "", "Programs", "DockerDesktop", "resources", "bin", binary),
    path.join(env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin", binary),
  );
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* Try the next install location. */ } }
  throw new Error("Docker CLI was not found. It is needed once to export the existing local database.");
}

/** Reads the local database only. It never starts/stops containers or writes remotely. */
export async function backupLocalSupabase({ root, env = process.env, executeFile = promisify(execFile), dockerExecutable, now = new Date() }) {
  const configured = requireSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!isLocalSupabaseUrl(configured)) throw new Error("Export before replacing the local Supabase URL in .env.local. This command only reads your local database.");
  const docker = dockerExecutable ?? await findDocker(env);
  const childEnv = { ...env, PATH: [path.dirname(docker), env.PATH].filter(Boolean).join(path.delimiter) };
  const config = await readFile(path.join(root, "supabase", "config.toml"), "utf8");
  const projectId = config.match(/^\s*project_id\s*=\s*"([A-Za-z0-9_-]+)"/m)?.[1];
  if (!projectId) throw new Error("Cannot identify the local Supabase database from config.toml.");
  let status;
  try {
    const result = await executeFile(process.execPath, [path.join(root, "node_modules", "supabase", "dist", "supabase.js"), "status", "--output", "json", "--workdir", root], { cwd: root, env: childEnv, windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 });
    status = JSON.parse(result.stdout);
  } catch { throw new Error("The local Supabase database is unavailable. Start Docker Desktop and local Supabase once for the export, then retry. No data was changed."); }
  if (requireSupabaseUrl(status?.API_URL).origin !== configured.origin) throw new Error("Local Supabase discovery does not match .env.local. No database was exported.");
  let dump;
  try {
    const result = await executeFile(docker, ["exec", "--user", "postgres", `supabase_db_${projectId}`, "pg_dump", "--username=postgres", "--dbname=postgres", "--data-only", "--column-inserts", "--no-owner", "--no-privileges", ...backupTables.map((table) => `--table=${table}`)], {
      cwd: root, env: childEnv, windowsHide: true, timeout: 120_000, maxBuffer: 128 * 1024 * 1024,
    });
    dump = result.stdout;
  } catch { throw new Error("The local data export failed. Check that all MindMate tables exist and the local database is ready. No backup was saved and no data was changed."); }
  const sql = buildRestoreSql(dump);
  const directory = path.join(root, "backups", `supabase-${now.toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, "restore-data.sql");
  await writeFile(filename, sql, { flag: "wx", mode: 0o600 });
  return filename;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  createRequire(import.meta.url)("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });
  try {
    const filename = await backupLocalSupabase({ root });
    console.log(`Local accounts, password hashes, administrator roles, conversations, messages and support events exported to:\n${filename}\nKeep this private. Follow SUPABASE_SETUP.md to import into an empty hosted project. Existing browser sessions are not copied; sign in again after migration.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Local Supabase export failed.");
    process.exitCode = 1;
  }
}
