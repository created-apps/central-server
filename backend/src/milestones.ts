/**
 * Builds one enrolled child's milestones from the sheet, SYNC, COSMIC and
 * AUTOMATIONS. Mirrors the booking platform's counselor feed detection
 * (backend/app/services/counselor_feed.py), so both report the same facts.
 */
import * as cosmic from "./sources/cosmic.js";
import * as sync from "./sources/sync.js";
import type { ProgressReportIndex, ReportEntry } from "./sources/automations.js";
import type { SheetRow } from "./sources/sheet.js";
import { buildProgressInput, type ProgressInput } from "./progress.js";
import { buildCompetitions, type CompetitionRecord } from "./competitions.js";

export const MILESTONE_TYPES = [
  "enrolled",
  "first_consult_done",
  "scope_call",
  "project_confirmed",
  "scope_available",
  "comps_suggested",
  "competition_entered",
  "midway_call",
  "competition_outcome",
  "closure_call",
  "progress_report",
] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

/** Milestones that happen once per child; the rest are keyed by source object. */
const SINGLETONS = new Set<MilestoneType>([
  "enrolled",
  "first_consult_done",
  "project_confirmed",
  "scope_available",
  "closure_call",
]);

export interface Milestone {
  eventType: MilestoneType;
  externalRef: string;
  occurredAt: string | null;
  details: Record<string, unknown>;
}

export interface ChildSnapshot {
  key: string;
  student: Record<string, unknown>;
  milestones: Milestone[];
  reports: ReportEntry[];
  progress: ProgressInput;
  competitions: CompetitionRecord[];
}

const CLOSURE_STEMS = ["clos", "final", "wrap", "exit"];

/** An ISO timestamp from a date-ish value, or null when it does not parse. */
export function toIso(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The readable parts of a COSMIC scope. project_scope is usually the whole
 * scope document serialised as JSON; "Project Info" holds the title and summary.
 */
export function parseScope(raw: unknown): { title: string; summary: string; json: unknown } {
  let value: unknown = raw;
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }
  if (value && typeof value === "object") {
    const info = ((value as Record<string, any>)["Project Info"] ?? {}) as Record<string, any>;
    return {
      title: String(info["Project Title"] ?? "").trim(),
      summary: String(info["Project Summary"] ?? "").trim(),
      json: value,
    };
  }
  const text = typeof value === "string" ? value.trim() : "";
  return { title: "", summary: text, json: null };
}

