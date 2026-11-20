/**
 * One child's COSMIC competitions: each enrollment with its sections (the
 * template's requirements) and where the child's submission for each stands.
 *
 * Section status follows COSMIC's competition_submissions.status:
 *   approved          reviewer approved it
 *   submitted         the child submitted it and it awaits review
 *   changes_required  the reviewer sent it back
 *   in_progress       the child has started it
 *   not_started       nothing yet (also when COSMIC has no submission row)
 * A section is past due when it is not approved and its internal deadline has
 * passed. Withdrawn enrollments are kept, but nothing in them is past due.
 */
import * as cosmic from "./sources/cosmic.js";
import { toIso } from "./milestones.js";

export const SECTION_STATUSES = ["approved", "submitted", "changes_required", "in_progress", "not_started"] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

export interface SectionHistoryEntry {
  at: string | null;
  action: string;
  by: string;
  feedback: string;
}

export interface Section {
  id: string;
  key: string;
  title: string;
  group: string;
  type: string;
  required: boolean;
  status: SectionStatus;
  locked: boolean;
  pastDue: boolean;
  wordCount: number | null;
  minWords: number | null;
  maxWords: number | null;
  fileName: string;
  linkUrl: string;
  internalDeadline: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewer: string;
  feedback: string;
  revisionCount: number;
  history: SectionHistoryEntry[];
}

export interface CompetitionRecord {
  enrollment_id: string;
  template_id: string | null;
  name: string;
  status: string | null;
  withdrawn: boolean;
  assigned_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  final_deadline: string | null;
  competition_id_value: string | null;
  outcome_text: string | null;
  outcome_media_count: number;
  outcome_updated_at: string | null;
  sections: Section[];
  resubmissions: Record<string, unknown>[];
  sections_total: number;
  required_total: number;
  required_approved: number;
  approved: number;
  submitted: number;
  changes_required: number;
  in_progress: number;
  not_started: number;
  past_due: number;
  next_deadline: string | null;
}

const dateOnly = (v: unknown) => {
  const text = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};

