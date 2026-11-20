/** COSMIC reads: the child's project, scope, competitions and programme calls. */
import { cosmicSource } from "./clients.js";
import { emailFilter, sameEmail } from "./postgrest.js";

const STUDENT_FIELDS = "id,first_name,last_name,email,parent_email,program_enrolled,created_at";
const PROJECT_FIELDS =
  "id,student_id,project_name,project_description,project_scope,project_track,status," +
  "scope_approved,scope_approved_at,scope_file_name,scope_file_path,start_date,end_date," +
  "planned_total_sessions,created_at";
const ENROLLMENT_FIELDS =
  "id,student_id,template_id,status,outcome_text,outcome_media,outcome_updated_at,assigned_at,created_at," +
  "withdrawn_at,withdrawal_reason,competition_id_value";
/** Submission metadata only: the child's answer text (`content`) is never read. */
const SUBMISSION_FIELDS =
  "id,enrollment_id,requirement_id,status,word_count,file_name,link_url,internal_deadline," +
  "submitted_at,reviewed_by,reviewed_at,feedback,revision_count,history,updated_at";

/** Every COSMIC student row for an email. COSMIC has duplicates; all are searched. */
export async function findStudents(email: string) {
  if (!email) return [];
  const rows = await cosmicSource.select("students", {
    columns: STUDENT_FIELDS,
    filters: { email: emailFilter(email) },
    order: "created_at.asc",
  });
  return sameEmail(rows, "email", email);
}

/** The child of a parent email, only when it identifies exactly one child. */
export async function findStudentByParent(parentEmail: string) {
  if (!parentEmail) return null;
  const rows = sameEmail(
    await cosmicSource.select("students", {
      columns: STUDENT_FIELDS,
      filters: { parent_email: emailFilter(parentEmail) },
      limit: 5,
    }),
    "parent_email",
    parentEmail,
  );
  const children = new Set(rows.map((r) => String(r.email ?? "").trim().toLowerCase()));
  return children.size === 1 ? rows[0] : null;
}

export async function getProjects(studentIds: string[]) {
  if (!studentIds.length) return [];
  return cosmicSource.select("projects", {
    columns: PROJECT_FIELDS,
    filters: { student_id: `in.(${studentIds.join(",")})` },
    order: "created_at.desc",
  });
}

/** Every competition enrollment, withdrawn ones included. */
export async function getCompetitionEnrollments(studentIds: string[]) {
  if (!studentIds.length) return [];
  return cosmicSource.select("competition_enrollments", {
    columns: ENROLLMENT_FIELDS,
    filters: { student_id: `in.(${studentIds.join(",")})` },
    order: "created_at.desc",
  });
}

export const isWithdrawn = (e: Record<string, any>) => String(e.status ?? "").toLowerCase() === "withdrawn";

const inList = (ids: string[]) => `in.(${[...new Set(ids.filter(Boolean))].join(",")})`;

/** The sections of each competition template, groups included. */
export async function getRequirements(templateIds: string[]) {
  if (!templateIds.filter(Boolean).length) return [];
  return cosmicSource.select("competition_requirements", {
    columns: "id,template_id,parent_id,req_key,title,submission_type,required,sort_order,unlock_after_key,min_words,max_words",
    filters: { template_id: inList(templateIds) },
    order: "sort_order.asc",
    limit: 5000,
  });
}

export async function getSubmissions(enrollmentIds: string[]) {
  if (!enrollmentIds.filter(Boolean).length) return [];
  return cosmicSource.select("competition_submissions", {
    columns: SUBMISSION_FIELDS,
    filters: { enrollment_id: inList(enrollmentIds) },
    limit: 5000,
  });
}

export async function getResubmissionRequests(enrollmentIds: string[]) {
  if (!enrollmentIds.filter(Boolean).length) return [];
  return cosmicSource.select("competition_resubmission_requests", {
    columns: "id,submission_id,enrollment_id,reason,status,decided_by,decided_at,decision_note,created_at",
    filters: { enrollment_id: inList(enrollmentIds) },
    order: "created_at.desc",
  });
}

/** COSMIC user ids (reviewers) to their email addresses. */
export async function getUserEmails(ids: string[]): Promise<Map<string, string>> {
  if (!ids.filter(Boolean).length) return new Map();
  const rows = await cosmicSource.select("users", { columns: "id,email", filters: { id: inList(ids) } });
  return new Map(rows.map((r) => [String(r.id), String(r.email ?? "")]));
}

/** The reviewer's decision on each suggestion in a matcher run, by listing id. */
export async function getRecommendationItems(runId: string) {
  return cosmicSource.select("recommendation_items", {
    columns: "listing_id,rank,state,review_state,review_note,selected_at",
    filters: { run_id: `eq.${runId}` },
  });
}

export async function getSwapRequests(runId: string) {
  return cosmicSource.select("competition_swap_requests", {
    columns: "id,from_listing_id,to_listing_id,student_reason,status,review_note,reviewed_at,created_at",
    filters: { run_id: `eq.${runId}` },
    order: "created_at.desc",
  });
}

export async function getListingNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.filter(Boolean).length) return new Map();
  const rows = await cosmicSource.select("competition_listings", { columns: "id,name", filters: { id: inList(ids) } });
  return new Map(rows.map((r) => [String(r.id), String(r.name ?? "")]));
}

export async function getTemplates(ids: string[]): Promise<Map<string, Record<string, any>>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await cosmicSource.select("competition_templates", {
    columns: "id,name,slug,final_deadline",
    filters: { id: `in.(${unique.join(",")})` },
  });
  return new Map(rows.map((r) => [String(r.id), r]));
}

/** Only an APPROVED matcher run is a real suggestion. */
export async function getApprovedRecommendationRun(projectId: string) {
  const run = await cosmicSource.selectOne("recommendation_runs", {
    columns: "id,status,payload,reviewed_at,created_at",
    filters: { project_id: `eq.${projectId}`, status: "eq.APPROVED" },
    order: "created_at.desc",
  });
  if (!run) return null;
  const items: any[] = run.payload?.items ?? [];
  const competitions = items
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((i) => ({
      rank: i.rank ?? null,
      listingId: String(i.competition?.id ?? ""),
      fit: i.fit_bucket ?? "",
      reason: i.reason ?? "",
      name: i.competition?.name ?? i.slug ?? "",
      region: i.competition?.region ?? "",
      deadline: i.competition?.deadline_text ?? i.competition?.deadline_date ?? "",
      url: (i.competition?.official_urls ?? [])[0] ?? "",
    }))
    .filter((c) => c.name);
  return { id: String(run.id), reviewedAt: run.reviewed_at ?? run.created_at ?? "", competitions };
}

export async function getPocCalls(projectId: string) {
  return cosmicSource.select("poc_calls", {
    columns: "id,milestone,status,scheduled_start,meet_link",
    filters: { project_id: `eq.${projectId}` },
    order: "scheduled_start.desc",
  });
}

export async function getClosureRecord(projectId: string) {
  return cosmicSource.selectOne("closure_records", {
    columns: "id,closure_call_date,project_outcome,created_at",
    filters: { project_id: `eq.${projectId}` },
    order: "created_at.desc",
  });
}

export async function getScopeDownloadUrl(path: string, bucket: string, ttl: number) {
  return cosmicSource.signedUrl(bucket, path, ttl);
}
