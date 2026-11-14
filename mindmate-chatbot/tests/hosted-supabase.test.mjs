import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostedSupabaseReadinessCheck, isLocalSupabaseUrl, requirePublicSupabaseKey, requireSupabaseUrl, verifyHostedSupabase } from "../scripts/supabase-startup.mjs";
import { prepareLocalServices } from "../scripts/local-startup.mjs";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
  SUPPORT_REVIEW_QUEUE_ENABLED: "false",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("Supabase accepts hosted HTTPS and existing loopback origins while rejecting unsafe configuration", () => {
  assert.equal(isLocalSupabaseUrl(requireSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)), false);
  for (const value of ["http://127.0.0.1:55121", "http://localhost:55121", "http://[::1]:55121"]) assert.equal(isLocalSupabaseUrl(requireSupabaseUrl(value)), true);
  for (const value of [undefined, "invalid", "http://test-project.supabase.co", "https://user:secret@test-project.supabase.co", "https://test-project.supabase.co/rest/v1", "https://test-project.supabase.co?key=secret", "https://test-project.supabase.co/#secret"]) assert.throws(() => requireSupabaseUrl(value));
  assert.equal(requirePublicSupabaseKey(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const legacyServer = `eyJheader.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  for (const value of [undefined, "", "sb_secret_private", legacyServer]) assert.throws(() => requirePublicSupabaseKey(value));
});

test("hosted startup reuses online Supabase and local Ollama without invoking Docker", async () => {
  let warmed = false;
  const unexpected = async () => assert.fail("Hosted startup must never start Docker or local Supabase");
  await prepareLocalServices({
    supabaseMode: "hosted", supabaseReady: async () => true, ollamaReady: async () => true,
    ensureDocker: unexpected, startSupabase: unexpected, startOllama: unexpected,
    warmup: async () => { warmed = true; },
  });
  assert.equal(warmed, true);
});

test("an unavailable hosted project fails without falling back to Docker or warming the model", async () => {
  const unexpected = async () => assert.fail("Hosted failure must not launch local services");
  await assert.rejects(prepareLocalServices({
    supabaseMode: "hosted", supabaseReady: async () => false, ollamaReady: async () => true,
    ensureDocker: unexpected, startSupabase: unexpected, startOllama: unexpected, warmup: unexpected,
  }), /Hosted Supabase is unavailable/);
});

test("hosted checks verify both credentials and every app table using read-only requests", async () => {
  const calls = [];
  const configured = { ...env };
  await verifyHostedSupabase({ env: configured, fetchImpl: async (input, init) => {
    const url = new URL(input);
    calls.push(url.pathname);
    assert.equal(init.method ?? "GET", "GET");
    assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    if (url.pathname === "/auth/v1/settings") {
      assert.equal(headers.get("apikey"), env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
      return json({ external: { email: true } });
    }
    assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
    if (url.pathname === "/auth/v1/admin/users") return json({ users: [] });
    assert.equal(url.searchParams.get("select"), "id");
    assert.equal(url.searchParams.get("limit"), "0");
    return json([]);
  } });
  assert.deepEqual(calls, ["/auth/v1/settings", "/auth/v1/admin/users", "/rest/v1/conversations", "/rest/v1/messages", "/rest/v1/support_events"]);
  assert.deepEqual(configured, env, "Hosted checks must not clear the server key or change the queue setting");
});

test("missing hosted server credentials fail before any request", async () => {
  await assert.rejects(verifyHostedSupabase({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: "" }, fetchImpl: async () => assert.fail("No request expected") }), /server-only secret/);
});

test("hosted startup reaches warm-up when the OpenAPI endpoint denies the public key", async () => {
  const calls = [];
  const ready = createHostedSupabaseReadinessCheck({ env, fetchImpl: async (input) => {
    const url = new URL(input);
    calls.push(url.pathname);
    if (url.pathname === "/rest/v1/") return json({ message: "OpenAPI requires authorization" }, 401);
    if (url.pathname === "/auth/v1/settings") return json({ external: { email: true } });
    if (url.pathname === "/auth/v1/admin/users") return json({ users: [] });
    assert.ok(["/rest/v1/conversations", "/rest/v1/messages", "/rest/v1/support_events"].includes(url.pathname));
    return json([]);
  } });
  // Startup checks the connection before classifier preparation, then coordinates
  // model services using the same successful verification.
  assert.equal(await ready(), true);
  let warmed = false;
  const unexpected = async () => assert.fail("Hosted startup must not start Docker or local Supabase");
  await prepareLocalServices({
    supabaseMode: "hosted", supabaseReady: ready, ollamaReady: async () => true,
    ensureDocker: unexpected, startSupabase: unexpected, startOllama: unexpected,
    warmup: async () => { warmed = true; },
  });
  assert.equal(warmed, true);
  assert.deepEqual(calls, ["/auth/v1/settings", "/auth/v1/admin/users", "/rest/v1/conversations", "/rest/v1/messages", "/rest/v1/support_events"]);
});

test("failed hosted verification prevents warm-up and never invokes Docker", async () => {
  const ready = createHostedSupabaseReadinessCheck({ env, fetchImpl: async () => json({ message: "Unavailable" }, 503) });
  const unexpected = async () => assert.fail("Unavailable hosted Supabase must not start local services or warm up");
  await assert.rejects(prepareLocalServices({
    supabaseMode: "hosted", supabaseReady: ready, ollamaReady: async () => true,
    ensureDocker: unexpected, startSupabase: unexpected, startOllama: unexpected, warmup: unexpected,
  }), /Auth service is unavailable/);
});

test("hosted setup failures are actionable and never expose SDK errors or account details", async () => {
  for (const failure of ["/auth/v1/settings", "/auth/v1/admin/users", "/rest/v1/support_events"]) {
    await assert.rejects(verifyHostedSupabase({ env, fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname === failure) return json({ message: "PRIVATE_ACCOUNT_DETAIL sb_secret_private", code: "42501" }, 403);
      return json(url.pathname === "/auth/v1/admin/users" ? { users: [] } : []);
    } }), (error) => {
      assert.doesNotMatch(error.message, /PRIVATE_ACCOUNT_DETAIL|sb_secret_private/);
      assert.match(error.message, /hosted Supabase|Hosted Supabase/);
      return true;
    });
  }
});
