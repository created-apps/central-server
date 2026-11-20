/**
 * The LLM progress update: on track / ahead / lagging / not started, with a
 * headline, reason and recent work. A port of the booking platform's
 * assessment (backend/app/services/student_progress.py): same prompt, same
 * schema, same rule that Claude is only asked again when the inputs change.
 */
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

const RECENT_SUMMARIES = 12;
export const STATUS_VALUES = ["on_track", "ahead", "lagging", "not_started"] as const;

const PROGRESS_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: [...STATUS_VALUES] },
    headline: { type: "string" },
    reason: { type: "string" },
    recent_work: { type: "string" },
  },
  required: ["status", "headline", "reason", "recent_work"],
  additionalProperties: false,
} as const;

const SYSTEM = `You assess the progress of a school student in CreatED's mentored project \
programme, for the student's education counsellor (an external partner, not CreatED staff).

You get the student's mentoring sessions from the scheduling system (dates and status: \
completed, cancelled, scheduled) and the summaries written after completed sessions (what \
was covered and the homework set). Sometimes you also get the project's start and end dates \
and a planned total number of sessions.

Decide one status:
- on_track: sessions are happening at a steady cadence and the summaries show the project \
moving forward.
- ahead: work is clearly further along than the cadence or plan would suggest (for example \
deliverables done early, or more sessions completed than planned for this point).
- lagging: long gaps between completed sessions, repeated cancellations, the same homework \
or problem recurring across sessions without progress, or completed sessions well behind \
the planned total for the elapsed time.
- not_started: no completed mentoring sessions yet.

Base the judgement only on the records given. When planned totals or dates are missing, \
judge from cadence and the content of the summaries. Recent sessions matter more than old \
ones.

Write for the counsellor: plain, specific and neutral, without blaming the student or \
mentor, and without internal jargon, mentor names or meeting-type labels.
- headline: at most 12 words.
- reason: 2-3 sentences explaining the status with concrete evidence (dates, counts, what \
changed).
- recent_work: 1-2 sentences on what the student worked on most recently.`;

const PROGRAMME_NAMES: Record<string, string> = {
  PPP: "Passion Project Program (PPP)",
  RBP: "Research + Build (RBP)",
};

export interface SessionCounts {
  completed: number;
  cancelled: number;
  scheduled: number;
  lastSessionDate: string | null;
  nextSessionDate: string | null;
}

export interface ProgressInput {
  counts: SessionCounts;
  planned: number | null;
  prompt: string;
  hash: string;
}

export interface ProgressResult {
  status: string;
  headline: string;
  reason: string;
  recentWork: string | null;
  model: string | null;
}

const day = (v: unknown) => String(v ?? "").slice(0, 10);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function sessionCounts(meetings: Record<string, any>[], today: string): SessionCounts {
  const status = (m: Record<string, any>) => String(m.status ?? "").toLowerCase();
  const completed = meetings.filter((m) => status(m) === "completed");
  const upcoming = meetings.filter((m) => status(m) === "scheduled" && isDay(day(m.meeting_date)) && day(m.meeting_date) >= today);
  const doneDates = completed.map((m) => day(m.meeting_date)).filter(isDay).sort();
  const nextDates = upcoming.map((m) => day(m.meeting_date)).filter(isDay).sort();
  return {
    completed: completed.length,
    cancelled: meetings.filter((m) => status(m) === "cancelled").length,
    scheduled: upcoming.length,
    lastSessionDate: doneDates.at(-1) ?? null,
    nextSessionDate: nextDates[0] ?? null,
  };
}

