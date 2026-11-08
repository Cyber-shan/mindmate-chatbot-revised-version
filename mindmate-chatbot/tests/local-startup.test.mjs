import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFingerprint, hiddenWindowsLaunchArgs, prepareLocalServices, requireLocalHttpUrl, safeStartupOutput, startSupabaseWithRetry, waitUntil } from "../scripts/local-startup.mjs";

test("the local launcher accepts loopback services and rejects external or credential-bearing URLs", () => {
  for (const url of ["http://127.0.0.1:55121", "http://localhost:11434", "http://[::1]:11434"]) assert.ok(requireLocalHttpUrl(url, "Service"));
  for (const url of [undefined, "invalid", "https://example.com", "http://example.com", "http://user:password@localhost:11434"]) {
    assert.throws(() => requireLocalHttpUrl(url, "Service"));
  }
});

test("healthy services are reused and the model is prepared once", async () => {
  let preparations = 0;
  const unexpected = () => { throw new Error("A healthy service must not be started again"); };
  await prepareLocalServices({
    supabaseReady: async () => true, ollamaReady: async () => true,
    ensureDocker: unexpected, startSupabase: unexpected, startOllama: unexpected,
    warmup: async () => { preparations += 1; },
  });
  assert.equal(preparations, 1);
});

test("stopped services start in dependency order and warm-up waits for both", async () => {
  let docker = false;
  let database = false;
  let modelServer = false;
  let warmed = false;
  await prepareLocalServices({
    supabaseReady: async () => database, ollamaReady: async () => modelServer,
    ensureDocker: async () => { docker = true; },
    startSupabase: async () => { assert.equal(docker, true); database = true; },
    startOllama: async () => { modelServer = true; },
    warmup: async () => { assert.equal(database && modelServer, true); warmed = true; },
  });
  assert.equal(warmed, true);
});

test("a failed required service prevents warm-up instead of pretending startup succeeded", async () => {
  let warmed = false;
  await assert.rejects(prepareLocalServices({
    supabaseReady: async () => false, ollamaReady: async () => true,
    ensureDocker: async () => {}, startSupabase: async () => { throw new Error("Database failed"); },
    startOllama: async () => {}, warmup: async () => { warmed = true; },
  }), /Database failed/);
  assert.equal(warmed, false);
});

const startingDatabaseError = () => new Error('node.exe stopped (1).\n{"_tag":"Error","error":{"code":"LegacyStatusDbNotReadyError","message":"supabase_db_mindmate-chatbot container is not ready: starting"}}');

test("the launcher reaches model warm-up after a transient database startup failure", async () => {
  let database = false;
  let attempts = 0;
  let warmed = false;
  await prepareLocalServices({
    supabaseReady: async () => database, ollamaReady: async () => true,
    ensureDocker: async () => {},
    startSupabase: async () => {
      attempts += 1;
      if (attempts === 1) throw startingDatabaseError();
      database = true;
    },
    startOllama: async () => assert.fail("The running Ollama service must be reused"),
    warmup: async () => { assert.equal(database, true); warmed = true; },
  });
  assert.equal(attempts, 2);
  assert.equal(warmed, true);
});

test("a booting Supabase database is retried until startup succeeds in the same launch", async () => {
  let time = 0;
  let attempts = 0;
  const messages = [];
  await startSupabaseWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw startingDatabaseError();
  }, {
    log: (message) => messages.push(message),
    now: () => time, pause: async (ms) => { time += ms; },
  });
  assert.equal(attempts, 3);
  assert.equal(time, 4000);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /retrying automatically/);
});

test("Supabase restored by Docker is reused if it becomes healthy between attempts", async () => {
  let time = 0;
  let attempts = 0;
  await startSupabaseWithRetry(async () => {
    attempts += 1;
    throw startingDatabaseError();
  }, {
    ready: async () => time >= 2000,
    now: () => time, pause: async (ms) => { time += ms; },
  });
  assert.equal(attempts, 1);
  assert.equal(time, 2000);
});