const asStatus = (v: unknown): SectionStatus => {
  const s = String(v ?? "").toLowerCase();
  return (SECTION_STATUSES as readonly string[]).includes(s) ? (s as SectionStatus) : "not_started";
};

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export async function buildCompetitions(
  enrollments: Record<string, any>[],
  templates: Map<string, Record<string, any>>,
  today = new Date().toISOString().slice(0, 10),
): Promise<CompetitionRecord[]> {
  if (!enrollments.length) return [];
  const enrollmentIds = enrollments.map((e) => String(e.id));
  const [requirements, submissions, resubmissions] = await Promise.all([
    cosmic.getRequirements(enrollments.map((e) => String(e.template_id ?? ""))),
    cosmic.getSubmissions(enrollmentIds),
    cosmic.getResubmissionRequests(enrollmentIds),
  ]);

  const reviewerIds = new Set<string>();
  for (const s of submissions) {
    if (s.reviewed_by) reviewerIds.add(String(s.reviewed_by));
    for (const h of Array.isArray(s.history) ? s.history : []) if (h?.reviewer_id) reviewerIds.add(String(h.reviewer_id));
  }
  for (const r of resubmissions) if (r.decided_by) reviewerIds.add(String(r.decided_by));
  const emails = await cosmic.getUserEmails([...reviewerIds]);
  const who = (id: unknown) => (id ? emails.get(String(id)) || "" : "");

  const subByKey = new Map(submissions.map((s) => [`${s.enrollment_id}|${s.requirement_id}`, s]));
  const reqsByTemplate = new Map<string, Record<string, any>[]>();
  for (const r of requirements) {
    const list = reqsByTemplate.get(String(r.template_id)) ?? [];
    list.push(r);
    reqsByTemplate.set(String(r.template_id), list);
  }

  return enrollments.map((e) => {
    const enrollmentId = String(e.id);
    const templateId = e.template_id ? String(e.template_id) : null;
    const template = templateId ? templates.get(templateId) : undefined;
    const withdrawn = cosmic.isWithdrawn(e);
    const reqs = [...(reqsByTemplate.get(templateId ?? "") ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    const groups = new Map(reqs.filter((r) => r.submission_type === "group").map((r) => [String(r.id), r]));

    // Group rows are headings; the sections are the requirements under them.
    const leaves = reqs.filter((r) => r.submission_type !== "group");
    const statusByKey = new Map<string, SectionStatus>();
    const sections: Section[] = leaves.map((r) => {
      const sub = subByKey.get(`${enrollmentId}|${r.id}`);
      const status = asStatus(sub?.status);
      statusByKey.set(String(r.req_key ?? r.id), status);
      const internalDeadline = dateOnly(sub?.internal_deadline);
      const group = r.parent_id ? groups.get(String(r.parent_id)) : undefined;
      return {
        id: String(r.id),
        key: String(r.req_key ?? ""),
        title: String(r.title ?? r.req_key ?? "Section"),
        group: group ? String(group.title ?? "") : "",
        type: String(r.submission_type ?? ""),
        // A section is required only when its group (if any) is too.
        required: r.required !== false && (!group || group.required !== false),
        status,
        locked: false,
        pastDue: !withdrawn && status !== "approved" && Boolean(internalDeadline && internalDeadline < today),
        wordCount: num(sub?.word_count),
        minWords: num(r.min_words),
        maxWords: num(r.max_words),
        fileName: String(sub?.file_name ?? ""),
        linkUrl: String(sub?.link_url ?? ""),
        internalDeadline,
        submittedAt: toIso(sub?.submitted_at),
        reviewedAt: toIso(sub?.reviewed_at),
        reviewer: who(sub?.reviewed_by),
        feedback: String(sub?.feedback ?? "").trim(),
        revisionCount: Number(sub?.revision_count ?? 0) || 0,
        history: (Array.isArray(sub?.history) ? sub.history : []).map((h: any) => ({
          at: toIso(h?.at),
          action: String(h?.action ?? ""),
          by: who(h?.reviewer_id),
          feedback: String(h?.feedback ?? "").trim(),
        })),
      };
    });

    // A section waits on the one named by unlock_after_key until that is approved.
    leaves.forEach((r, i) => {
      const after = r.unlock_after_key ? statusByKey.get(String(r.unlock_after_key)) : undefined;
      if (after && after !== "approved" && sections[i].status === "not_started") sections[i].locked = true;
    });

    const count = (s: SectionStatus) => sections.filter((x) => x.status === s).length;
    const required = sections.filter((x) => x.required);
    const upcoming = sections
      .filter((x) => x.status !== "approved" && x.internalDeadline && x.internalDeadline >= today)
      .map((x) => x.internalDeadline as string)
      .sort();

    return {
      enrollment_id: enrollmentId,
      template_id: templateId,
      name: String(template?.name ?? "A competition"),
      status: e.status ?? null,
      withdrawn,
      assigned_at: toIso(e.assigned_at ?? e.created_at),
      withdrawn_at: toIso(e.withdrawn_at),
      withdrawal_reason: e.withdrawal_reason ?? null,
      final_deadline: dateOnly(template?.final_deadline),
      competition_id_value: e.competition_id_value ?? null,
      outcome_text: String(e.outcome_text ?? "").trim() || null,
      outcome_media_count: Array.isArray(e.outcome_media) ? e.outcome_media.length : 0,
      outcome_updated_at: toIso(e.outcome_updated_at),
      sections,
      resubmissions: resubmissions
        .filter((r) => String(r.enrollment_id) === enrollmentId)
        .map((r) => ({
          section: sections.find((s) => subByKey.get(`${enrollmentId}|${s.id}`)?.id === r.submission_id)?.title ?? "",
          reason: r.reason ?? "",
          status: r.status ?? "",
          decidedBy: who(r.decided_by),
          decidedAt: toIso(r.decided_at),
          note: r.decision_note ?? "",
          requestedAt: toIso(r.created_at),
        })),
      sections_total: sections.length,
      required_total: required.length,
      required_approved: required.filter((x) => x.status === "approved").length,
      approved: count("approved"),
      submitted: count("submitted"),
      changes_required: count("changes_required"),
      in_progress: count("in_progress"),
      not_started: count("not_started"),
      past_due: sections.filter((x) => x.pastDue).length,
      next_deadline: withdrawn ? null : (upcoming[0] ?? null),
    };
  });
}
