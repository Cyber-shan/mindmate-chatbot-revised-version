import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/admin/detections/route.ts";
import { groupDetectedAccounts } from "../lib/admin/detections.ts";
import { accountSummaryCsv, studentReportCsv } from "../lib/admin/report-export.ts";

const id = (number) => `${number.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const staffId = id(9000), studentA = id(8001), studentB = id(8002), studentC = id(8003), studentD = id(8004);
const serverKey = "private-server-key-must-not-leak";

function env(t, changes = {}) {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test", SUPABASE_SERVICE_ROLE_KEY: serverKey, SUPPORT_REVIEW_QUEUE_ENABLED: "false", MINDMATE_ADMIN_EMAILS: undefined, ...changes })) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

function request(params = "", authorization = "Bearer signed-staff-session") {
  return new Request(`http://localhost/api/admin/detections${params}`, { headers: authorization === null ? {} : { Authorization: authorization } });
}

function event(number, overrides = {}) {
  return { id: id(number), conversation_id: id(10000 + number), message_id: id(20000 + number), level: "LOW", review_status: "not_required", created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString(), conversations: { user_id: studentA }, ...overrides };
}

function backend(t, options = {}) {
  const calls = [];
  const rows = options.rows ?? [event(1)];
  const user = { id: staffId, email: "staff@mindmate.local", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { mindmate_role: "admin" }, user_metadata: {}, ...options.user };
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });
    if (url.pathname === "/auth/v1/user") {
      assert.equal(headers.get("authorization"), "Bearer signed-staff-session");
      return options.authResponse?.() ?? Response.json(user);
    }
    assert.equal(headers.get("authorization"), `Bearer ${serverKey}`, "Only a server credential can read staff records");
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      if (options.identityFailure) return Response.json({ msg: "Unavailable" }, { status: 503 });
      const accountId = url.pathname.split("/").at(-1);
      return Response.json({ user: { id: accountId, email: `${accountId.slice(0, 8)}@student.local`, user_metadata: { name: `Student ${accountId.slice(0, 8)}`, private_profile: "not-for-report" }, app_metadata: { private_server_value: serverKey } } });
    }
    if (url.pathname === "/rest/v1/support_events") {
      if (url.searchParams.get("select") === "id,decision") return Response.json(options.decisions ?? rows.map((row) => ({ id: row.id, decision: { level: row.level, source: "safety_override", subject: "student", model_mode: "prototype", hidden: serverKey } })));
      assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
      assert.ok(url.searchParams.get("created_at")?.startsWith("lte."));
      if (options.supportResponse) return options.supportResponse(url);
      let result = rows;
      const target = url.searchParams.get("conversations.user_id");
      if (target) result = result.filter((row) => row.conversations.user_id === target.slice(3));
      result = [...result].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      const cursor = url.searchParams.get("or");
      if (cursor) {
        const time = /created_at\.lt\.([^,]+)/.exec(cursor)?.[1];
        const cursorId = /id\.lt\.([0-9a-f-]+)/.exec(cursor)?.[1];
        assert.ok(time && cursorId, "Subsequent reads must use a timestamp-and-ID keyset");
        result = result.filter((row) => row.created_at < time || (row.created_at === time && row.id < cursorId));
      }
      return Response.json(result.slice(0, options.pageSize ?? Number(url.searchParams.get("limit"))));
    }
    if (url.pathname === "/rest/v1/messages") return Response.json(options.messages ?? rows.map((row) => ({ id: row.message_id, conversation_id: row.conversation_id, role: "user", content: "Synthetic saved message" })));
    assert.fail(`Unexpected request: ${url.pathname}`);
  });
  return calls;
}

test("private reports reject missing or malformed bearer sessions without contacting storage", async (t) => {
  env(t);
  t.mock.method(globalThis, "fetch", () => assert.fail("No request is allowed"));
  for (const token of [null, "Bearer ", "Basic secret", "Bearer token extra"]) {
    const response = await GET(request("", token));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Authorization");
  }
});

test("student-editable names, emails and role metadata cannot grant administrator access", async (t) => {
  env(t, { MINDMATE_ADMIN_EMAILS: "administrator@mindmate.local" });
  const calls = backend(t, { user: { email: "student@student.local", app_metadata: {}, user_metadata: { role: "admin", mindmate_role: "admin", email: "administrator@mindmate.local" } } });
  assert.equal((await GET(request())).status, 403);
  assert.equal(calls.length, 1, "Unauthorized students cannot query private events or account profiles");
});

