/** SYNC reads: meetings, the SRM scope call and WhatsApp group membership. */
import { syncSource } from "./clients.js";
import { emailFilter, sameEmail } from "./postgrest.js";

const MEETING_FIELDS = "id,student_email,student_name,mentor_name,meeting_date,meeting_time,status";

export async function getMeetings(email: string) {
  if (!email) return [];
  const rows = await syncSource.select("meetings_with_details", {
    columns: MEETING_FIELDS,
    filters: { student_email: emailFilter(email) },
    order: "meeting_date.asc",
  });
  return sameEmail(rows, "student_email", email);
}

/** Every SYNC user id with this email (an email can sit on more than one row). */
export async function getUserIds(email: string): Promise<string[]> {
  if (!email) return [];
  const users = sameEmail(
    await syncSource.select("users", { columns: "id,email", filters: { email: emailFilter(email) } }),
    "email",
    email,
  );
  return users.map((u) => u.id).filter(Boolean);
}

function callStart(m: Record<string, any>): string {
  const date = String(m.meeting_date ?? "").trim();
  const time = String(m.meeting_time ?? "").trim();
  return date ? (time ? `${date}T${time}` : date) : "";
}

/** The optional scope discussion call with the SRM; the soonest live one. */
export async function getScopeCall(userIds: string[]) {
  if (!userIds.length) return null;
  const meetings = await syncSource.select("meetings", {
    columns: "id,meeting_date,meeting_time,status,google_meet_link,scope_meeting_with_srm",
    filters: { student_id: `in.(${userIds.join(",")})`, scope_meeting_with_srm: "is.true" },
    order: "meeting_date.asc",
  });
  const live = meetings.filter((m) => String(m.status ?? "").toLowerCase() !== "cancelled" && m.meeting_date);
  if (!live.length) return null;
  const m = live.sort((a, b) => callStart(a).localeCompare(callStart(b)))[0];
  return { id: String(m.id), start: callStart(m), meetLink: m.google_meet_link ?? "", status: m.status ?? "" };
}

/**
 * WhatsApp group JIDs the child is in as a student. This is how a progress
 * report is tied to a child: users.email -> memberships -> groups.group_jid.
 * Only 'student' memberships, since staff sit in many children's groups.
 */
export async function getStudentGroupJids(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const memberships = await syncSource.select("user_group_memberships", {
    columns: "group_id,role",
    filters: { user_id: `in.(${userIds.join(",")})`, role: "eq.student" },
  });
  const groupIds = [...new Set(memberships.map((m) => m.group_id).filter(Boolean))];
  if (!groupIds.length) return [];
  const groups = await syncSource.select("groups", {
    columns: "id,group_jid",
    filters: { id: `in.(${groupIds.join(",")})` },
  });
  return [...new Set(groups.map((g) => g.group_jid).filter(Boolean))];
}

/** Every meeting and meeting summary for the child, oldest first (for the progress update). */
export async function getSessionHistory(userIds: string[]) {
  if (!userIds.length) return { meetings: [], summaries: [] };
  const ids = `in.(${userIds.join(",")})`;
  const [meetings, summaries] = await Promise.all([
    syncSource.select("meetings", {
      columns: "id,student_id,meeting_date,meeting_time,status",
      filters: { student_id: ids },
      order: "meeting_date.asc",
    }),
    syncSource.select("meeting_summaries", {
      columns: "id,meeting_id,meeting_started_at,summary,homework,created_at",
      filters: { student_id: ids },
      order: "meeting_started_at.asc",
    }),
  ]);
  return { meetings, summaries };
}
