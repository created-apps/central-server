/**
 * POST /api/progress-reports/pdf: a child's progress report as a PDF, for
 * other services. The body is multipart/form-data with student_email and an
 * optional report_no (the latest report when left out). The PDF is exported
 * from Drive by the service account, under the same Shared Drive checks as
 * the dashboard's own report download.
 */
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { db } from "./db.js";
import { DriveExportError, exportReportPdf, pdfFilename } from "./sources/drive.js";
import { findStudentByEmail, normaliseEmail } from "./studentLookup.js";

/** Text fields only: a file part is refused, and fields are kept small. */
const fields = multer({ limits: { files: 0, fields: 5, fieldSize: 1024, parts: 5 } }).none();

/** Parses a form-data body (text fields only), turning a malformed one into a 400. Other bodies pass through untouched. */
export function parseFormFields(req: Request, res: Response, next: NextFunction) {
  fields(req, res, (err: unknown) => {
    if (!err) return next();
    const message = err instanceof multer.MulterError ? `Bad form-data: ${err.message}` : "Bad form-data body";
    res.status(400).json({ error: message });
  });
}

interface ReportRow {
  doc_id: string;
  report_no: number | null;
  report_date: string | null;
}

export async function sendReportPdf(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.is("multipart/form-data")) {
      return res.status(415).json({ error: "Send the body as multipart/form-data" });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = normaliseEmail(body.student_email);
    if (!email) return res.status(400).json({ error: "A valid student_email is required" });

    const rawNo = typeof body.report_no === "string" ? body.report_no.trim() : "";
    let reportNo: number | null = null;
    if (rawNo && rawNo.toLowerCase() !== "latest") {
      reportNo = Number(rawNo);
      if (!Number.isInteger(reportNo) || reportNo < 1) {
        return res.status(400).json({ error: "report_no must be a positive whole number, or \"latest\"" });
      }
    }

    const student = await findStudentByEmail<{ id: string }>(email, "id");
    if (!student) return res.status(404).json({ error: "Student not found" });

    const { data, error } = await db
      .from("progress_reports")
      .select("doc_id,report_no,report_date")
      .eq("student_id", student.id)
      .order("report_no", { ascending: true, nullsFirst: true })
      .order("report_date", { ascending: true, nullsFirst: true });
    if (error) throw new Error(error.message);
    const reports = (data ?? []) as ReportRow[];
    if (!reports.length) return res.status(404).json({ error: "This student has no progress reports" });

    const report = reportNo === null ? reports.at(-1)! : reports.find((r) => r.report_no === reportNo);
    if (!report) {
      return res.status(404).json({
        error: `No report ${reportNo} for this student`,
        available_report_nos: reports.map((r) => r.report_no).filter((n) => n !== null),
      });
    }

    const { name, pdf } = await exportReportPdf(report.doc_id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdfFilename(name)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    // Which report this is, without the caller having to open the PDF.
    if (report.report_no !== null) res.setHeader("X-Report-No", String(report.report_no));
    if (report.report_date) res.setHeader("X-Report-Date", report.report_date);
    res.setHeader("X-Report-Count", String(reports.length));
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Report-No, X-Report-Date, X-Report-Count");
    res.send(pdf);
  } catch (err) {
    if (err instanceof DriveExportError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}
