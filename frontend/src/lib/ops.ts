"use client";

/**
 * Groups and mentors: the operations side, served by the assessment-automations
 * backend through this app's /api routes. Types, fetchers, hooks and labels.
 */
import useSWR, { type SWRConfiguration } from "swr";

// ---------------------------------------------------------------- Types

export type Stage = "AWAITING_JOIN" | "NEW" | "IN_PROGRESS" | "AWAITING_MENTOR_JOIN" | "MENTOR_ASSIGNED" | "ABANDONED";
export type ActionKind = "ADD_MENTOR" | "CS_ASSESSMENT" | "PROTOTYPING_ASSESSMENT" | "SCHEDULE_MEETING" | "INTRODUCE_SRM";

export interface GroupCase {
  id: string;
  chat_id: string;
  group_name: string;
  student_name: string;
  student_phone: string | null;
  student_email: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  project_name: string | null;
  /** Chosen first; every other action waits on it. Locked once a POC owner is set. */
  program_code: ProgramCode | null;
  /** Permanent once set (first answer wins). */
  poc_owner_id: string | null;
  source: string | null;
  sheet_row: number | null;
  invite_link: string | null;
  stage: Stage;
  mentor_name: string | null;
  mentor_intro_sent_at: string | null;
  /** RBP only: a second mentor who becomes the COSMIC project mentor. */
  research_mentor_name: string | null;
  research_mentor_intro_sent_at: string | null;
  pending_research_mentor_name: string | null;
  pending_research_mentor_since: string | null;
  pending_mentor_name: string | null;
  pending_mentor_since: string | null;
  mentor_joined_at: string | null;
  first_class_confirmed_at: string | null;
  operations_stopped_at: string | null;
  operations_stopped_by: string | null;
  operations_stopped_reason: string | null;
  last_nudged_at: string | null;
  nudge_count: number;
  created_at: string;
  updated_at: string;
}

export interface CaseSummary extends GroupCase {
  last_action_kind: ActionKind | null;
  last_action_at: string | null;
}

export interface CaseAction {
  id: string;
  case_id: string;
  kind: ActionKind;
  status: "PENDING" | "OK" | "FAILED";
  detail: Record<string, unknown> | null;
  error: string | null;
  actor: string | null;
  created_at: string;
}

export type ProgramCode = "PPP" | "RBP" | "CMP";
export const PROGRAM_CODES: ProgramCode[] = ["PPP", "RBP", "CMP"];

export interface PocOwner {
  id: string;
  name: string;
  email: string | null;
}

export interface Mentor {
  name: string;
  intro: string;
  variants?: Record<string, string>;
  email?: string | null;
  phone?: string | null;
}

export type SetupStepStatus = "PENDING" | "OK" | "FAILED" | "SKIPPED";
export interface ProjectSetup {
  case_id: string;
  project_title: string | null;
  project_description: string | null;
  curriculum_subject: string | null;
  submitted_at: string | null;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  step_whatsapp: SetupStepStatus;
  step_whatsapp_drive_link: SetupStepStatus;
  step_sync: SetupStepStatus;
  step_drive: SetupStepStatus;
  step_mentor_access: SetupStepStatus;
  step_curriculum: SetupStepStatus;
  step_cosmic_student: SetupStepStatus;
  step_cosmic_project: SetupStepStatus;
  step_cosmic_sync_group: SetupStepStatus;
  drive_folder_url: string | null;
  poc_status: ProjectSetup["status"];
  step_poc_drive: SetupStepStatus;
  step_poc_drive_access: SetupStepStatus;
  step_cosmic_poc_project: SetupStepStatus;
  cosmic_poc_project_id: string | null;
  research_status: ProjectSetup["status"];
  step_research_drive_access: SetupStepStatus;
  step_cosmic_research_mentor: SetupStepStatus;
  last_error: string | null;
}