test("server-managed staff roles and verified server email allowlists authorize access", async (t) => {
  env(t, { MINDMATE_ADMIN_EMAILS: " STAFF@mindmate.local, another@mindmate.local " });
  for (const app_metadata of [{ mindmate_role: "admin" }, { mindmate_role: "counselor" }, {}]) {
    backend(t, { user: { app_metadata } });
    assert.equal((await GET(request("?access=check"))).status, 200);
  }
  backend(t, { user: { email_confirmed_at: null, app_metadata: {} } });
  assert.equal((await GET(request("?access=check"))).status, 403);
});

test("expired sessions and failed authentication never reach service-role lookups", async (t) => {
  env(t);
  const calls = backend(t, { authResponse: () => Response.json({ msg: "Invalid JWT" }, { status: 401 }) });
  assert.equal((await GET(request())).status, 401);
  assert.equal(calls.length, 1);
});

test("staff sign-in checks work without private storage while reports return an honest setup error", async (t) => {
  env(t, { SUPABASE_SERVICE_ROLE_KEY: "" });
  const calls = backend(t);
  assert.equal((await GET(request("?access=check"))).status, 200);
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Private detection storage is unavailable/);
  assert.ok(calls.every((call) => call.url.pathname === "/auth/v1/user"));
});

test("accounts retain their highest unresolved priority across conversations and sort by priority then waiting time", async (t) => {
  env(t);
  const rows = [
    event(1, { level: "IMMEDIATE_SAFETY", review_status: "unconfigured" }), event(10),
    event(4, { conversations: { user_id: studentB }, level: "HIGH_CONCERN", review_status: "reviewed" }),
    event(2, { conversations: { user_id: studentC }, level: "MODERATE" }),
    event(11, { conversations: { user_id: studentD } }),
    event(3, { conversations: { user_id: studentB }, level: "IMMEDIATE_SAFETY", review_status: "resolved" }),
  ];
  backend(t, { rows });
  const response = await GET(request());
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.deepEqual(report.students.map((student) => student.priority), ["IMMEDIATE_SAFETY", "HIGH_CONCERN", "MODERATE", "LOW"]);
  assert.deepEqual(report.accounts_by_priority, { IMMEDIATE_SAFETY: 1, HIGH_CONCERN: 1, MODERATE: 1, LOW: 1 });
  assert.equal(report.students[0].unresolved_detections, 2);
  assert.equal(report.students[0].conversation_count, 2);
  assert.equal(report.students[0].priority_since, rows[0].created_at);
  assert.equal(report.review_queue_enabled, false, "Showing detections must not activate notifications or review requests");
  assert.doesNotMatch(JSON.stringify(report), /private-server-key|private_profile|app_metadata|user_metadata|Synthetic saved message|decision/);
});

test("resolved and false-positive detections leave the unresolved queue; merely reviewed concerns remain open", () => {
  const events = [
    { ...event(1), student_id: studentA, level: "IMMEDIATE_SAFETY", review_status: "resolved" },
    { ...event(2), student_id: studentA, level: "HIGH_CONCERN", review_status: "false_positive" },
    { ...event(3), student_id: studentB, level: "HIGH_CONCERN", review_status: "reviewed" },
    { ...event(4), student_id: studentC, level: "HIGH_CONCERN", review_status: "unconfigured" },
  ];
  const accounts = groupDetectedAccounts(events);
  assert.deepEqual(accounts.map((account) => account.student_id), [studentB, studentC, studentA]);
  assert.equal(accounts[2].priority, null);
  assert.equal(accounts[2].unresolved_detections, 0);
  assert.equal(accounts[2].total_detections, 2);
});

test("older urgent records beyond the first API page are included in priorities and totals", async (t) => {
  env(t);
  const rows = Array.from({ length: 1002 }, (_, index) => event(index + 1));
  rows[0].level = "IMMEDIATE_SAFETY"; rows[0].review_status = "unconfigured";
  const calls = backend(t, { rows });
  const response = await GET(request());
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.total_detections, 1002);
  assert.equal(report.students[0].priority, "IMMEDIATE_SAFETY");
  assert.equal(calls.filter((call) => call.url.pathname === "/rest/v1/support_events").length, 3);
});

test("pagination continues when the backend row cap is lower than the requested page size", async (t) => {
  env(t);
  const rows = [event(1, { level: "IMMEDIATE_SAFETY" }), event(2), event(3)];
  backend(t, { rows, pageSize: 1 });
  const report = await (await GET(request())).json();
  assert.equal(report.total_detections, 3);
  assert.equal(report.students[0].priority, "IMMEDIATE_SAFETY");
});

