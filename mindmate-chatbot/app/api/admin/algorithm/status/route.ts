import { algorithmStatus } from "../../../../../lib/support/overview.ts";

export const runtime = "nodejs";

/** The regular dashboard and tester receive service health without evaluation artifacts. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try { return Response.json(await algorithmStatus(request.signal), { headers }); }
  catch { return Response.json({ error: "The classification status could not be loaded. Please try again." }, { status: 503, headers }); }
}
