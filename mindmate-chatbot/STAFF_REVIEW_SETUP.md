# Staff review workflow

The student dashboard at `/admin` is a staff-only review queue. The workflow migration is [`20261114160000_add_staff_review_workflow.sql`](supabase/migrations/20261114160000_add_staff_review_workflow.sql). It has been applied to this checkout's linked hosted Supabase project. Apply pending migrations with the normal Supabase migration process for another environment; do not reset existing data.

## Reviewing a detection

Open **Review case** for an account, then choose a detection using **Previous**, **Next**, or **Review this detection**. Each detection has its own review status and assignee. The first detection is selected automatically.

| Status | Meaning | Still unresolved? |
| --- | --- | --- |
| Needs review | Staff review has not been recorded, or a case was reopened. | Yes |
| Assigned | A current administrator or counselor is responsible for follow-up. | Yes |
| Contact attempted | Staff have recorded their own attempt to contact the student. | Yes |
| Reviewed · follow-up open | A review is recorded, with further follow-up outstanding. | Yes |
| Resolved | Staff have explicitly closed this detection. | No |
| False positive | Staff have explicitly closed this detection as a false positive. | No |

Choose an assignee for Assigned or Contact attempted. **Assign to me** selects the signed-in staff member. Add an optional plain-text note of up to 4,000 characters, then **Save review**. Notes are appended, not overwritten. Switching between detections keeps unsaved drafts. Closing a report with unsaved changes asks before discarding them.

Saving records the verified staff identity, exact time, previous and new status, previous and new assignee, note and version in `support_review_history`. Previous notes cannot be edited through the application. Deleted staff identities retain their email attribution in the audit record. Student deletion of the original conversation also removes its linked review history through the existing deletion chain.

Concurrent saves use a database row lock and expected version. A stale save returns HTTP 409 without changing the detection or adding an audit entry. **Reload review (keeps your note)** loads the other reviewer's changes while retaining your draft note for another save.

The manual staff workflow works independently of `SUPPORT_REVIEW_QUEUE_ENABLED`. Legacy detection values such as `unconfigured`, `pending` and `not_required` are displayed as Needs review; existing reviewed or closed states are retained. This feature records staff actions. It does not send email, contact a student or activate automatic counselor notifications.

## Reading the queue

- Priority cards count **accounts with unresolved detections**, once under each account's highest unresolved priority. The summary separately counts **unresolved detections**.
- Priority names are Immediate attention, High priority, Moderate priority and Low priority. A later lower-priority message cannot clear an unresolved higher-priority detection.
- The table's review status and assignee describe its highest-priority unresolved detection. Review the report to see every detection separately.
- Search covers names, email addresses and account IDs. Priority filters match the account's overall unresolved priority. Status, assignee and time filters must match the same individual detection; they never lower the account's priority.
- Sort by priority then longest wait, longest wait across priorities, or latest detection. Waiting time is measured from the oldest unresolved detection at the account's current highest priority.
- Timestamps are displayed in Asia/Manila time (PHT, UTC+08:00), with relative durations alongside exact dates. CSV timestamps remain explicitly labeled UTC.

The queue refreshes every 30 seconds in a visible tab. It pauses while a report is open. A stale snapshot is labeled after 90 seconds, and a failed refresh retains and labels the previous data. The report is a fixed snapshot until an explicit save or reload; draft notes are not silently overwritten. Closing the report refreshes the queue.

On mobile, the report fills the screen and scrolls independently. Radix Dialog traps focus, blocks background input, closes on Escape and restores focus to the opening control (or Refresh if that row has left the queue).

## Access and persistence

Every read and write checks the bearer session and existing server-managed administrator/counselor role or verified server email allowlist. Student-editable profile fields never authorize access. Assignees come only from the same verified staff directory. Clients cannot choose the actor recorded in an audit entry.

Review history has RLS enabled with no student policies. Anonymous and authenticated database roles cannot read or write it or invoke the update RPC. The server role can read and append history but cannot update or delete audit rows directly. The narrowly granted security-definer function performs the event update and audit append in one transaction with a fixed empty search path. Private responses use `Cache-Control: private, no-store`.

The local export tool includes `support_review_history`; apply the workflow migration to a local source before using that exporter. Keep private exports and staff notes out of source control. The app continues to use hosted Supabase without Docker.
