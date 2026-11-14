import { requireStaff, staffDataClient, StaffReportError } from "../../../../lib/admin/staff.ts";
import { loadDetectionDashboard, loadStudentDetectionReport } from "../../../../lib/admin/detections.ts";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization", "X-Robots-Tag": "noindex, nofollow" };

/** Staff verification precedes every private lookup, including exports and account reports. */
export async function GET(request: Request) {
  try {
    const staff = await requireStaff(request);
    const params = new URL(request.url).searchParams;
    if (params.get("access") === "check") return Response.json({ staff: { email: staff.email } }, { headers });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
    const client = staffDataClient(signal);
    const studentId = params.get("student_id");
    const report = studentId !== null
      ? await loadStudentDetectionReport(client, studentId, signal)
      : await loadDetectionDashboard(client, { email: staff.email }, signal);
    return Response.json(report, { headers });
  } catch (error) {
    if (error instanceof StaffReportError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "The student report is temporarily unavailable. Please try again." }, { status: 503, headers });
  }
}