export interface QueuedAction {
  id: string;
  case_id: string;
  position: number;
  kind: ActionKind;
  params: Record<string, unknown>;
  status: "QUEUED" | "SENT" | "FAILED" | "CANCELLED";
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface PhoneChangeResult {
  case: GroupCase;
  role: "student" | "parent";
  phone: string;
  unchanged: boolean;
  participant: { status: string; mode?: string; joined?: boolean };
  sync: { status: string; reason?: string; name?: string };
}

/** Mirrors the backend's bookingHosts(). */
export const MEETING_HOSTS = [
  "Aashna Saraf",
  "Urja Jhaveri",
  "Dhruv Singh",
  "Dhruv + Aashna",
  "Urja + Aashna",
  "Dhruv + Omm",
  "Urja + Omm",
  "Aashna + Omm",
  "Dhruv + Rajshree",
  "Urja + Rajshree",
  "Aashna + Rajshree",
] as const;

/** Mirrors the backend's config.srm.people. */
export const SRMS = ["Riya", "Rashi"] as const;

// ---------------------------------------------------------------- Fetching

export class OpsError extends Error {
  constructor(message: string, readonly status: number, readonly suggestions?: string[]) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    const hints: string[] | undefined = data?.suggestions ?? data?.available;
    const message = (data?.error ?? `Request failed (${res.status})`) + (hints?.length ? ` Did you mean: ${hints.join(", ")}?` : "");
    throw new OpsError(message, res.status, hints);
  }
  return data as T;
}

const enc = encodeURIComponent;
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

/**
 * A key per instruction, so a retry after a hung request doesn't send the
 * family the same message twice. The ten-minute bucket still allows a
 * deliberate re-send later.
 */
function idempotencyKey(caseId: string, parts: (string | undefined)[]): string {
  return [caseId, ...parts.filter(Boolean), Math.floor(Date.now() / 600_000)].join("|");
}

export type ActionBody =
  | { kind: "ADD_MENTOR"; mentor: string; variant?: string }
  | { kind: "CS_ASSESSMENT"; deadline: string }
  | { kind: "PROTOTYPING_ASSESSMENT"; deadline: string }
  | { kind: "SCHEDULE_MEETING"; host: string }
  | { kind: "INTRODUCE_SRM"; srm: string };

export type QueueBody =
  | { kind: "ADD_MENTOR"; mentor: string; variant?: string }
  | { kind: "CS_ASSESSMENT"; deadline_days: number }
  | { kind: "PROTOTYPING_ASSESSMENT"; deadline_days: number }
  | { kind: "SCHEDULE_MEETING"; host: string }
  | { kind: "INTRODUCE_SRM"; srm: string };

export const ops = {
  sendAction: (caseId: string, body: ActionBody) =>
    request<{ case: GroupCase; action: CaseAction; replayed: boolean }>(
      `/api/cases/${enc(caseId)}/actions`,
      post({ ...body, idempotency_key: idempotencyKey(caseId, Object.values(body).map(String)) }),
    ),
  queueAction: (caseId: string, body: QueueBody) => request<QueuedAction>(`/api/cases/${enc(caseId)}/queue`, post(body)),
  cancelQueued: (caseId: string, queuedId: string) =>
    request<void>(`/api/cases/${enc(caseId)}/queue/${enc(queuedId)}`, { method: "DELETE" }),
  preview: (caseId: string, body: ActionBody) => request<{ message: string }>(`/api/cases/${enc(caseId)}/preview`, post(body)),
  saveProjectSetup: (caseId: string, body: { project_title: string; project_description: string; curriculum_subject?: string }) =>
    request<ProjectSetup>(`/api/cases/${enc(caseId)}/project-setup`, post(body)),
  changePhone: (caseId: string, role: "student" | "parent", phone: string) =>
    request<PhoneChangeResult>(`/api/cases/${enc(caseId)}/phone`, { method: "PATCH", body: JSON.stringify({ role, phone }) }),
  stop: (caseId: string, reason?: string) =>
    request<{ case: GroupCase; cancelled: number; already_stopped: boolean }>(
      `/api/cases/${enc(caseId)}/stop`,
      post(reason ? { reason } : {}),
    ),
  setProgramme: (caseId: string, programCode: ProgramCode) =>
    request<GroupCase>(`/api/cases/${enc(caseId)}/programme`, { method: "PUT", body: JSON.stringify({ program_code: programCode }) }),
  assignPocOwner: (caseId: string, pocOwnerId: string) =>
    request<{ case: GroupCase; owner: PocOwner; assigned: boolean }>(`/api/cases/${enc(caseId)}/poc-owner`, post({ poc_owner_id: pocOwnerId })),
  assignResearchMentor: (caseId: string, mentor: string, variant?: string) =>
    request<{ case: GroupCase; held: boolean; warnings: string[] }>(
      `/api/cases/${enc(caseId)}/research-mentor`,
      post({ mentor, ...(variant ? { variant } : {}) }),
    ),
  createMentor: (body: { name: string; intro: string; email?: string; phone: string; variants?: Record<string, string> }) =>
    request<Mentor>("/api/mentors", post(body)),
  updateMentor: (name: string, body: { intro?: string; email?: string | null; phone?: string | null; variants?: Record<string, string> | null }) =>
    request<Mentor>(`/api/mentors/${enc(name)}`, { method: "PATCH", body: JSON.stringify(body) }),
};