test("keyset pagination preserves PostgreSQL microseconds instead of collapsing to milliseconds", async (t) => {
  env(t);
  backend(t, { pageSize: 1, rows: [event(1, { created_at: "2026-01-01T00:00:00.123456Z" }), event(2, { created_at: "2026-01-01T00:00:00.123123Z", level: "IMMEDIATE_SAFETY" })] });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total_detections, 2);
});

test("malformed metadata or repeated pages fail explicitly rather than returning a partial priority list", async (t) => {
  env(t);
  for (const row of [event(1, { level: "UNKNOWN" }), event(2, { created_at: "2026-01-01T00:00:00Z,or(secret)" }), event(3, { conversations: { user_id: "foreign" } })]) {
    backend(t, { supportResponse: () => Response.json([row]) });
    const response = await GET(request());
    assert.equal(response.status, 503);
  }
  backend(t, { supportResponse: () => Response.json([event(1)]) });
  assert.equal((await GET(request())).status, 503);
});

test("profile service failures retain priority records and account IDs instead of dropping students", async (t) => {
  env(t);
  backend(t, { identityFailure: true, rows: [event(1, { level: "IMMEDIATE_SAFETY" })] });
  const response = await GET(request());
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.identity_unavailable, 1);
  assert.equal(report.students[0].student_id, studentA);
  assert.equal(report.students[0].priority, "IMMEDIATE_SAFETY");
  assert.equal(report.students[0].identity_available, false);
});

test("an empty database returns an empty real report rather than synthetic students", async (t) => {
  env(t);
  const calls = backend(t, { rows: [] });
  const report = await (await GET(request())).json();
  assert.deepEqual(report.students, []);
  assert.equal(report.total_detections, 0);
  assert.equal(calls.length, 2);
});

test("student reports use only that account's saved evidence and return restricted decision fields", async (t) => {
  env(t);
  const rows = [event(1, { level: "IMMEDIATE_SAFETY", review_status: "unconfigured" }), event(2, { conversations: { user_id: studentB } })];
  const calls = backend(t, { rows, messages: [
    { id: rows[0].message_id, conversation_id: rows[0].conversation_id, role: "user", content: "Synthetic evidence for this account" },
    { id: rows[0].message_id, conversation_id: rows[1].conversation_id, role: "user", content: "Foreign content must never appear" },
  ] });
  const response = await GET(request(`?student_id=${studentA}`));
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.student.student_id, studentA);
  assert.equal(report.events.length, 1);
  assert.equal(report.events[0].message, "Synthetic evidence for this account");
  assert.equal(report.events[0].review_status, "unconfigured");
  assert.doesNotMatch(JSON.stringify(report), /private-server-key|Foreign content|private_profile|app_metadata|hidden/);
  assert.ok(calls.find((call) => call.url.pathname === "/rest/v1/support_events").url.searchParams.has("conversations.user_id"));
});

test("account report limits apply after priority sorting while totals include all detections", async (t) => {
  env(t);
  const rows = Array.from({ length: 102 }, (_, index) => event(index + 1));
  rows[0].level = "IMMEDIATE_SAFETY";
  backend(t, { rows });
  const report = await (await GET(request(`?student_id=${studentA}`))).json();
  assert.equal(report.total_events, 102);
  assert.equal(report.events.length, 100);
  assert.equal(report.events[0].level, "IMMEDIATE_SAFETY");
  assert.equal(report.student.total_detections, 102);
});

test("invalid and missing account report targets do not expose unrelated students", async (t) => {
  env(t);
  const calls = backend(t);
  assert.equal((await GET(request("?student_id=not-a-uuid"))).status, 400);
  assert.equal(calls.length, 1);
  assert.equal((await GET(request(`?student_id=${studentB}`))).status, 404);
});

test("CSV reports preserve text and neutralize spreadsheet formula injection in identities and evidence", () => {
  const [student] = groupDetectedAccounts([{ ...event(1), student_id: studentA }], new Map([[studentA, { name: '=HYPERLINK("secret")', email: "+formula@example.local", available: true }]]));
  const summary = accountSummaryCsv([student], "2026-01-01T00:00:00Z");
  assert.ok(summary.startsWith("\uFEFF"));
  assert.ok(summary.includes('"\'=HYPERLINK(""secret"")"'));
  assert.ok(summary.includes('"\'+formula@example.local"'));
  const report = studentReportCsv({ generated_at: "2026-01-01T00:00:00Z", student, events: [{ ...event(1), message: "  @SUM(1,2)\nquoted \"text\"", subject: "student", source: "rules_only" }] });
  assert.ok(report.includes('"\'  @SUM(1,2)\nquoted ""text"""'));
});
