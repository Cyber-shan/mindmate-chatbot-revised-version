import { requireStaff, staffDataClient, StaffReportError, uuid } from "../../../../lib/admin/staff.ts";
import { loadReviewHistory, parseReviewUpdate, saveReview } from "../../../../lib/admin/reviews.ts";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Robots-Tag": "noindex, nofollow" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof StaffReportError ? error.message : "Staff review is temporarily unavailable." }, { status: error instanceof StaffReportError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  try {
    await requireStaff(request);
    const eventId = new URL(request.url).searchParams.get("event_id");
    if (!eventId || !uuid.test(eventId)) throw new StaffReportError("A valid detection ID is required.", 400);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
    const client = staffDataClient(signal);
    const [{ data: review, error }, history] = await Promise.all([
      client.from("support_events").select("id,workflow_status,workflow_version,assignee_id").eq("id", eventId.toLowerCase()).maybeSingle().retry(false),
      loadReviewHistory(client, eventId.toLowerCase(), signal),
    ]);
    if (error) throw new StaffReportError("This review could not be loaded.", 503);
    if (!review) throw new StaffReportError("This detection no longer exists.", 404);
    return Response.json({ history, review }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request);
    const text = await request.text();
    if (text.length > 20000) throw new StaffReportError("The review update is too large.", 413);
    let body;
    try { body = JSON.parse(text); } catch { throw new StaffReportError("Enter a valid review update.", 400); }
    const update = parseReviewUpdate(body);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
    const result = await saveReview(staffDataClient(signal), staff.id, update, signal);
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
