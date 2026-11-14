import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupportLevel } from "../support/types.ts";
import { PRIORITY_ORDER, type DetectedAccount, type DetectionDashboard, type DetectionReportEntry, type PriorityCounts, type ReviewStatus, type StudentDetectionReport } from "./detection-types.ts";
import { StaffReportError, uuid } from "./staff.ts";

type Event = { id: string; student_id: string; conversation_id: string; message_id: string; level: SupportLevel; review_status: ReviewStatus; created_at: string };
type Identity = { name: string; email: string | null; available: boolean };
const statuses = new Set(["not_required", "unconfigured", "pending", "reviewed", "resolved", "false_positive"]);
const closed = new Set(["resolved", "false_positive"]);
const sources = new Set(["rules_only", "ml", "hybrid", "safety_override", "conversation_context", "uncertain_model"]);
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/;
const counts = (): PriorityCounts => ({ IMMEDIATE_SAFETY: 0, HIGH_CONCERN: 0, MODERATE: 0, LOW: 0 });
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const open = (event: Event) => !closed.has(event.review_status);
const rank = (level: SupportLevel | null) => level ? PRIORITY_ORDER.indexOf(level) : PRIORITY_ORDER.length;
// Keep PostgreSQL's microseconds: Date.parse alone collapses distinct cursor times.
const timeKey = (value: string) => new Date(value).toISOString().slice(0, 19) + "." + (timestamp.exec(value)?.[1] ?? "").padEnd(6, "0") + "Z";
const orderEvents = (a: Event, b: Event) => Number(!open(a)) - Number(!open(b)) || rank(a.level) - rank(b.level) || timeKey(a.created_at).localeCompare(timeKey(b.created_at)) || a.id.localeCompare(b.id);

function readEvent(value: unknown): Event {
  if (!record(value)) throw new StaffReportError("Saved detection records could not be verified. No partial report was returned.", 503);
  const joined = Array.isArray(value.conversations) && value.conversations.length === 1 ? value.conversations[0] : value.conversations;
  if (!record(joined) || typeof joined.user_id !== "string" || !uuid.test(joined.user_id)
    || !["id", "conversation_id", "message_id"].every((key) => typeof value[key] === "string" && uuid.test(value[key] as string))
    || !PRIORITY_ORDER.includes(value.level as SupportLevel) || !statuses.has(value.review_status as string)
    || typeof value.created_at !== "string" || !timestamp.test(value.created_at) || !Number.isFinite(Date.parse(value.created_at))) {
    throw new StaffReportError("Saved detection records could not be verified. No partial report was returned.", 503);
  }
  return {
    id: value.id as string, student_id: joined.user_id, conversation_id: value.conversation_id as string,
    message_id: value.message_id as string, level: value.level as SupportLevel,
    review_status: value.review_status as ReviewStatus, created_at: value.created_at,
  };
}

/** Read every matching event, using a stable keyset rather than a first-page snapshot. */
async function readEvents(client: SupabaseClient, signal: AbortSignal, cutoff: string, studentId?: string): Promise<Event[]> {
  const events: Event[] = [];
  const seen = new Set<string>();
  let cursor: Event | undefined;
  while (true) {
    signal.throwIfAborted();
    let query = client.from("support_events")
      .select("id,conversation_id,message_id,level,review_status,created_at,conversations!inner(user_id)")
      .lte("created_at", cutoff).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1000);
    if (studentId) query = query.eq("conversations.user_id", studentId);
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    const { data, error } = await query.retry(false);
    if (error || !Array.isArray(data)) throw new StaffReportError("Saved detections could not be loaded. Check local support-history storage and try again.", 503);
    if (data.length === 0) return events;
    const batch = data.map(readEvent);
    for (const event of batch) {
      if (studentId && event.student_id !== studentId) throw new StaffReportError("The student report could not be verified.", 503);
      if (seen.has(event.id) || (cursor && !(timeKey(event.created_at) < timeKey(cursor.created_at)
        || (timeKey(event.created_at) === timeKey(cursor.created_at) && event.id < cursor.id)))) {
        throw new StaffReportError("Detection pagination could not be verified. Refresh to request a complete report.", 503);
      }
      seen.add(event.id);
      events.push(event);
    }
    // Fail explicitly at the prototype's bound; never silently omit older urgent detections.
    if (events.length > 100_000) throw new StaffReportError("This dataset exceeds the local report limit. A database reporting index is required before a complete report can be shown.", 503);
    cursor = batch[batch.length - 1];
  }
}

async function identities(client: SupabaseClient, studentIds: string[], signal: AbortSignal): Promise<Map<string, Identity>> {
  const result = new Map<string, Identity>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, studentIds.length) }, async () => {
    while (next < studentIds.length) {
      signal.throwIfAborted();
      const id = studentIds[next++];
      try {
        const { data: { user }, error } = await client.auth.admin.getUserById(id);
        if (error || !user || user.id !== id) throw new Error("Account unavailable");
        const rawName = user.user_metadata?.name || user.user_metadata?.full_name;
        const email = typeof user.email === "string" ? user.email.slice(0, 320) : null;
        result.set(id, { name: typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 120) : email ?? "Student account", email, available: true });
      } catch {
        signal.throwIfAborted();
        result.set(id, { name: "Account details unavailable", email: null, available: false });
      }
    }
  }));
  return result;
}