// ---------------------------------------------------------------- Hooks

export const useCases = (options?: SWRConfiguration) => useSWR("cases", () => request<CaseSummary[]>("/api/cases"), options);

export const useCase = (id: string) =>
  useSWR(["case", id], async () => {
    try {
      return await request<GroupCase>(`/api/cases/${enc(id)}`);
    } catch (err) {
      // A missing group is an empty state, not an error.
      if (err instanceof OpsError && err.status === 404) return null;
      throw err;
    }
  });

export const useCaseActions = (id: string) => useSWR(["case-actions", id], () => request<CaseAction[]>(`/api/cases/${enc(id)}/actions`));
export const useQueue = (id: string) => useSWR(["queue", id], () => request<QueuedAction[]>(`/api/cases/${enc(id)}/queue`));
export const useMentors = () => useSWR("mentors", () => request<Mentor[]>("/api/mentors"));
export const usePocOwners = () => useSWR("poc-owners", () => request<PocOwner[]>("/api/poc-owners"));
export const useProjectSetup = (id: string | null) =>
  useSWR(id ? ["project-setup", id] : null, () => request<ProjectSetup | null>(`/api/cases/${enc(id as string)}/project-setup`));
export const useCurriculumSubjects = () =>
  useSWR("curriculum-subjects", async () => (await request<{ subjects: string[] }>("/api/curriculum-subjects")).subjects);

/**
 * The message an action would send, rendered by the backend's own templates,
 * so the preview can never drift from what the family receives.
 */
export function useMessagePreview(caseId: string, body: ActionBody | null) {
  const { data, error, isLoading } = useSWR(
    body ? ["preview", caseId, JSON.stringify(body)] : null,
    async () => (await ops.preview(caseId, body as ActionBody)).message,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  return { message: data ?? null, error: error instanceof Error ? error.message : null, isLoading };
}

// ---------------------------------------------------------------- Labels

export const STAGE_LABELS: Record<Stage, string> = {
  AWAITING_JOIN: "Awaiting join",
  NEW: "New",
  IN_PROGRESS: "In progress",
  AWAITING_MENTOR_JOIN: "Awaiting mentor join",
  MENTOR_ASSIGNED: "Mentor assigned",
  ABANDONED: "Abandoned",
};

export const STAGE_STYLES: Record<Stage, { badge: string; dot: string }> = {
  AWAITING_JOIN: { badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300", dot: "bg-slate-400" },
  NEW: { badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  IN_PROGRESS: { badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
  AWAITING_MENTOR_JOIN: { badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  MENTOR_ASSIGNED: { badge: "bg-done/15 text-done", dot: "bg-done" },
  ABANDONED: { badge: "bg-soft text-muted", dot: "bg-line" },
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  ADD_MENTOR: "Introduced mentor",
  CS_ASSESSMENT: "Sent Computer Science assessment",
  PROTOTYPING_ASSESSMENT: "Sent Prototyping assessment",
  SCHEDULE_MEETING: "Sent booking link",
  INTRODUCE_SRM: "Introduced SRM",
};

export const ACTION_SHORT: Record<ActionKind, string> = {
  ADD_MENTOR: "Mentor intro",
  CS_ASSESSMENT: "CS assessment",
  PROTOTYPING_ASSESSMENT: "Prototyping",
  SCHEDULE_MEETING: "Booking link",
  INTRODUCE_SRM: "SRM intro",
};

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const label = mins < 1 ? "" : mins < 60 ? `${mins}m` : hours < 24 ? `${hours}h` : days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
  if (!label) return "just now";
  return diff < 0 ? `in ${label}` : `${label} ago`;
}

export function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  return Number.isNaN(then) ? 0 : Math.floor((Date.now() - then) / 86400000);
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const digits = raw.replace(/[^\d+]/g, "");
  const m = digits.match(/^\+?91?(\d{5})(\d{5})$/);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

/**
 * A picked day as YYYY-MM-DD on the local calendar. Not toISOString(), which
 * converts to UTC first and moves an IST deadline back a day.
 */
export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
