/**
 * POST /api/scope/file: a child's project scope document, by student email,
 * for other services. The body is multipart/form-data with student_email.
 * The file comes back as COSMIC stores it: a PDF or a Word (.docx) document,
 * with Content-Type and X-Scope-Format saying which.
 */
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { downloadScopeFile } from "./sources/cosmic.js";
import { findStudentByEmail, normaliseEmail } from "./studentLookup.js";

const MAX_BYTES = 25 * 1024 * 1024;

const FORMATS: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};

/** A safe download filename that keeps the document's own extension. */
function scopeFilename(name: string, ext: string): string {
  const stem = name
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[. ]+/, "")
    .trim();
  return `${(stem || "project-scope").slice(0, 80)}.${ext}`;
}

interface ScopeRow {
  id: string;
  scope_file_name: string | null;
  scope_file_path: string | null;
  scope_approved: boolean | null;
  scope_approved_at: string | null;
}

export async function sendScopeFile(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.is("multipart/form-data")) {
      return res.status(415).json({ error: "Send the body as multipart/form-data" });
    }
    const email = normaliseEmail((req.body ?? {}).student_email);
    if (!email) return res.status(400).json({ error: "A valid student_email is required" });

    const student = await findStudentByEmail<ScopeRow>(
      email,
      "id,scope_file_name,scope_file_path,scope_approved,scope_approved_at",
    );
    if (!student) return res.status(404).json({ error: "Student not found" });
    if (!student.scope_file_path) return res.status(404).json({ error: "This student has no scope document" });

    let file: Awaited<ReturnType<typeof downloadScopeFile>>;
    try {
      file = await downloadScopeFile(student.scope_file_path, config.cosmicScopeBucket, MAX_BYTES);
    } catch (err) {
      console.warn(`Scope download failed: ${(err as Error).message}`);
      return res.status(502).json({ error: "Could not download the scope document from COSMIC" });
    }
    if (!file) return res.status(404).json({ error: "The scope document is missing from COSMIC's storage" });

    const name = student.scope_file_name || student.scope_file_path.split("/").pop() || "project-scope";
    // The format from the file itself first (a PDF starts with %PDF, a .docx is a zip), then its name.
    const fromName = name.split(".").pop()!.toLowerCase();
    const ext = file.body.subarray(0, 4).toString("latin1") === "%PDF"
      ? "pdf"
      : file.body.subarray(0, 2).toString("latin1") === "PK"
        ? "docx"
        : FORMATS[fromName]
          ? fromName
          : "bin";

    res.setHeader("Content-Type", FORMATS[ext] ?? file.contentType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${scopeFilename(name, ext)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Scope-Format", ext);
    res.setHeader("X-Scope-Approved", String(Boolean(student.scope_approved)));
    if (student.scope_approved_at) res.setHeader("X-Scope-Approved-At", student.scope_approved_at);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Scope-Format, X-Scope-Approved, X-Scope-Approved-At");
    res.send(file.body);
  } catch (err) {
    next(err);
  }
}
