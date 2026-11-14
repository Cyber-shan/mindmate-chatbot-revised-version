import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "../app/api/admin/reviews/route.ts";
import { filterQueue, waitingTime } from "../lib/admin/queue.ts";
import { parseReviewUpdate, loadReviewHistory } from "../lib/admin/reviews.ts";

const id = (n) => `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const staffId = id(1), eventId = id(2), studentId = id(3);
function setup(t, options = {}) {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test", SUPABASE_SERVICE_ROLE_KEY: "server-test" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input); calls.push(url.pathname);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: staffId, email: "staff@example.com", app_metadata: options.student ? {} : { mindmate_role: "admin" }, user_metadata: { mindmate_role: "admin" } });
    assert.equal(new Headers(init.headers).get("apikey"), "server-test");
    if (url.pathname === "/auth/v1/admin/users") return Response.json({ users: [{ id: staffId, email: "staff@example.com", app_metadata: { mindmate_role: "admin" } }, { id: studentId, email: "student@example.com", app_metadata: {}, user_metadata: { mindmate_role: "admin" } }] });
    if (url.pathname === "/rest/v1/rpc/update_support_review") {
      const body = JSON.parse(init.body);
      assert.equal(body.p_actor_id, staffId, "The session determines audit attribution");
      assert.equal(body.p_event_id, eventId);
      return options.conflict ? Response.json({ code: "PT409", message: "private SQL detail" }, { status: 409 }) : Response.json({ version: 1, status: body.p_status });
    }
    assert.fail(`Unexpected private lookup ${url.pathname}`);
  });
  return calls;
}
const request = (body, token = "Bearer staff-session") => new Request("http://localhost/api/admin/reviews", { method: "POST", headers: token ? { authorization: token, "Content-Type": "application/json" } : {}, body: JSON.stringify(body) });
const update = { event_id: eventId, expected_version: 0, status: "assigned", assignee_id: staffId, note: "Checked the case" };

test("review writes and history reads deny unauthenticated users before any storage request", async (t) => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Unauthenticated requests must never access storage"));
  assert.equal((await POST(request(update, null))).status, 401);
  assert.equal((await GET(new Request(`http://localhost/api/admin/reviews?event_id=${eventId}`))).status, 401);
});
test("student-editable roles cannot authorize staff review", async (t) => {
  const calls = setup(t, { student: true });
  assert.equal((await POST(request(update))).status, 403);
  assert.deepEqual(calls, ["/auth/v1/user"]);
});
test("review saves attribute the actor to the verified session and use private response headers", async (t) => {
  setup(t);
  const response = await POST(request(update));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Vary"), "Authorization");
  assert.equal((await response.json()).version, 1);
});
test("spoofed actors and student assignees are rejected before the mutation", async (t) => {
  const calls = setup(t);
  assert.equal((await POST(request({ ...update, actor_id: studentId }))).status, 400);
  assert.equal((await POST(request({ ...update, assignee_id: studentId }))).status, 400);
  assert.ok(!calls.includes("/rest/v1/rpc/update_support_review"));
});
test("concurrent review conflicts return 409 without exposing database details", async (t) => {
  setup(t, { conflict: true });
  const response = await POST(request(update));
  assert.equal(response.status, 409);
  const text = JSON.stringify(await response.json());
  assert.match(text, /Your note is still here/);
  assert.doesNotMatch(text, /private SQL detail/);
});
test("review validation rejects malformed versions, statuses, assignments and oversized notes", () => {
  for (const overrides of [{ expected_version: -1 }, { expected_version: 0.5 }, { status: "__proto__" }, { event_id: "bad" }, { note: "x".repeat(4001) }, { assignee_id: null }]) assert.throws(() => parseReviewUpdate({ ...update, ...overrides }));
  assert.equal(parseReviewUpdate({ ...update, note: "  plain text  " }).note, "plain text");
});
test("audit history pagination keeps all versions and rejects repeated pages", async () => {
  let reads = 0;
  const client = { from: () => {
    const query = { select: () => query, eq: () => query, gt: (_field, version) => { query.version = version; return query; }, order: () => query, limit: () => query,
      retry: async () => { reads++; return { data: query.version < 3 ? [{ id: id(query.version + 10), event_id: eventId, version: query.version + 1, from_status: "needs_review", to_status: "assigned" }] : [] }; } };
    return query;
  } };
  assert.equal((await loadReviewHistory(client, eventId, new AbortController().signal)).length, 3);
  assert.equal(reads, 4);
  const repeated = { from: () => {
    const query = { select: () => query, eq: () => query, gt: () => query, order: () => query, limit: () => query, retry: async () => ({ data: [{ event_id: eventId, version: 1, from_status: "needs_review", to_status: "assigned" }] }) };
    return query;
  } };
  await assert.rejects(loadReviewHistory(repeated, eventId, new AbortController().signal), /could not be verified/);
});
test("combined queue filters match the same detection without lowering account priority", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const base = { name: "Student", email: "student@example.com", priority: "IMMEDIATE_SAFETY", priority_since: "2026-11-01T00:00:00Z", latest_detection_at: "2026-11-14T11:00:00Z", review_items: [{ status: "needs_review", assignee_id: null, created_at: "2026-11-01T00:00:00Z" }, { status: "assigned", assignee_id: staffId, created_at: "2026-11-14T11:00:00Z" }] };
  const filters = { search: "STUDENT@", view: "unresolved", priority: "all", status: "assigned", assignee: staffId, hours: 24, sort: "priority" };
  const account = { ...base, student_id: studentId };
  assert.equal(filterQueue([account], filters, now)[0].priority, "IMMEDIATE_SAFETY");
  assert.equal(filterQueue([account], { ...filters, status: "needs_review" }, now).length, 0);
  const olderHigh = { ...base, student_id: id(4), priority: "HIGH_CONCERN", priority_since: "2026-10-01T00:00:00Z" };
  assert.equal(filterQueue([account, olderHigh], { ...filters, sort: "waiting" }, now)[0].student_id, id(4));
  assert.equal(filterQueue([account, olderHigh], filters, now)[0].student_id, studentId);
  assert.equal(waitingTime("2026-11-14T09:45:00Z", now), "2h 15m");
});
