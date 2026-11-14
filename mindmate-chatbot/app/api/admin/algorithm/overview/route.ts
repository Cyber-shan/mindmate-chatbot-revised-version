import { algorithmOverview } from "../../../../../lib/support/overview.ts";
import { requireOwner } from "../../../../../lib/admin/owner.ts";
import { StaffReportError } from "../../../../../lib/admin/staff.ts";

export const runtime = "nodejs";

/** Private aggregate artifacts; owner authorization precedes service and report reads. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
  try {
    await requireOwner(request);
    return Response.json(await algorithmOverview({ signal: request.signal }), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof StaffReportError ? error.message : "The classification status could not be loaded. Please try again." }, { status: error instanceof StaffReportError ? error.status : 503, headers });
  }
}
