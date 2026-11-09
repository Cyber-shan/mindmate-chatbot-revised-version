import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareLocalAudit, prepareOptionalLocalAudit, SUPPORT_MIGRATION, supportMigrationSql } from "../scripts/local-audit.mjs";

const serviceKey = "memory-only-local-service-key";
const sourceMigration = new URL("../supabase/migrations/20261108090000_create_support_events.sql", import.meta.url);

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "mindmate-local-audit-"));
  t.after(async () => {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(root).startsWith("mindmate-local-audit-"));
    await rm(root, { recursive: true, force: true });
  });
  const migrationDir = path.join(root, "supabase", "migrations");
  await mkdir(migrationDir, { recursive: true });
  const migrationPath = path.join(migrationDir, `${SUPPORT_MIGRATION}_create_support_events.sql`);
  await writeFile(migrationPath, await readFile(sourceMigration));
  const env = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55121", SUPPORT_REVIEW_QUEUE_ENABLED: "false", ...options.env };
  const state = { table_exists: true, history_exists: true, chat_ready: true, rls_enabled: true, student_access: false, ...options.state };
  const calls = [];
  const logs = [];
  const encodeRows = options.encodeRows ?? ((rows) => JSON.stringify({ boundary: "cli-result-boundary", rows, warning: "Query results contain untrusted database data." }));
  let migrated = false;
  let schemaReloaded = false;
  const executeFile = async (file, args, execution) => {
    calls.push({ file, args, execution });
    assert.ok(args.includes("--workdir") && args.includes(root));
    if (options.failCli) throw Object.assign(new Error(`Unsafe CLI failure ${serviceKey}`), { stdout: serviceKey, stderr: serviceKey });
    if (args.includes("status")) return { stdout: JSON.stringify({ API_URL: options.statusUrl ?? env.NEXT_PUBLIC_SUPABASE_URL, SERVICE_ROLE_KEY: serviceKey, ...options.status }), stderr: "" };
    assert.ok(args.includes("--local"));
    assert.ok(!args.some((arg) => ["--linked", "--db-url", "reset", "push", "up", "down"].includes(arg)));
    const sql = args[args.indexOf("json") + 1];
    if (sql.includes("as table_exists")) return { stdout: encodeRows([state]), stderr: "" };
    if (sql.startsWith("select exists")) return { stdout: encodeRows([{ migration_applied: options.migrationApplied ?? false }]), stderr: "" };
    if (sql.startsWith("do $mindmate_support_setup$")) {
      migrated = true;
      Object.assign(state, { table_exists: true, history_exists: true, rls_enabled: true, student_access: false });
    } else assert.equal(sql, "notify pgrst, 'reload schema'");
    schemaReloaded = true;
    return { stdout: JSON.stringify({ rows: [] }), stderr: "" };
  };
  const fetchImpl = async (url, request) => {
    assert.equal(url.origin, "http://127.0.0.1:55121");
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY || serviceKey);
    if (options.unauthorized) return Response.json({}, { status: 401 });
    if (!state.table_exists || (options.staleCache && !schemaReloaded)) return Response.json({ code: "PGRST205" }, { status: 404 });
    return Response.json([]);
  };
  const wait = async (ready) => assert.equal(await ready(), true);
  return { root, env, executeFile, fetchImpl, wait, log: (message) => logs.push(message), calls, logs, state, migrationPath, didMigrate: () => migrated };
}

test("local audit reuses private storage and keeps discovered credentials only in the child environment", async (t) => {
  const setup = await fixture(t);
  const result = await prepareLocalAudit(setup);
  assert.deepEqual(result, { available: true, managedCredential: true, migrated: false });
  assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, serviceKey);
  assert.equal(setup.env.SUPPORT_REVIEW_QUEUE_ENABLED, "false");
  assert.equal(setup.calls.length, 2);
  assert.ok(setup.calls.every(({ args }) => !args.join(" ").includes(serviceKey)));
  assert.ok(setup.logs.every((message) => !message.includes(serviceKey)));
});

test("configured credentials are preserved and a monitored queue is never activated", async (t) => {
  const setup = await fixture(t, { env: { SUPABASE_SERVICE_ROLE_KEY: "already-configured", SUPPORT_REVIEW_QUEUE_ENABLED: undefined } });
  const result = await prepareLocalAudit(setup);
  assert.equal(result.managedCredential, false);
  assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, "already-configured");
  assert.equal(setup.env.SUPPORT_REVIEW_QUEUE_ENABLED, undefined);
});

