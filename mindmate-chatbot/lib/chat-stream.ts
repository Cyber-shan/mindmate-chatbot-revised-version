import type { StudentSupport } from "./support/types.ts";

type ChatStreamEvent = {
  message?: { content?: string };
  done?: boolean;
  error?: string;
  support?: StudentSupport;
};

/** Read Ollama's newline-delimited events, including lines split across chunks. */
export async function readChatReply(
  response: Response,
  onContent: (reply: string) => void,
  onSupport?: (support: StudentSupport) => void,
  options: { updateIntervalMs?: number } = {},
): Promise<string> {
  if (!response.body) throw new Error("MindMate could not start a response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let reply = "";
  let completed = false;
  const interval = options.updateIntervalMs ?? 40;
  let lastVisibleReply = "";
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (updateTimer !== undefined) clearTimeout(updateTimer);
    updateTimer = undefined;
    if (reply !== lastVisibleReply) { lastVisibleReply = reply; onContent(reply); }
  };

  const processLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ChatStreamEvent;
    if (event.error) throw new Error(event.error);
    if (event.support) onSupport?.(event.support);
    if (typeof event.message?.content === "string" && event.message.content) {
      reply = (reply + event.message.content).slice(0, 4000);
      // Show the first token immediately; coalesce later tokens into at most 25 updates/sec.
      if (!lastVisibleReply || interval <= 0) flush();
      else if (updateTimer === undefined) updateTimer = setTimeout(flush, interval);
    }
    if (event.done === true) completed = true;
  };

  try {
    while (!completed) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        processLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (completed) break;
      }
      if (done) {
        if (!completed) processLine(pending);
        break;
      }
    }

    if (!completed) {
      throw new Error("MindMate's response was interrupted. Please try again.");
    }
    if (!reply.trim()) throw new Error("MindMate returned an empty response.");
    flush();
    return reply.trim();
  } finally {
    if (updateTimer !== undefined) clearTimeout(updateTimer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
