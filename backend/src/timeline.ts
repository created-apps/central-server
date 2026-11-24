/**
 * POST /api/students/timeline: a child's timeline, as the dashboard's child
 * page shows it, with their latest progress report attached as a PDF.
 *
 * The request is form-data (or JSON) with student_email. The response is
 * multipart/form-data with two parts:
 *   - "timeline": application/json, the student and their timeline entries
 *   - "progress_report": the latest report as application/pdf (left out when
 *     the child has no report, or Drive could not export it; "timeline" then
 *     says why)
 */
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db.js";
import { exportReportPdf, pdfFilename } from "./sources/drive.js";
import { listReports } from "./reportPdf.js";
import { findStudentByEmail, normaliseEmail } from "./studentLookup.js";

/** Same labels as the dashboard (frontend/src/lib/milestones.ts). */
const LABELS: Record<string, string> = {
  enrolled: "Enrolled",
  first_consult_done: "First consult done",
  scope_call: "Scope call with SRM",
  project_confirmed: "Project confirmed",
  scope_available: "Scope approved",
  comps_suggested: "Competitions suggested",
  competition_entered: "Competition entered",
  midway_call: "Mid-programme review",
  competition_outcome: "Competition outcome",
  closure_call: "Closure call",
  progress_report: "Progress report",
};

/** "6 Nov 2026", as the dashboard shows dates (India time). */
function fmtDate(value: unknown, withTime = false): string {
  if (!value) return "";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

const join = (...parts: unknown[]) => parts.map((p) => String(p ?? "").trim()).filter(Boolean).join(" · ");

/** The line under each entry's title, matching the dashboard's MilestoneDetails. */
function describe(type: string, d: Record<string, any>): { text: string; items?: { name: string; url: string | null; note: string | null }[] } {
  switch (type) {
    case "enrolled":
      return { text: join(d.program, d.track) };
    case "first_consult_done":
      return { text: d.mentor ? `With ${d.mentor}` : "" };
    case "scope_call":
    case "midway_call":
      return { text: fmtDate(d.start, true) };
    case "project_confirmed":
      return { text: String(d.projectName ?? "") };
    case "scope_available":
      return { text: String(d.title || d.projectName || "") };
    case "comps_suggested": {
      const items = (Array.isArray(d.competitions) ? d.competitions : []).map((c: any) => ({
        name: String(c?.name ?? ""),
        url: c?.url ? String(c.url) : null,
        note: c?.deadline ? String(c.deadline) : null,
      }));
      return { text: items.map((c: { name: string; note: string | null }) => join(c.name, c.note)).join("\n"), items };
    }
    case "competition_entered":
      return { text: String(d.competition ?? "") };
    case "competition_outcome":
      return { text: [d.competition, d.outcome].filter(Boolean).join(": ") };
    case "closure_call":
      return { text: join(fmtDate(d.start || d.date, Boolean(d.start)), d.outcome) };
    case "progress_report":
      return {
        text: join(
          d.reportNo != null ? `Report ${d.reportNo}` : "Report",
          d.sessionsCompleted != null ? `${d.sessionsCompleted} sessions` : "",
        ),
      };
    default:
      return { text: "" };
  }
}

/** A multipart/form-data body from text/JSON fields and files. */
function multipart(parts: { name: string; contentType: string; body: Buffer | string; filename?: string }[]) {
  const boundary = `----milestones${randomBytes(12).toString("hex")}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = `form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ""}`;
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: ${p.contentType}\r\n\r\n`),
      Buffer.isBuffer(p.body) ? p.body : Buffer.from(p.body, "utf8"),
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(chunks) };
}

export async function sendTimeline(req: Request, res: Response, next: NextFunction) {
  try {
    const email = normaliseEmail((req.body ?? {}).student_email);
    if (!email) return res.status(400).json({ error: "A valid student_email is required" });

    const student = await findStudentByEmail(
      email,
      "id,student_email,parent_email,student_name,program,track,project_name,scope_title,progress_status,progress_headline,last_synced_at",
    );
    if (!student) return res.status(404).json({ error: "Student not found" });

    const [{ data: rows, error }, reports] = await Promise.all([
      db.from("milestones").select("event_type,external_ref,occurred_at,first_seen_at,details").eq("student_id", student.id),
      listReports(student.id),
    ]);
    if (error) throw new Error(error.message);

    // Newest first, undated entries by when the sync first saw them: the dashboard's order.
    const timeline = (rows ?? [])
      .sort((a, b) => String(b.occurred_at || b.first_seen_at).localeCompare(String(a.occurred_at || a.first_seen_at)))
      .map((m) => {
        const { text, items } = describe(m.event_type, m.details ?? {});
        return {
          type: m.event_type,
          label: LABELS[m.event_type] ?? m.event_type,
          date: m.occurred_at ?? null,
          date_display: m.occurred_at ? fmtDate(m.occurred_at) : "date unknown",
          text,
          ...(items ? { items } : {}),
          ...(m.event_type === "progress_report"
            ? { report_no: m.details?.reportNo ?? null, sessions_completed: m.details?.sessionsCompleted ?? null }
            : {}),
          details: m.details ?? {},
        };
      });

    // The latest report, as a PDF part.
    const latest = reports.at(-1) ?? null;
    let pdf: { filename: string; body: Buffer } | null = null;
    let reportError: string | null = latest ? null : "This student has no progress reports";
    if (latest) {
      try {
        const { name, pdf: body } = await exportReportPdf(latest.doc_id);
        pdf = { filename: pdfFilename(name), body };
      } catch (err) {
        reportError = (err as Error).message;
      }
    }

    const data = {
      student: {
        email: student.student_email,
        parent_email: student.parent_email,
        name: student.student_name,
        program: student.program,
        track: student.track,
        project_name: student.project_name,
        scope_title: student.scope_title,
        progress_status: student.progress_status,
        progress_headline: student.progress_headline,
        last_synced_at: student.last_synced_at,
      },
      timeline,
      latest_report: latest
        ? {
            report_no: latest.report_no,
            report_date: latest.report_date,
            sessions_completed: latest.sessions_completed,
            attached: Boolean(pdf),
            field: pdf ? "progress_report" : null,
            filename: pdf?.filename ?? null,
            error: reportError,
          }
        : { attached: false, field: null, error: reportError },
    };

    const parts: Parameters<typeof multipart>[0] = [
      { name: "timeline", contentType: "application/json; charset=utf-8", body: JSON.stringify(data) },
    ];
    if (pdf) parts.push({ name: "progress_report", contentType: "application/pdf", filename: pdf.filename, body: pdf.body });
    const out = multipart(parts);
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(out.body);
  } catch (err) {
    next(err);
  }
}