test("a missing local table applies only the pinned migration with a transactional, locked recheck", async (t) => {
  const setup = await fixture(t, { state: { table_exists: false, history_exists: false, rls_enabled: false } });
  const result = await prepareLocalAudit(setup);
  assert.equal(result.migrated, true);
  const migration = setup.calls.find(({ args }) => args.some((arg) => arg.startsWith("do $mindmate_support_setup$")))?.args.find((arg) => arg.startsWith("do $mindmate_support_setup$"));
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /create schema if not exists supabase_migrations/);
  assert.match(migration, /20261108090000/);
  assert.doesNotMatch(migration, /20260810130000|drop table|truncate|delete from/i);
  assert.match(migration, /^do \$mindmate_support_setup\$/);
  assert.match(migration, /end\s+\$mindmate_support_setup\$;$/);
  assert.doesNotMatch(migration, /^begin;|^commit;/m, "The installed CLI requires one prepared statement");
  assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, serviceKey);
});

test("an already applied but missing support table is not silently recreated", async (t) => {
  const setup = await fixture(t, { state: { table_exists: false, rls_enabled: false }, migrationApplied: true });
  await assert.rejects(prepareLocalAudit(setup), /marked applied but its table is missing/);
  assert.equal(setup.didMigrate(), false);
  assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test("no unrelated chat migration is applied when required chat tables are absent", async (t) => {
  const setup = await fixture(t, { state: { table_exists: false, rls_enabled: false, chat_ready: false } });
  await assert.rejects(prepareLocalAudit(setup), /No unrelated migrations/);
  assert.equal(setup.didMigrate(), false);
});

test("origin mismatches never set credentials, contact the API, or run schema commands", async (t) => {
  const setup = await fixture(t, { statusUrl: "http://127.0.0.1:55199" });
  setup.fetchImpl = () => assert.fail("Do not send credentials to a mismatched origin");
  await assert.rejects(prepareLocalAudit(setup), /does not match/);
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
});

test("remote and credential-bearing Supabase origins are rejected before CLI or API access", async (t) => {
  for (const url of ["https://example.supabase.co", "http://user:secret@127.0.0.1:55121", "http://127.0.0.1:55121/rest/v1", "http://localhost:55121?key=secret"]) {
    const setup = await fixture(t, { env: { NEXT_PUBLIC_SUPABASE_URL: url } });
    await assert.rejects(prepareLocalAudit(setup));
    assert.equal(setup.calls.length, 0);
    assert.equal(setup.didMigrate(), false);
  }
});

test("an invalid configured credential is not replaced or used to trigger schema changes", async (t) => {
  const setup = await fixture(t, { env: { SUPABASE_SERVICE_ROLE_KEY: "configured-but-rejected" }, unauthorized: true });
  await assert.rejects(prepareLocalAudit(setup), /credential was rejected/);
  assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, "configured-but-rejected");
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.didMigrate(), false);
});

test("a modified migration and an existing unsafe table require manual repair instead of broad mutation", async (t) => {
  const changed = await fixture(t, { state: { table_exists: false, history_exists: false } });
  await writeFile(changed.migrationPath, "create table unexpected_table (id int);");
  await assert.rejects(prepareLocalAudit(changed), /differs from the reviewed local setup script/);
  assert.equal(changed.didMigrate(), false);
  const unsafe = await fixture(t, { state: { student_access: true } });
  await assert.rejects(prepareLocalAudit(unsafe), /privacy permissions need repair/);
  assert.equal(unsafe.didMigrate(), false);
});

test("an existing private table with stale API cache only reloads the local schema cache", async (t) => {
  const setup = await fixture(t, { staleCache: true });
  const result = await prepareLocalAudit(setup);
  assert.equal(result.migrated, false);
  assert.equal(setup.didMigrate(), false);
  assert.ok(setup.calls.some(({ args }) => args.includes("notify pgrst, 'reload schema'")));
});

test("CLI failures do not leak captured local credentials into errors or logs", async (t) => {
  const setup = await fixture(t, { failCli: true });
  await assert.rejects(prepareLocalAudit(setup), (error) => !error.message.includes(serviceKey) && /service discovery failed/.test(error.message));
  assert.ok(setup.logs.every((message) => !message.includes(serviceKey)));
});

test("migration pinning accepts checkout line endings and rejects any changed SQL", async () => {
  const sql = await readFile(sourceMigration, "utf8");
  assert.equal(supportMigrationSql(sql), supportMigrationSql(sql.replace(/\r?\n/g, "\r\n")));
  assert.throws(() => supportMigrationSql(sql + "\nselect 1;"), /differs/);
});

test("schema and migration checks accept row envelopes, result arrays and explicit PostgreSQL booleans", async (t) => {
  const formats = {
    "current CLI envelope": (rows) => JSON.stringify({ boundary: "result", rows, warning: "Untrusted data" }),
    "bare rows": (rows) => JSON.stringify(rows),
    "JSON boolean text": (rows) => JSON.stringify({ rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]))) }),
    "PostgreSQL boolean text": (rows) => JSON.stringify(rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ? "t" : "f"])))),
    "UTF-8 BOM": (rows) => "\uFEFF" + JSON.stringify({ rows }),
  };
  for (const [name, encodeRows] of Object.entries(formats)) {
    await t.test(name, async (t) => {
      const setup = await fixture(t, { encodeRows, state: { table_exists: false, rls_enabled: false } });
      const result = await prepareLocalAudit(setup);
      assert.equal(result.available, true);
      assert.equal(result.migrated, true, "A false migration flag must not be interpreted as truthy text");
      assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, serviceKey);
    });
  }
});

