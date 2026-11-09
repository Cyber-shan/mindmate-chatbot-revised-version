import type { StudentSupport } from "./types.ts";

export type StudentChatMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
  support?: StudentSupport;
};

export type StoredStudentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/** Copy only the student-facing contract, including safe actionable resource links. */
export function parseStudentSupport(value: unknown): StudentSupport | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.safety_response_required !== "boolean"
    || typeof candidate.review_status !== "string" || !["queued", "unavailable", "not_required"].includes(candidate.review_status)
    || !Array.isArray(candidate.resources) || candidate.resources.length > 10) return null;
  const resources: StudentSupport["resources"] = [];
  for (const resource of candidate.resources) {
    if (!resource || typeof resource !== "object" || typeof resource.label !== "string" || !resource.label.trim()
      || resource.label.length > 200 || typeof resource.href !== "string" || resource.href.length > 2048) return null;
    try {
      const url = new URL(resource.href);
      if (!["https:", "http:", "tel:"].includes(url.protocol) || url.username || url.password) return null;
    } catch { return null; }
    resources.push({ label: resource.label, href: resource.href });
  }
  return {
    safety_response_required: candidate.safety_response_required,
    review_status: candidate.review_status as StudentSupport["review_status"],
    resources,
  };
}

/** Restore notices only from authorized metadata matching messages in the loaded conversation. */
export function restoreStudentMessages(stored: StoredStudentMessage[], payload: unknown): StudentChatMessage[] {
  const byUser = new Map<string, StudentSupport>();
  const duplicateIds = new Set<string>();
  if (payload && typeof payload === "object" && "available" in payload && payload.available === true
    && "messages" in payload && Array.isArray(payload.messages)) {
    for (const record of payload.messages) {
      if (!record || typeof record !== "object" || typeof record.message_id !== "string") continue;
      const support = parseStudentSupport(record.support);
      if (!support || duplicateIds.has(record.message_id)) continue;
      if (byUser.has(record.message_id)) {
        // Conflicting duplicate metadata must never invent a confirmed review request.
        byUser.delete(record.message_id);
        duplicateIds.add(record.message_id);
      } else byUser.set(record.message_id, support);
    }
  }
  let pending: StudentSupport | undefined;
  return stored.map((message) => {
    const result: StudentChatMessage = {
      id: message.id, role: message.role === "assistant" ? "ai" : "user", text: message.content,
    };
    if (message.role === "user") {
      pending = byUser.get(message.id);
      if (pending) result.support = pending;
    } else if (pending) {
      result.support = pending;
      pending = undefined;
    }
    return result;
  });
}