export function buildProgressInput(args: {
  studentName: string;
  programme: string;
  project: Record<string, any> | null;
  meetings: Record<string, any>[];
  summaries: Record<string, any>[];
}): ProgressInput {
  const today = new Date().toISOString().slice(0, 10);
  const project = args.project ?? {};
  const counts = sessionCounts(args.meetings, today);
  const programme = PROGRAMME_NAMES[args.programme.trim().toUpperCase()] ?? args.programme;
  const lines = [
    `Today: ${today}`,
    `Student: ${args.studentName}`,
    `Programme: ${programme || "not recorded"}`,
    `Project: ${project.project_name || "not recorded"}`,
    `Project start: ${project.start_date || "not recorded"}`,
    `Project end: ${project.end_date || "not recorded"}`,
    `Planned total sessions: ${project.planned_total_sessions || "not recorded"}`,
    "",
    `Completed sessions: ${counts.completed}`,
    `Cancelled sessions: ${counts.cancelled}`,
    `Upcoming scheduled sessions: ${counts.scheduled}`,
    "",
    "All sessions (date, status):",
    ...(args.meetings.length ? args.meetings.map((m) => `- ${m.meeting_date} ${m.status}`) : ["- none"]),
  ];
  const recent = args.summaries.slice(-RECENT_SUMMARIES);
  lines.push("", `Session summaries (most recent ${recent.length} of ${args.summaries.length}, oldest first):`);
  for (const s of recent) {
    lines.push(`### ${day(s.meeting_started_at || s.created_at)}`);
    lines.push(`Summary: ${String(s.summary ?? "").trim() || "(none)"}`);
    const homework = String(s.homework ?? "").trim();
    if (homework) lines.push(`Homework: ${homework}`);
  }
  if (!args.summaries.length) lines.push("- none");
  const prompt = lines.join("\n");
  // The date line changes daily; leave it out so an idle child is not re-assessed every day.
  const stable = lines.filter((l) => !l.startsWith("Today:")).join("\n");
  const planned = Number(project.planned_total_sessions);
  return {
    counts,
    planned: Number.isFinite(planned) && planned > 0 ? planned : null,
    prompt,
    hash: createHash("sha256").update(stable).digest("hex"),
  };
}

export function progressConfigured(): boolean {
  return Boolean(config.anthropicApiKey);
}

let client: Anthropic | null = null;

/** One structured-output call. Throws when Claude declines or the output is unusable. */
async function askClaude(prompt: string): Promise<ProgressResult> {
  client ??= new Anthropic({ apiKey: config.anthropicApiKey });
  const stream = client.beta.messages.stream({
    model: config.progressModel,
    max_tokens: 4000,
    // On a policy decline the API re-runs the request on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: PROGRESS_SCHEMA } },
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (message.stop_reason === "max_tokens") throw new Error("Claude output hit max_tokens");
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Claude returned no text");
  const parsed = JSON.parse(text.text) as Record<string, unknown>;
  const status = STATUS_VALUES.includes(parsed.status as any) ? String(parsed.status) : "unknown";
  return {
    status,
    headline: String(parsed.headline ?? "").slice(0, 300),
    reason: String(parsed.reason ?? ""),
    recentWork: String(parsed.recent_work ?? "") || null,
    model: message.model,
  };
}

/**
 * The assessment for one child, or null to keep the stored one. Claude is
 * only asked when the inputs changed (or there is no stored assessment).
 */
export async function assessProgress(
  input: ProgressInput,
  previousHash: string | null,
): Promise<ProgressResult | null> {
  if (input.counts.completed === 0) {
    const next = input.counts.nextSessionDate;
    return {
      status: "not_started",
      headline: "Mentoring sessions have not started yet",
      reason:
        "No completed mentoring sessions are recorded yet." +
        (next ? ` The next session is on ${new Date(next).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}.` : ""),
      recentWork: null,
      model: null,
    };
  }
  if (previousHash === input.hash || !progressConfigured()) return null;
  try {
    return await askClaude(input.prompt);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn("Progress assessment rate limited; retried next sync");
    else if (err instanceof Anthropic.APIError) console.warn(`Progress assessment API error ${err.status}: ${err.message}`);
    else console.warn(`Progress assessment failed: ${(err as Error).message}`);
    return null;
  }
}