test("invalid, ambiguous or incomplete metadata never enables audit credentials or triggers migration", async (t) => {
  const formats = [
    () => "not JSON",
    () => JSON.stringify({ error: "Query failed" }),
    () => JSON.stringify({ rows: [] }),
    (rows) => JSON.stringify({ rows: [...rows, ...rows] }),
    (rows) => JSON.stringify({ rows: [{ ...rows[0], table_exists: null }] }),
    (rows) => JSON.stringify({ rows: [{ ...rows[0], student_access: 0 }] }),
    (rows) => JSON.stringify({ rows: [{ ...rows[0], student_access: "unknown" }] }),
  ];
  for (const encodeRows of formats) {
    const setup = await fixture(t, { encodeRows });
    await assert.rejects(prepareLocalAudit(setup), /metadata|result format/);
    assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(setup.didMigrate(), false);
  }
});

test("text booleans still reject unsafe permissions and an already recorded missing table", async (t) => {
  const encodeRows = (rows) => JSON.stringify({ rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]))) });
  const unsafe = await fixture(t, { encodeRows, state: { student_access: true } });
  await assert.rejects(prepareLocalAudit(unsafe), /privacy permissions need repair/);
  const missing = await fixture(t, { encodeRows, state: { table_exists: false, rls_enabled: false }, migrationApplied: true });
  await assert.rejects(prepareLocalAudit(missing), /marked applied but its table is missing/);
  assert.equal(unsafe.didMigrate() || missing.didMigrate(), false);
});

test("optional setup keeps verified support history enabled", async (t) => {
  const setup = await fixture(t);
  assert.deepEqual(await prepareOptionalLocalAudit(setup), { available: true, managedCredential: true, migrated: false });
  assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, serviceKey);
  assert.equal(setup.env.SUPPORT_REVIEW_QUEUE_ENABLED, "false");
});

test("optional schema failures allow startup but disable persistence and queue only in the child environment", async (t) => {
  const savedConfig = { SUPABASE_SERVICE_ROLE_KEY: "configured-server-key", SUPPORT_REVIEW_QUEUE_ENABLED: "true" };
  const setup = await fixture(t, { env: { ...savedConfig }, encodeRows: () => JSON.stringify({ rows: [] }) });
  const result = await prepareOptionalLocalAudit(setup);
  assert.deepEqual(result, { available: false });
  assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, "", "An empty override prevents Next from reloading an unverified .env credential");
  assert.equal(setup.env.SUPPORT_REVIEW_QUEUE_ENABLED, "false");
  assert.equal(savedConfig.SUPABASE_SERVICE_ROLE_KEY, "configured-server-key");
  assert.equal(savedConfig.SUPPORT_REVIEW_QUEUE_ENABLED, "true");
  assert.equal(setup.didMigrate(), false);
  assert.match(setup.logs.join(" "), /Continuing with chat and the classifier/);
  assert.match(setup.logs.join(" "), /unsupported result format/);
  assert.doesNotMatch(setup.logs.join(" "), /configured-server-key|memory-only-local-service-key/);
});

test("optional CLI, API and privacy failures remain nonfatal and never print raw errors or credentials", async (t) => {
  for (const options of [{ failCli: true }, { unauthorized: true }, { state: { student_access: true } }, { state: { rls_enabled: false } }]) {
    const setup = await fixture(t, options);
    assert.deepEqual(await prepareOptionalLocalAudit(setup), { available: false });
    assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, "");
    assert.equal(setup.env.SUPPORT_REVIEW_QUEUE_ENABLED, "false");
    assert.equal(setup.didMigrate(), false);
    assert.doesNotMatch(setup.logs.join(" "), /Unsafe CLI failure|memory-only-local-service-key/);
  }
  const unexpected = await fixture(t);
  unexpected.fetchImpl = () => { throw new Error(`Unexpected failure ${serviceKey}`); };
  assert.deepEqual(await prepareOptionalLocalAudit(unexpected), { available: false });
  assert.doesNotMatch(unexpected.logs.join(" "), /Unexpected failure|memory-only-local-service-key/);
});

test("cancelling optional setup still aborts startup instead of launching an app", async (t) => {
  for (const abortBeforeStart of [true, false]) {
    const setup = await fixture(t);
    const controller = new AbortController();
    setup.signal = controller.signal;
    if (abortBeforeStart) controller.abort();
    else setup.executeFile = async () => { controller.abort(); throw new Error(`Unsafe cancelled CLI output ${serviceKey}`); };
    await assert.rejects(prepareOptionalLocalAudit(setup), { name: "AbortError" });
    assert.equal(setup.logs.length, 0);
    assert.equal(setup.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  }
});