test("unhealthy databases and other Supabase failures are reported without retries", async () => {
  for (const message of [
    "supabase_db_mindmate-chatbot container is not ready: unhealthy",
    "HTTP error: port 55121 is occupied",
    "Startup timed out while running node.exe.",
  ]) {
    const error = new Error(message);
    let attempts = 0;
    await assert.rejects(startSupabaseWithRetry(async () => {
      attempts += 1;
      throw error;
    }, { pause: async () => assert.fail("Fatal errors must not wait for a retry") }), (actual) => actual === error);
    assert.equal(attempts, 1);
  }
});

test("Supabase startup retries stop at the deadline and honor cancellation", async () => {
  let time = 0;
  let attempts = 0;
  const start = async () => { attempts += 1; throw startingDatabaseError(); };
  await assert.rejects(startSupabaseWithRetry(start, {
    timeoutMs: 6000,
    now: () => time, pause: async (ms) => { time += ms; },
  }), /Supabase database did not become ready/);
  assert.equal(attempts, 3);
  assert.equal(time, 6000);

  const controller = new AbortController();
  attempts = 0;
  await assert.rejects(startSupabaseWithRetry(start, {
    signal: controller.signal,
    pause: async () => { controller.abort(new Error("Cancelled")); },
  }), /Cancelled/);
  assert.equal(attempts, 1);
});

test("readiness polling has a bounded timeout and honors cancellation", async () => {
  let time = 0;
  await assert.rejects(waitUntil(async () => false, {
    description: "Docker", timeoutMs: 20, intervalMs: 10,
    now: () => time, pause: async (ms) => { time += ms; },
  }), /Docker did not become ready/);
  const controller = new AbortController();
  controller.abort(new Error("Cancelled"));
  await assert.rejects(waitUntil(async () => true, { signal: controller.signal }), /Cancelled/);
});

test("startup errors redact service credentials and keep actionable errors", () => {
  const output = safeStartupOutput("Starting database\nPublishable key: sb_publishable_private\nService role key: eyJsecret.jwt.value\npostgresql://user:password@localhost/db\nHTTP error: port 55121 is occupied\n");
  assert.match(output, /port 55121 is occupied/);
  assert.doesNotMatch(output, /private|password|jwt.value/);
});

test("Windows desktop startup treats executable paths literally and launches hidden", () => {
  const args = hiddenWindowsLaunchArgs("C:\\Tools\\O'Brien $(whoami)\\Docker Desktop.exe");
  const command = Buffer.from(args.at(-1), "base64").toString("utf16le");
  assert.equal(command, "Start-Process -FilePath 'C:\\Tools\\O''Brien $(whoami)\\Docker Desktop.exe' -WindowStyle Hidden");
});

test("demo build fingerprint follows source/config changes and ignores generated files and timestamps", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mindmate-startup-"));
  t.after(async () => {
    const target = path.resolve(directory);
    const relative = path.relative(path.resolve(tmpdir()), target);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(target).startsWith("mindmate-startup-"));
    await rm(target, { recursive: true, force: true });
  });
  await mkdir(path.join(directory, "app"));
  const source = path.join(directory, "app", "page.tsx");
  await writeFile(source, "original source");
  const original = await buildFingerprint(directory);
  await utimes(source, new Date(), new Date());
  assert.equal(await buildFingerprint(directory), original);
  await mkdir(path.join(directory, ".next"));
  await writeFile(path.join(directory, ".next", "generated.txt"), "generated");
  assert.equal(await buildFingerprint(directory), original);
  await writeFile(source, "changed source");
  const changed = await buildFingerprint(directory);
  assert.notEqual(changed, original);
  await writeFile(path.join(directory, ".env.local"), "NEXT_PUBLIC_EXAMPLE=value");
  assert.notEqual(await buildFingerprint(directory), changed);
});
