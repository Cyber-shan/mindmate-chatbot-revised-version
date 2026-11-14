import { requireStaff, StaffReportError, uuid } from "./staff.ts";

/** A single server-configured identity; staff roles alone never grant owner access. */
export function requireOwnerId(id: string) {
  const owner = process.env.MINDMATE_OWNER_USER_ID?.trim();
  if (!owner || !uuid.test(owner)) {
    throw new StaffReportError("The private workspace is not configured.", 503);
  }
  if (id.toLowerCase() !== owner.toLowerCase()) {
    throw new StaffReportError("This workspace is available only to the project owner.", 403);
  }
}

export async function requireOwner(request: Request) {
  const staff = await requireStaff(request);
  requireOwnerId(staff.id);
  return staff;
}
