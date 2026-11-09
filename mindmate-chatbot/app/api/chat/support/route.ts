import { ConversationError, loadSupportHistory } from "../../../../lib/support/store.ts";

const headers = { "Cache-Control": "private, no-store" };

/** Authenticated history metadata only. Private decisions and scores stay on the server. */
export async function GET(request: Request) {
  try {
    const conversationId = new URL(request.url).searchParams.get("conversation_id");
    return Response.json(await loadSupportHistory(request, conversationId), { headers });
  } catch (error) {
    if (error instanceof ConversationError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Support history is temporarily unavailable." }, { status: 503, headers });
  }
}
