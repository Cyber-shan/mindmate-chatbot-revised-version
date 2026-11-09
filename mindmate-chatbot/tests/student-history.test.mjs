import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStudentSupport, restoreStudentMessages } from "../lib/support/student-history.ts";

const support = { safety_response_required: true, review_status: "unavailable", resources: [{ label: "Support information", href: "https://example.org/support" }] };
const stored = [
  { id: "user-one", role: "user", content: "An example concern" },
  { id: "reply-one", role: "assistant", content: "A safety response" },
  { id: "user-two", role: "user", content: "I am safe now" },
  { id: "reply-two", role: "assistant", content: "A supportive reply" },
];

test("restored support stays with the matching student turn and its reply", () => {
  const messages = restoreStudentMessages(stored, { available: true, messages: [{ message_id: "user-one", support }] });
  assert.deepEqual(messages[0].support, support);
  assert.deepEqual(messages[1].support, support);
  assert.equal(messages[2].support, undefined);
  assert.equal(messages[3].support, undefined);
  assert.equal(messages[1].role, "ai");
  assert.equal(stored[0].support, undefined, "Stored history must not be mutated");
});

test("support from another conversation or an unavailable audit cannot attach to history", () => {
  for (const payload of [null, { available: false, messages: [{ message_id: "user-one", support }] }, { available: true, messages: [{ message_id: "another-conversation", support }] }]) {
    assert.ok(restoreStudentMessages(stored, payload).every((message) => message.support === undefined));
  }
});

test("consecutive student messages do not attach an earlier notice to a later reply", () => {
  const messages = restoreStudentMessages([stored[0], stored[2], stored[3]], { available: true, messages: [{ message_id: "user-one", support }] });
  assert.deepEqual(messages[0].support, support);
  assert.equal(messages[2].support, undefined);
});

test("an assistant continuation does not receive duplicate support metadata", () => {
  const messages = restoreStudentMessages([stored[0], stored[1], { id: "continued", role: "assistant", content: "Continued response" }], { available: true, messages: [{ message_id: "user-one", support }] });
  assert.deepEqual(messages[1].support, support);
  assert.equal(messages[2].support, undefined);
});

test("conflicting duplicate records cannot invent a confirmed review request", () => {
  const messages = restoreStudentMessages(stored, { available: true, messages: [
    { message_id: "user-one", support }, { message_id: "user-one", support: { ...support, review_status: "queued" } },
  ] });
  assert.ok(messages.every((message) => message.support === undefined));
});

test("the student contract removes model labels, scores, versions, and private state", () => {
  assert.deepEqual(parseStudentSupport({ ...support, level: "HIGH_CONCERN", model: { LOW: 0.1 }, model_version: "private", state: { prior_high_concern: true } }), support);
});

test("invalid metadata and executable resource URLs cannot reach the student UI", () => {
  for (const value of [undefined, {}, { ...support, review_status: "pending" }, { ...support, review_status: ["queued"] }, { ...support, safety_response_required: "true" },
    { ...support, resources: [{ label: "Unsafe", href: "javascript:alert(1)" }] },
    { ...support, resources: [{ label: "Unsafe", href: "https://name:secret@example.org" }] },
    { ...support, resources: [{ label: "", href: "https://example.org" }] },
  ]) assert.equal(parseStudentSupport(value), null);
});
