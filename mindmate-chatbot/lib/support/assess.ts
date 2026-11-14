import { prioritize } from "./policy.ts";
import { predict } from "./classifier.ts";
import type { ChatMessage, ConversationState, SupportDecision } from "./types.ts";

/** Shared by student chat and the admin tester; safety overrides never wait for ML. */
export async function assessSupport(
  message: string,
  history: ChatMessage[] = [],
  options: { signal?: AbortSignal; previous?: ConversationState } = {},
): Promise<SupportDecision> {
  const local = prioritize(message, history, null, options.previous);
  if (local.level === "IMMEDIATE_SAFETY") return local;
  const model = await predict(message, options.signal);
  return model ? prioritize(message, history, model, options.previous) : local;
}
