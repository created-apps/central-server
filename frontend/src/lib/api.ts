/**
 * The browser's calls to the tracker backend. They go to this app's own
 * /api/tracker proxy, which forwards the session token; nothing here holds a
 * credential.
 */
const BASE = "/api/tracker";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** A 401 means the session ended: go back to the login page. */
function signedOut(status: number) {
  if (status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    signedOut(res.status);
    throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

/**
 * Opens a PDF from the API in a new tab. The tab is opened before the fetch
 * so popup blockers allow it, then pointed at the downloaded file.
 */
export async function openPdf(path: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      signedOut(res.status);
      throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export interface StudentListItem {
  id: string;
  student_email: string | null;
  parent_email: string | null;
  student_name: string | null;
  program: string | null;
  track: string | null;
  project_name: string | null;
  scope_title: string | null;
  scope_approved: boolean;
  meetings_completed: number;
  latest_milestone: string | null;
  latest_milestone_at: string | null;
  milestone_count: number;
  report_count: number;
  last_synced_at: string | null;
  milestone_types: string[];
  progress_status: string | null;
  progress_headline: string | null;
  last_session_date: string | null;
}

export interface MilestoneRow {
  event_type: string;
  external_ref: string;
  occurred_at: string | null;
  details: Record<string, any>;
  first_seen_at: string;
}

export interface ReportRow {
  doc_id: string;
  doc_url: string | null;
  report_no: number | null;
  report_date: string | null;
  sessions_completed: number | null;
  group_name: string | null;
}

export interface StudentDetail {
  student: StudentListItem & {
    parent_name: string | null;
    enrolled_on: string | null;
    project_description: string | null;
    project_track: string | null;
    project_status: string | null;
    scope_summary: string | null;
    scope_json: unknown;
    scope_file_name: string | null;
    scope_file_path: string | null;
    scope_approved_at: string | null;
    sync_error: string | null;
    progress_reason: string | null;
    progress_recent_work: string | null;
    progress_assessed_at: string | null;
    sessions_cancelled: number;
    sessions_scheduled: number;
    sessions_planned: number | null;
    next_session_date: string | null;
  };
  milestones: MilestoneRow[];
  reports: ReportRow[];
  competitions: CompetitionRow[];
}

export type SectionStatus = "approved" | "submitted" | "changes_required" | "in_progress" | "not_started";

export interface SectionRow {
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
  history: { at: string | null; action: string; by: string; feedback: string }[];
}

export interface CompetitionRow {
  enrollment_id: string;
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
  sections: SectionRow[];
  resubmissions: {
    section: string;
    reason: string;
    status: string;
    decidedBy: string;
    decidedAt: string | null;
    note: string;
    requestedAt: string | null;
  }[];
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

export interface CompetitionStats {
  available: boolean;
  children?: number;
  entries?: number;
  withdrawn?: number;
  outcomes?: number;
  sections?: Record<SectionStatus | "total" | "past_due", number>;
  completion?: number | null;
  childrenWithPastDue?: number;
  resubmissionRequests?: number;
  swapRequests?: number;
  byCompetition?: {
    name: string;
    children: number;
    withdrawn: number;
    completion: number | null;
    submitted: number;
    changes_required: number;
    past_due: number;
    outcomes: number;
    resubmissions: number;
  }[];
}

export interface SyncStatus {
  running: boolean;
  schedule: string;
  lastRun: {
    status: string;
    trigger: string;
    started_at: string;
    finished_at: string | null;
    students: number;
    milestones: number;
    errors: number;
    message: string | null;
  } | null;
}
