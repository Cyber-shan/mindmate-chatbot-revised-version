import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as overview } from "../app/api/admin/algorithm/overview/route.ts";
import { GET as status } from "../app/api/admin/algorithm/status/route.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
function configure(t, changes = {}) {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
    MINDMATE_OWNER_USER_ID: ownerId, MINDMATE_ADMIN_EMAILS: undefined,
    DISTRESS_CLASSIFIER_URL: undefined, ...changes,
  };
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
const request = (authorization = "Bearer verified-session") => new Request("http://localhost/api/admin/algorithm/overview", {
  headers: authorization === null ? {} : { Authorization: authorization },
});
function auth(t, user, failureStatus) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.equal(url.pathname, "/auth/v1/user", "Unauthorized requests must never contact the classifier");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer verified-session");
    return failureStatus ? Response.json({ msg: "Invalid session" }, { status: failureStatus }) : Response.json(user);
  });
  return calls;
}

test("private reports reject missing and malformed sessions before contacting any service", async (t) => {
  configure(t, { DISTRESS_CLASSIFIER_URL: "http://127.0.0.1:8001" });
  t.mock.method(globalThis, "fetch", () => assert.fail("No service access before authentication"));
  for (const token of [null, "Bearer ", "Basic secret", "Bearer extra token"]) {
    const response = await overview(request(token));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Authorization");
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["error"]);
  }
});

test("ordinary administrators, counselors and email-allowlisted staff cannot read owner reports", async (t) => {
  configure(t, { MINDMATE_ADMIN_EMAILS: "staff@mindmate.local", DISTRESS_CLASSIFIER_URL: "http://127.0.0.1:8001" });
  for (const role of ["admin", "counselor", undefined]) {
    const calls = auth(t, { id: otherId, email: "staff@mindmate.local", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { mindmate_role: role }, user_metadata: { owner: true, id: ownerId } });
    assert.equal((await overview(request())).status, 403);
    assert.deepEqual(calls, ["/auth/v1/user"]);
  }
});

test("student-editable metadata cannot grant owner or staff access", async (t) => {
  configure(t, { DISTRESS_CLASSIFIER_URL: "http://127.0.0.1:8001" });
  const calls = auth(t, { id: ownerId, email: "student@mindmate.local", app_metadata: {}, user_metadata: { mindmate_role: "admin", role: "owner" } });
  assert.equal((await overview(request())).status, 403);
  assert.deepEqual(calls, ["/auth/v1/user"]);
});

test("expired and anonymous sessions never authorize private reports", async (t) => {
  configure(t, { DISTRESS_CLASSIFIER_URL: "http://127.0.0.1:8001" });
  auth(t, null, 401);
  assert.equal((await overview(request())).status, 401);
  auth(t, { id: ownerId, is_anonymous: true, app_metadata: { mindmate_role: "admin" } });
  assert.equal((await overview(request())).status, 401);
});

test("missing and invalid owner configuration deny access even to an administrator", async (t) => {
  configure(t);
  auth(t, { id: ownerId, app_metadata: { mindmate_role: "admin" } });
  for (const owner of [undefined, "", "not-a-uuid"]) {
    if (owner === undefined) delete process.env.MINDMATE_OWNER_USER_ID; else process.env.MINDMATE_OWNER_USER_ID = owner;
    const response = await overview(request());
    assert.equal(response.status, 503);
    assert.deepEqual(Object.keys(await response.json()), ["error"]);
  }
});

test("regular service status remains available without exposing saved evaluations", async (t) => {
  configure(t, { MINDMATE_ALGORITHM_REPORT_DIR: "not-readable-from-public-status" });
  t.mock.method(globalThis, "fetch", () => assert.fail("Rules-only status needs no external services"));
  const response = await status(new Request("http://localhost/api/admin/algorithm/status"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.runtime.status, "rules_only");
  assert.equal(result.evaluation, null);
  assert.equal(result.context, null);
});
