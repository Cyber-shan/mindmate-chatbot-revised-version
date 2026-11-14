import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupLocalSupabase, backupTables, buildRestoreSql } from "../scripts/backup-local-supabase.mjs";

const dump = "-- PostgreSQL database dump\n\\restrict abc123\nINSERT INTO auth.users (id, encrypted_password, raw_app_meta_data) VALUES ('owner-id', 'original-password-hash', '{\"mindmate_role\":\"admin\"}');\n-- PostgreSQL database dump complete\n\\unrestrict abc123\n";

test("restore keeps account credentials and roles and wraps data in a guarded atomic import", () => {
  const sql = buildRestoreSql(dump);
  assert.match(sql, /original-password-hash/);
  assert.match(sql, /mindmate_role/);
  assert.doesNotMatch(sql, /^\\/m);
  assert.ok(sql.indexOf("begin;") < sql.indexOf("INSERT INTO"));
  assert.ok(sql.indexOf("Destination contains accounts") < sql.indexOf("INSERT INTO"));
  for (const table of backupTables) assert.ok(sql.includes(`exists (select 1 from ${table})`));
  assert.ok(sql.indexOf("set local session_replication_role = replica") < sql.indexOf("INSERT INTO"));
  assert.ok(sql.indexOf("missing account or conversation links") > sql.indexOf("INSERT INTO"));
  assert.ok(sql.trim().endsWith("commit;"));
  assert.throws(() => buildRestoreSql("partial export"), /incomplete/);
  assert.throws(() => buildRestoreSql(dump + "\\connect other_database\n"), /unsupported psql/);
});

test("removing pg_dump wrapper markers never edits matching lines inside saved messages", () => {
  const content = "message before\\n\n\\restrict abc123\n\\unrestrict abc123\nmessage after";
  const withMessage = dump.replace("-- PostgreSQL database dump complete", `INSERT INTO public.messages (content) VALUES ('${content}');\n-- PostgreSQL database dump complete`);
  assert.ok(buildRestoreSql(withMessage).includes(content));
});

test("backup refuses hosted sources without touching Docker or a database", async () => {
  await assert.rejects(backupLocalSupabase({ root: ".", env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" }, executeFile: async () => assert.fail("No command expected") }), /only reads your local database/);
});

test("backup exports only the intended local database and preserves auth identities and all app records", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mindmate-backup-"));
  t.after(async () => {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(root).startsWith("mindmate-backup-"));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, "supabase"));
  await writeFile(path.join(root, "supabase", "config.toml"), 'project_id = "mindmate-chatbot"\n');
  const configured = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55121" };
  const calls = [];
  const executeFile = async (file, args) => {
    calls.push({ file, args });
    if (args.includes("status")) return { stdout: JSON.stringify({ API_URL: configured.NEXT_PUBLIC_SUPABASE_URL }) };
    assert.equal(file, "docker-test");
    assert.deepEqual(args.slice(0, 5), ["exec", "--user", "postgres", "supabase_db_mindmate-chatbot", "pg_dump"]);
    assert.ok(args.includes("--data-only"));
    assert.ok(args.includes("--column-inserts"));
    assert.deepEqual(args.filter((arg) => arg.startsWith("--table=")), backupTables.map((table) => `--table=${table}`));
    return { stdout: dump };
  };
  const filename = await backupLocalSupabase({ root, env: configured, dockerExecutable: "docker-test", executeFile });
  assert.equal(calls.length, 2);
  assert.ok(filename.startsWith(path.join(root, "backups")));
  assert.equal(await readFile(filename, "utf8"), buildRestoreSql(dump));

  await assert.rejects(backupLocalSupabase({ root, env: configured, dockerExecutable: "docker-test", executeFile: async (_file, args) => {
    assert.ok(args.includes("status"), "A mismatched local origin must stop before pg_dump");
    return { stdout: JSON.stringify({ API_URL: "http://127.0.0.1:55199" }) };
  } }), /does not match/);
});
