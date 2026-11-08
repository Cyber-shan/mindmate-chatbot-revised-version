import { createClient } from "@supabase/supabase-js";
import type { ChatMessage, ConversationState, SupportDecision } from "./types.ts";
import type { ChatTimings } from "../chat-performance.ts";

export class ConversationError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

type ConversationContext = { conversationId: string; messageId: string; messages: ChatMessage[]; previous?: ConversationState };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const boundedFetch = (timeout: number): typeof fetch => (input, init) => fetch(input, {
  ...init, signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(init?.signal ? [init.signal] : [])]),
});

function auditClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { global: { fetch: boundedFetch(1000) }, auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

/** Use the student's JWT and RLS to load canonical messages; never trust a submitted conversation ID alone. */
export async function loadConversation(request: Request, conversationId: unknown, messageId: unknown, timings?: ChatTimings): Promise<ConversationContext | null> {
  if (conversationId === undefined && messageId === undefined) return null;
  if (typeof conversationId !== "string" || !uuid.test(conversationId) || typeof messageId !== "string" || !uuid.test(messageId)) {
    throw new ConversationError("A valid conversation and message ID are required.", 400);
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ConversationError("Please sign in to continue.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new ConversationError("Conversation storage is unavailable.", 503);
  const client = createClient(url, key, {
    global: { headers: { Authorization: authorization }, fetch: boundedFetch(2500) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const getUser = () => client.auth.getUser(authorization.slice(7));
  const { data: { user }, error: authError } = await (timings ? timings.measure("auth", getUser) : getUser());
  if (authError) throw new ConversationError("Unable to verify the conversation session.", !authError.status || authError.status >= 500 ? 503 : 401);
  if (!user) throw new ConversationError("Please sign in to continue.", 401);
  const audit = auditClient();
  // The ownership filter and RLS protect this single history query, replacing a separate lookup.
  const getHistory = () => client.from("messages").select("id, role, content, conversations!inner(user_id)")
    .eq("conversation_id", conversationId).eq("conversations.user_id", user.id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  const getState = async (): Promise<{ data: { decision: { state?: ConversationState } } | null }> => {
    if (!audit) return { data: null };
    const { data: last } = await audit.from("support_events").select("decision")
      .eq("conversation_id", conversationId).neq("message_id", messageId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    return { data: last };
  };
  // State is never used or returned until the canonical history passes ownership validation.
  const [{ data, error }, { data: last }] = await Promise.all([
    timings ? timings.measure("history", getHistory) : getHistory(),
    timings ? timings.measure("risk_state", getState) : getState(),
  ]);
  if (error) throw new ConversationError("Unable to load conversation messages.", 503);
  if (!data?.length) throw new ConversationError("Conversation not found.", 404);
  if (data[0].id !== messageId || data[0].role !== "user") throw new ConversationError("Please send the latest student message.", 409);
  const previous: ConversationState | undefined = last?.decision?.state;
  return { conversationId, messageId, messages: data.reverse().map(({ role, content }) => ({ role, content } as ChatMessage)), previous };
}

/** Store metadata only. A database failure cannot suppress a deterministic safety reply. */
export async function recordDecision(decision: SupportDecision, context: ConversationContext | null): Promise<boolean> {
  console.info("support_priority", {
    level: decision.level, source: decision.source, rules: decision.rules,
    model_version: decision.model_version, rule_version: decision.rule_version,
    requires_human_review: decision.requires_human_review,
  });
  const client = auditClient();
  if (!client || !context) return false;
  try {
    const reviewStatus = decision.requires_human_review
      ? process.env.SUPPORT_REVIEW_QUEUE_ENABLED === "true" ? "pending" : "unconfigured"
      : "not_required";
    // Retries are idempotent and cannot reopen an already reviewed event.
    const { data, error } = await client.from("support_events").upsert({
      conversation_id: context.conversationId, message_id: context.messageId,
      level: decision.level, decision, review_status: reviewStatus,
    }, { onConflict: "message_id", ignoreDuplicates: true }).select("id");
    if (error) { console.warn("Support audit storage is unavailable."); return false; }
    if (data?.length) return reviewStatus === "pending";
    const { data: existing } = await client.from("support_events").select("review_status")
      .eq("message_id", context.messageId).maybeSingle();
    return existing?.review_status === "pending";
  } catch { console.warn("Support audit storage is unavailable."); return false; }
}
