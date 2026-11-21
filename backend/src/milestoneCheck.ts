/**
 * The LLM milestone check: given a child and a list of milestones, Claude
 * decides which are done, using the child's approved project scope and the
 * text of their progress reports (exported from Google Docs) as evidence.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { db } from "./db.js";
import { driveConfigured, exportReportText } from "./sources/drive.js";

export const MILESTONE_STATUSES = ["completed", "in_progress", "not_started", "unclear"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;

const MAX_MILESTONES = 50;
const MAX_REPORTS = 8; // most recent reports read
const REPORT_CHARS = 15_000; // per report
const SCOPE_CHARS = 20_000;

export class MilestoneCheckError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface MilestoneInput {
  id: string;
  title: string;
  description: string | null;
}

export interface CheckRequest {
  studentEmail: string;
  milestones: MilestoneInput[];
}

/** Validates the request body. Milestones may be strings or {id?, title, description?}. */
export function parseCheckRequest(body: unknown): CheckRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.student_email === "string" ? b.student_email.trim().toLowerCase() : "";
  // Strict: the email goes into a PostgREST or() filter.
  if (!/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) throw new MilestoneCheckError("A valid student_email is required");
  if (!Array.isArray(b.milestones) || b.milestones.length === 0) {
    throw new MilestoneCheckError("milestones must be a non-empty array");
  }
  if (b.milestones.length > MAX_MILESTONES) throw new MilestoneCheckError(`At most ${MAX_MILESTONES} milestones per request`);
  const seen = new Set<string>();
  const milestones = b.milestones.map((m, i): MilestoneInput => {
    const item = typeof m === "string" ? { title: m } : ((m ?? {}) as Record<string, unknown>);
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) throw new MilestoneCheckError(`milestones[${i}].title is required`);
    const id = item.id === undefined || item.id === null || item.id === "" ? String(i + 1) : String(item.id).trim();
    if (seen.has(id)) throw new MilestoneCheckError(`Duplicate milestone id "${id}"`);
    seen.add(id);
    const description = typeof item.description === "string" && item.description.trim() ? item.description.trim() : null;
    return { id: id.slice(0, 100), title: title.slice(0, 300), description: description?.slice(0, 2000) ?? null };
  });
  return { studentEmail: email, milestones };
}

const SYSTEM = `You check which project milestones a school student in CreatED's mentored \
project programme has completed.

You get:
- the student's approved project scope (what the project is meant to deliver), when available;
- the text of the student's progress reports, written by their mentor, oldest first;
- a list of milestones to check, each with an id, a title and sometimes a description.

For each milestone decide one status:
- completed: the reports clearly state the work for this milestone is done or delivered.
- in_progress: the reports show work started on it but not finished.
- not_started: the reports and scope give no sign the work has begun, or say it is planned for later.
- unclear: the milestone cannot be judged from the records (for example it is ambiguous, or \
unrelated to anything in the scope or reports).

Rules:
- Base every judgement only on the records given. Do not assume a milestone is done because \
a later one is, unless the reports say so.
- Use the scope to understand what a milestone means for this project; the scope alone is \
never evidence that work was done.
- Later reports override earlier ones.
- confidence: high when a report states it directly, medium when it is strongly implied, low otherwise.
- evidence: 1-2 sentences citing what the reports say (paraphrase or a short quote, with the \
report number when known). Empty string when there is none.
- source_reports: the report numbers the evidence comes from (empty when none).
- Return every milestone id exactly once, in the order given.`;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    milestones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: [...MILESTONE_STATUSES] },
          confidence: { type: "string", enum: [...CONFIDENCE] },
          evidence: { type: "string" },
          source_reports: { type: "array", items: { type: "integer" } },
        },
        required: ["id", "status", "confidence", "evidence", "source_reports"],
        additionalProperties: false,
      },
    },
    overall_summary: { type: "string" },
  },
  required: ["milestones", "overall_summary"],
  additionalProperties: false,
} as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);

interface ReportText {
  reportNo: number | null;
  reportDate: string | null;
  docId: string;
  text: string | null;
  error: string | null;
}