const fullName = (s: Record<string, any> | null | undefined) =>
  [s?.first_name, s?.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

export async function buildChild(row: SheetRow, reports: ProgressReportIndex): Promise<ChildSnapshot> {
  const key = row.studentEmail || row.parentEmail;
  const milestones: Milestone[] = [];
  const add = (eventType: MilestoneType, details: Record<string, unknown>, occurredAt: unknown, ref?: string) =>
    milestones.push({
      eventType,
      externalRef: SINGLETONS.has(eventType) ? "-" : ref || "-",
      occurredAt: toIso(occurredAt),
      details,
    });

  // Who to follow: the sheet's student email, or the one child of a parent email.
  let studentEmail = row.studentEmail;
  let cosmicRows = studentEmail ? await cosmic.findStudents(studentEmail) : [];
  if (!studentEmail && row.parentEmail) {
    const child = await cosmic.findStudentByParent(row.parentEmail);
    if (child) {
      studentEmail = String(child.email ?? "").trim().toLowerCase();
      cosmicRows = await cosmic.findStudents(studentEmail);
    }
  }
  const studentName = row.studentName || fullName(cosmicRows[0]);
  const studentIds = cosmicRows.map((r) => String(r.id)).filter(Boolean);

  const [projects, enrollments, meetings, userIds] = await Promise.all([
    cosmic.getProjects(studentIds),
    cosmic.getCompetitionEnrollments(studentIds),
    sync.getMeetings(studentEmail),
    sync.getUserIds(studentEmail),
  ]);
  const history = await sync.getSessionHistory(userIds);
  projects.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const project = projects[0] ?? null;
  const scope = parseScope(project?.project_scope);

  // 1 — enrolled (the sheet is the source of truth).
  add("enrolled", { program: row.program, track: row.track, enrolledOn: row.enrolledOn }, row.enrolledOn);

  // 2 — first consult actually happened.
  const completed = meetings.filter((m) => String(m.status ?? "").toLowerCase() === "completed");
  if (completed[0]) {
    add(
      "first_consult_done",
      { mentor: completed[0].mentor_name ?? "", date: completed[0].meeting_date ?? "" },
      completed[0].meeting_date,
    );
  }

  // 2b — optional scope discussion call with the SRM.
  const scopeCall = await sync.getScopeCall(userIds);
  if (scopeCall) {
    add("scope_call", { start: scopeCall.start, meetLink: scopeCall.meetLink, status: scopeCall.status }, scopeCall.start, `meeting:${scopeCall.id}`);
  }

  // 3 — project confirmed.
  if (project?.project_name) {
    add(
      "project_confirmed",
      { projectName: project.project_name, description: project.project_description ?? "", track: project.project_track ?? "" },
      project.created_at,
    );
  }

  // 4 — scope approved.
  if (project?.scope_approved && project?.scope_file_path) {
    add(
      "scope_available",
      { projectName: project.project_name ?? "", title: scope.title, fileName: project.scope_file_name ?? "" },
      project.scope_approved_at,
    );
  }

  if (project?.id) {
    const projectId = String(project.id);
    const [run, calls, closure] = await Promise.all([
      cosmic.getApprovedRecommendationRun(projectId),
      cosmic.getPocCalls(projectId),
      cosmic.getClosureRecord(projectId),
    ]);

    // 4b — competitions suggested (approved matcher run only).
    if (run && run.competitions.length) {
      add("comps_suggested", await enrichSuggestions(run), run.reviewedAt, `run:${run.id}`);
    }

    const live = calls.filter((c) => String(c.status ?? "").toLowerCase() !== "cancelled");

    // 6 — mid-programme review call.
    for (const call of live.filter((c) => c.milestone === "mid" && c.scheduled_start)) {
      add("midway_call", { start: call.scheduled_start, meetLink: call.meet_link ?? "", status: call.status ?? "" }, call.scheduled_start, String(call.id));
    }

    // 8 — closure call. The record has the date; the Meet link is on the call.
    if (closure?.closure_call_date) {
      const day = String(closure.closure_call_date).slice(0, 10);
      const call =
        live.find((c) => CLOSURE_STEMS.some((s) => String(c.milestone ?? "").toLowerCase().includes(s))) ??
        live.find((c) => String(c.scheduled_start ?? "").slice(0, 10) === day);
      add(
        "closure_call",
        { date: closure.closure_call_date, outcome: closure.project_outcome ?? "", start: call?.scheduled_start ?? "", meetLink: call?.meet_link ?? "" },
        call?.scheduled_start ?? closure.closure_call_date,
      );
    }
  }

  // 5 and 7 — competitions entered, and any recorded outcome.
  const templates = await cosmic.getTemplates(enrollments.map((e) => String(e.template_id ?? "")));
  const competitions = await buildCompetitions(enrollments, templates);
  const seenCompetitions = new Set<string>();
  for (const e of enrollments.filter((x) => !cosmic.isWithdrawn(x))) {
    const template = templates.get(String(e.template_id ?? ""));
    const name = template?.name ?? "A competition";
    // Two enrolment rows can be the same competition; key on the template name.
    const ref = `competition:${String(name).toLowerCase()}`;
    if (seenCompetitions.has(ref)) continue;
    seenCompetitions.add(ref);
    add("competition_entered", { competition: name, status: e.status ?? "" }, e.assigned_at ?? e.created_at, ref);
    const outcome = String(e.outcome_text ?? "").trim();
    if (outcome) add("competition_outcome", { competition: name, outcome }, e.outcome_updated_at, ref);
  }

  // 9 — progress reports. Every report is kept; each is its own milestone.
  const groupJids = await sync.getStudentGroupJids(userIds);
  const childReports = reports.forStudent(studentEmail, studentName, groupJids);
  for (const r of childReports) {
    add("progress_report", { reportNo: r.reportNo, sessionsCompleted: r.sessionsCompleted, docUrl: r.docUrl }, r.date, r.docId);
  }

  // One milestone per key (a duplicate would break the unique constraint).
  const unique = new Map<string, Milestone>();
  for (const m of milestones) unique.set(`${m.eventType}|${m.externalRef}`, unique.get(`${m.eventType}|${m.externalRef}`) ?? m);

  return {
    key,
    student: {
      student_email: studentEmail || null,
      parent_email: row.parentEmail || null,
      student_name: studentName || null,
      parent_name: row.parentName || null,
      program: row.program || null,
      track: row.track || null,
      enrolled_on: row.enrolledOn || null,
      sheet_row: row.sheetRow,
      in_sheet: true,
      cosmic_student_id: studentIds[0] ?? null,
      project_id: project?.id ? String(project.id) : null,
      project_name: project?.project_name ?? null,
      project_description: project?.project_description ?? null,
      project_track: project?.project_track ?? null,
      project_status: project?.status ?? null,
      scope_title: scope.title || null,
      scope_summary: scope.summary || null,
      scope_json: scope.json ?? null,
      scope_file_name: project?.scope_file_name ?? null,
      scope_file_path: project?.scope_file_path ?? null,
      scope_approved: Boolean(project?.scope_approved),
      scope_approved_at: toIso(project?.scope_approved_at),
    },
    milestones: [...unique.values()],
    reports: childReports,
    progress: buildProgressInput({
      studentName: studentName || "the student",
      programme: row.program,
      project,
      meetings: history.meetings,
      summaries: history.summaries,
    }),
    competitions,
  };
}

type ApprovedRun = NonNullable<Awaited<ReturnType<typeof cosmic.getApprovedRecommendationRun>>>;

/**
 * The approved matcher run's suggestions with the reviewer's call on each
 * (approved, rejected or pending; selected when the child picked it) and any
 * swap requests the child made against the run.
 */
async function enrichSuggestions(run: ApprovedRun): Promise<Record<string, unknown>> {
  const [items, swaps] = await Promise.all([cosmic.getRecommendationItems(run.id), cosmic.getSwapRequests(run.id)]);
  const byListing = new Map(items.map((i) => [String(i.listing_id ?? ""), i]));
  const names = new Map(run.competitions.map((c) => [c.listingId, c.name]));
  const missing = swaps
    .flatMap((w) => [String(w.from_listing_id ?? ""), String(w.to_listing_id ?? "")])
    .filter((id) => id && !names.has(id));
  for (const [id, name] of await cosmic.getListingNames(missing)) names.set(id, name);
  return {
    competitions: run.competitions.map((c) => {
      const item = byListing.get(c.listingId);
      return {
        ...c,
        reviewState: String(item?.review_state ?? "").toLowerCase(),
        selected: String(item?.state ?? "").toUpperCase() === "SELECTED",
        reviewNote: item?.review_note ?? "",
      };
    }),
    swaps: swaps.map((w) => ({
      from: names.get(String(w.from_listing_id ?? "")) || "A competition",
      to: names.get(String(w.to_listing_id ?? "")) || "A competition",
      reason: w.student_reason ?? "",
      status: String(w.status ?? "").toLowerCase(),
      note: w.review_note ?? "",
      requestedAt: w.created_at ?? null,
      reviewedAt: w.reviewed_at ?? null,
    })),
  };
}
