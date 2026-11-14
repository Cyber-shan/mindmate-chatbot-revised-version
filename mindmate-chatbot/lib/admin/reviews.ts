import type { SupabaseClient, User } from "@supabase/supabase-js";
import { WORKFLOW_LABELS, type StaffMember, type ReviewHistory, type WorkflowStatus } from "./detection-types.ts";
import { StaffReportError, uuid } from "./staff.ts";

function isStaff(user: User) {
  const emails = (process.env.MINDMATE_ADMIN_EMAILS ?? "").split(/[,\n]/).map((email) => email.trim().toLowerCase());
  return !user.is_anonymous && (['admin', 'counselor'].includes(user.app_metadata?.mindmate_role)
    || Boolean(user.email_confirmed_at && user.email && emails.includes(user.email.toLowerCase())));
}

export async function listStaffMembers(client: SupabaseClient, signal: AbortSignal): Promise<StaffMember[]> {
  const members: StaffMember[] = [];
  for (let page = 1; page <= 100; page++) {
    signal.throwIfAborted();
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !Array.isArray(data.users)) throw new StaffReportError("Staff assignees could not be loaded. Please retry.", 503);
    for (const user of data.users) if (uuid.test(user.id) && user.email && isStaff(user)) {
      members.push({ id: user.id, email: user.email, name: typeof user.user_metadata?.name === "string" ? user.user_metadata.name.slice(0, 120) : user.email });
    }
    if (data.users.length < 100) return members.sort((a, b) => a.email.localeCompare(b.email));
  }
  throw new StaffReportError("The staff directory is too large to load completely.", 503);
}

export type ReviewUpdate = { event_id: string; expected_version: number; status: WorkflowStatus; assignee_id: string | null; note: string };
export function parseReviewUpdate(value: unknown): ReviewUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StaffReportError("Enter a valid review update.", 400);
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["event_id", "expected_version", "status", "assignee_id", "note"].includes(key))
    || typeof body.event_id !== "string" || !uuid.test(body.event_id)
    || !Number.isInteger(body.expected_version) || (body.expected_version as number) < 0 || (body.expected_version as number) > 2147483646
    || typeof body.status !== "string" || !Object.hasOwn(WORKFLOW_LABELS, body.status)
    || !(body.assignee_id === null || typeof body.assignee_id === "string" && uuid.test(body.assignee_id))
    || typeof body.note !== "string" || body.note.length > 4000) throw new StaffReportError("The review update is invalid. Notes can contain up to 4,000 characters.", 400);
  if (["assigned", "contact_attempted"].includes(body.status) && !body.assignee_id) throw new StaffReportError("Choose an assignee for this status.", 400);
  return { event_id: body.event_id, expected_version: body.expected_version as number, status: body.status as WorkflowStatus, assignee_id: body.assignee_id as string | null, note: body.note.trim() };
}

export async function saveReview(client: SupabaseClient, staffId: string, update: ReviewUpdate, signal: AbortSignal) {
  if (update.assignee_id) {
    const members = await listStaffMembers(client, signal);
    if (!members.some((member) => member.id === update.assignee_id)) throw new StaffReportError("Choose a current administrator or counselor as the assignee.", 400);
  }
  const { data, error } = await client.rpc("update_support_review", {
    p_event_id: update.event_id, p_expected_version: update.expected_version, p_status: update.status,
    p_assignee_id: update.assignee_id, p_note: update.note, p_actor_id: staffId,
  }).retry(false);
  if (error?.code === "PT409" || error?.code === "40001") throw new StaffReportError("Another reviewer updated this detection. Reload the review, check their changes, then save again. Your note is still here.", 409);
  if (error?.code === "P0002") throw new StaffReportError("This detection no longer exists.", 404);
  if (error?.code === "22023") throw new StaffReportError("Choose a valid status and assignee, or add a note before saving.", 400);
  if (error || !data) throw new StaffReportError("The review could not be saved. Check the staff workflow migration and try again.", 503);
  return data;
}

export async function loadReviewHistory(client: SupabaseClient, eventId: string, signal: AbortSignal): Promise<ReviewHistory[]> {
  const history: ReviewHistory[] = [];
  let version = 0;
  while (true) {
    signal.throwIfAborted();
    const { data, error } = await client.from("support_review_history")
      .select("id,event_id,version,actor_email,from_status,to_status,from_assignee_email,to_assignee_email,note,created_at")
      .eq("event_id", eventId).gt("version", version).order("version", { ascending: true }).limit(500).retry(false);
    if (error || !Array.isArray(data)) throw new StaffReportError("Review history could not be loaded. Check the staff workflow migration.", 503);
    if (!data.length) return history;
    for (const row of data) {
      if (row.event_id !== eventId || !Number.isInteger(row.version) || row.version <= version || !Object.hasOwn(WORKFLOW_LABELS, row.from_status) || !Object.hasOwn(WORKFLOW_LABELS, row.to_status)) throw new StaffReportError("Review history could not be verified.", 503);
      version = row.version;
      history.push(row as ReviewHistory);
    }
    if (history.length > 10000) throw new StaffReportError("This detection's audit history exceeds the report limit.", 503);
  }
}