async function loadReports(studentId: string): Promise<ReportText[]> {
  const { data, error } = await db
    .from("progress_reports")
    .select("doc_id,report_no,report_date")
    .eq("student_id", studentId)
    .order("report_no", { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);
  const recent = (data ?? []).slice(-MAX_REPORTS);
  if (!recent.length) return [];
  if (!driveConfigured()) throw new MilestoneCheckError("Drive export is not configured, so progress reports cannot be read", 503);
  return Promise.all(
    recent.map(async (r): Promise<ReportText> => {
      const base = { reportNo: r.report_no ?? null, reportDate: r.report_date ?? null, docId: r.doc_id };
      try {
        const { text } = await exportReportText(r.doc_id);
        return { ...base, text, error: null };
      } catch (err) {
        return { ...base, text: null, error: (err as Error).message };
      }
    }),
  );
}

function buildPrompt(student: Record<string, any>, reports: ReportText[], milestones: MilestoneInput[]): string {
  const scopeParts = [
    `Project: ${student.project_name || "not recorded"}`,
    `Scope title: ${student.scope_title || "not recorded"}`,
    `Scope summary: ${student.scope_summary || "not recorded"}`,
  ];
  if (student.scope_json) scopeParts.push(`Full scope document (JSON):\n${clip(JSON.stringify(student.scope_json), SCOPE_CHARS)}`);
  const lines = [
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    `Programme: ${student.program || "not recorded"}`,
    "",
    "<scope>",
    ...scopeParts,
    "</scope>",
    "",
    `<progress_reports count="${reports.filter((r) => r.text).length}">`,
  ];
  for (const r of reports) {
    if (!r.text) continue;
    lines.push(`<report number="${r.reportNo ?? "?"}" date="${r.reportDate ?? "unknown"}">`, clip(r.text, REPORT_CHARS), "</report>");
  }
  if (!reports.some((r) => r.text)) lines.push("(no progress reports available)");
  lines.push("</progress_reports>", "", "<milestones>");
  for (const m of milestones) {
    lines.push(`- id: ${JSON.stringify(m.id)}\n  title: ${m.title}${m.description ? `\n  description: ${m.description}` : ""}`);
  }
  lines.push("</milestones>");
  return lines.join("\n");
}

let client: Anthropic | null = null;

async function askClaude(prompt: string) {
  client ??= new Anthropic({ apiKey: config.anthropicApiKey });
  const stream = client.beta.messages.stream({
    model: config.progressModel,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: RESULT_SCHEMA } },
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new MilestoneCheckError("Claude declined the request", 502);
  if (message.stop_reason === "max_tokens") throw new MilestoneCheckError("Claude output hit max_tokens; send fewer milestones", 502);
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new MilestoneCheckError("Claude returned no text", 502);
  return { parsed: JSON.parse(text.text) as { milestones: any[]; overall_summary: string }, model: message.model };
}

export async function checkMilestones(req: CheckRequest) {
  if (!config.anthropicApiKey) throw new MilestoneCheckError("ANTHROPIC_API_KEY is not set on the tracker backend", 503);
  const { data: student, error } = await db
    .from("students")
    .select("id,student_email,student_name,program,project_name,scope_title,scope_summary,scope_json,scope_approved")
    .or(`student_email.eq.${req.studentEmail},key.eq.${req.studentEmail}`)
    .order("in_sheet", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!student) throw new MilestoneCheckError("Student not found", 404);

  const reports = await loadReports(student.id);
  const hasScope = Boolean(student.scope_title || student.scope_summary || student.scope_json);
  const readable = reports.filter((r) => r.text);
  if (!hasScope && !readable.length) {
    throw new MilestoneCheckError("This student has no scope or readable progress reports to check against", 422);
  }

  const { parsed, model } = await askClaude(buildPrompt(student, reports, req.milestones));
  const byId = new Map((parsed.milestones ?? []).map((m) => [String(m.id), m]));
  const results = req.milestones.map((m) => {
    const r = byId.get(m.id);
    const status = MILESTONE_STATUSES.includes(r?.status) ? r.status : "unclear";
    return {
      id: m.id,
      title: m.title,
      status,
      completed: status === "completed",
      confidence: CONFIDENCE.includes(r?.confidence) ? r.confidence : "low",
      evidence: String(r?.evidence ?? ""),
      source_reports: Array.isArray(r?.source_reports) ? r.source_reports.filter(Number.isInteger) : [],
    };
  });
  const count = (s: string) => results.filter((r) => r.status === s).length;

  return {
    student: { email: student.student_email, name: student.student_name, project_name: student.project_name },
    evaluated_at: new Date().toISOString(),
    model,
    sources: {
      scope_available: hasScope,
      scope_approved: Boolean(student.scope_approved),
      reports_used: readable.map((r) => ({ report_no: r.reportNo, report_date: r.reportDate })),
      reports_failed: reports.filter((r) => !r.text).map((r) => ({ report_no: r.reportNo, error: r.error })),
    },
    summary: {
      total: results.length,
      completed: count("completed"),
      in_progress: count("in_progress"),
      not_started: count("not_started"),
      unclear: count("unclear"),
      overall: String(parsed.overall_summary ?? ""),
    },
    milestones: results,
  };
}
