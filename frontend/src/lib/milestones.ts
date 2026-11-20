/** The programme stages in order. Progress reports are shown separately. */
export const STAGES: { type: string; label: string; short: string; optional?: boolean }[] = [
  { type: "enrolled", label: "Enrolled", short: "Enrolled" },
  { type: "first_consult_done", label: "First consult done", short: "Consult" },
  { type: "scope_call", label: "Scope call with SRM", short: "Scope call", optional: true },
  { type: "project_confirmed", label: "Project confirmed", short: "Project" },
  { type: "scope_available", label: "Scope approved", short: "Scope" },
  { type: "comps_suggested", label: "Competitions suggested", short: "Comps" },
  { type: "competition_entered", label: "Competition entered", short: "Entered" },
  { type: "midway_call", label: "Mid-programme review", short: "Midway" },
  { type: "competition_outcome", label: "Competition outcome", short: "Outcome" },
  { type: "closure_call", label: "Closure call", short: "Closure" },
];

export const LABELS: Record<string, string> = {
  ...Object.fromEntries(STAGES.map((s) => [s.type, s.label])),
  progress_report: "Progress report",
};

export function fmtDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function displayName(s: { student_name: string | null; student_email: string | null; parent_email: string | null }) {
  return s.student_name || s.student_email || s.parent_email || "Unnamed";
}

/** The LLM progress update's statuses. */
export const PROGRESS: Record<string, { label: string; className: string }> = {
  on_track: { label: "On track", className: "bg-done/15 text-done" },
  ahead: { label: "Ahead", className: "bg-accent/15 text-accent" },
  lagging: { label: "Lagging", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  not_started: { label: "Not started", className: "bg-soft text-muted" },
  unknown: { label: "Not assessed", className: "bg-soft text-muted" },
};

/** COSMIC competition section statuses, in pipeline order. */
export const SECTION_STATUS: Record<string, { label: string; className: string; bar: string }> = {
  approved: { label: "Approved", className: "bg-done/15 text-done", bar: "bg-done" },
  submitted: { label: "Awaiting approval", className: "bg-accent/15 text-accent", bar: "bg-accent" },
  changes_required: { label: "Changes required", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400", bar: "bg-amber-500" },
  in_progress: { label: "In progress", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300", bar: "bg-violet-500" },
  not_started: { label: "Not started", className: "bg-soft text-muted", bar: "bg-line" },
};

export const SECTION_ORDER = ["approved", "submitted", "changes_required", "in_progress", "not_started"] as const;

export const pctOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
