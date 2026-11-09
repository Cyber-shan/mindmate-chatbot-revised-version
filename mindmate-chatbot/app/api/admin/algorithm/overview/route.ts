import { algorithmOverview } from "../../../../../lib/support/overview.ts";

export const runtime = "nodejs";

/** Aggregate prototype artifacts and service status only; this endpoint never reads student records. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try { return Response.json(await algorithmOverview({ signal: request.signal }), { headers }); }
  catch { return Response.json({ error: "The algorithm status could not be loaded. Please try again." }, { status: 503, headers }); }
}