export function groupDetectedAccounts(events: Event[], profiles: Map<string, Identity> = new Map()): DetectedAccount[] {
  const groups = new Map<string, Event[]>();
  for (const event of events) {
    const existing = groups.get(event.student_id);
    if (existing) existing.push(event); else groups.set(event.student_id, [event]);
  }
  return [...groups].map(([studentId, list]): DetectedAccount => {
    const unresolved = list.filter(open).sort(orderEvents);
    const byPriority = counts();
    for (const event of unresolved) byPriority[event.level]++;
    const chronological = [...list].sort((a, b) => timeKey(a.created_at).localeCompare(timeKey(b.created_at)));
    const profile = profiles.get(studentId);
    return {
      student_id: studentId, name: profile?.name ?? "Student account", email: profile?.email ?? null, identity_available: profile?.available ?? false,
      priority: unresolved[0]?.level ?? null, priority_since: unresolved[0]?.created_at ?? null,
      latest_detection_at: chronological[chronological.length - 1].created_at, first_detection_at: chronological[0].created_at,
      total_detections: list.length, unresolved_detections: unresolved.length, conversation_count: new Set(list.map((event) => event.conversation_id)).size,
      unresolved_by_priority: byPriority,
    };
  }).sort((a, b) => rank(a.priority) - rank(b.priority)
    || (a.priority_since && b.priority_since ? timeKey(a.priority_since).localeCompare(timeKey(b.priority_since)) : timeKey(b.latest_detection_at).localeCompare(timeKey(a.latest_detection_at)))
    || a.student_id.localeCompare(b.student_id));
}

export async function loadDetectionDashboard(client: SupabaseClient, staff: { email: string | null }, signal: AbortSignal): Promise<DetectionDashboard> {
  const generatedAt = new Date().toISOString();
  const events = await readEvents(client, signal, generatedAt);
  const profiles = await identities(client, [...new Set(events.map((event) => event.student_id))], signal);
  const students = groupDetectedAccounts(events, profiles);
  const accountsByPriority = counts();
  for (const student of students) if (student.priority) accountsByPriority[student.priority]++;
  return {
    generated_at: generatedAt, staff, students, accounts_by_priority: accountsByPriority,
    total_detections: events.length, unresolved_detections: students.reduce((sum, student) => sum + student.unresolved_detections, 0),
    identity_unavailable: students.filter((student) => !student.identity_available).length,
    review_queue_enabled: process.env.SUPPORT_REVIEW_QUEUE_ENABLED === "true",
  };
}

export async function loadStudentDetectionReport(client: SupabaseClient, studentId: string, signal: AbortSignal): Promise<StudentDetectionReport> {
  if (!uuid.test(studentId)) throw new StaffReportError("A valid student account ID is required.", 400);
  studentId = studentId.toLowerCase();
  const generatedAt = new Date().toISOString();
  const events = await readEvents(client, signal, generatedAt, studentId);
  if (!events.length) throw new StaffReportError("No saved detections were found for this account.", 404);
  const profiles = await identities(client, [studentId], signal);
  const [student] = groupDetectedAccounts(events, profiles);
  const visible = [...events].sort(orderEvents).slice(0, 100);
  const [{ data: messages, error: messageError }, { data: decisions, error: decisionError }] = await Promise.all([
    client.from("messages").select("id,conversation_id,role,content").in("id", visible.map((event) => event.message_id)).retry(false),
    client.from("support_events").select("id,decision").in("id", visible.map((event) => event.id)).retry(false),
  ]);
  if (messageError || decisionError || !Array.isArray(messages) || !Array.isArray(decisions)) throw new StaffReportError("The detection evidence could not be loaded. Please retry the report.", 503);
  const entries: DetectionReportEntry[] = visible.map((event) => {
    const message = messages.find((item) => item.id === event.message_id && item.conversation_id === event.conversation_id && item.role === "user");
    const raw = decisions.find((item) => item.id === event.id)?.decision;
    const decision = record(raw) && raw.level === event.level ? raw : null;
    return {
      id: event.id, conversation_id: event.conversation_id, message_id: event.message_id,
      level: event.level, review_status: event.review_status, created_at: event.created_at,
      message: typeof message?.content === "string" ? message.content.slice(0, 4000) : null,
      source: typeof decision?.source === "string" && sources.has(decision.source) ? decision.source : null,
      subject: decision?.subject === "student" || decision?.subject === "other" ? decision.subject : null,
      model_mode: decision?.model_mode === "prototype" || decision?.model_mode === "reviewed" ? decision.model_mode : null,
    };
  });
  return { generated_at: generatedAt, student, events: entries, total_events: events.length, review_queue_enabled: process.env.SUPPORT_REVIEW_QUEUE_ENABLED === "true" };
}
