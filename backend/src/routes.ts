import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { config } from "./config.js";
import { db } from "./db.js";
import { requireAdmin, requireApiKeyOrStaff, requireStaff, type AuthedRequest } from "./auth.js";
import { getScopeDownloadUrl } from "./sources/cosmic.js";
import { DriveExportError, exportReportPdf, pdfFilename } from "./sources/drive.js";
import { runSync, syncInProgress } from "./syncJob.js";
import { checkMilestones, MilestoneCheckError, parseCheckRequest } from "./milestoneCheck.js";

export const api = Router();
/**
 * LLM milestone check: which of the given milestones has the child completed,
 * judged against their scope and progress reports. Nothing is stored.
 * Registered before requireStaff so other services can call it with the
 * X-API-Key header (MILESTONE_API_KEY) instead of a staff session.
 */
api.post("/milestones/evaluate", requireApiKeyOrStaff, async (req, res, next) => {
  try {
    res.json(await checkMilestones(parseCheckRequest(req.body)));
  } catch (err) {
    if (err instanceof MilestoneCheckError) return res.status(err.status).json({ error: err.message });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `Claude API error ${err.status}` });
    next(err);
  }
});

api.use(requireStaff);

/** Reads every row of a query past Supabase's 1000-row page cap. */
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

api.get("/me", (req: AuthedRequest, res) => res.json({ email: req.userEmail, name: req.userName, role: req.userRole }));

const LIST_FIELDS =
  "id,key,student_email,parent_email,student_name,program,track,enrolled_on,project_name,scope_title," +
  "scope_approved,meetings_completed,latest_milestone,latest_milestone_at,milestone_count,report_count,last_synced_at,sync_error," +
  "progress_status,progress_headline,last_session_date";

api.get("/students", async (_req, res, next) => {
  try {
    const students = await all<any>((from, to) =>
      db.from("students").select(LIST_FIELDS).eq("in_sheet", true).order("student_name").range(from, to),
    );
    const types = await all<{ student_id: string; event_type: string }>((from, to) =>
      db.from("milestones").select("student_id,event_type").order("id").range(from, to),
    );
    const byStudent = new Map<string, Set<string>>();
    for (const t of types) byStudent.set(t.student_id, (byStudent.get(t.student_id) ?? new Set()).add(t.event_type));
    res.json(students.map((s) => ({ ...s, milestone_types: [...(byStudent.get(s.id) ?? [])] })));
  } catch (err) {
    next(err);
  }
});

api.get("/students/:id", async (req, res, next) => {
  try {
    const { data: student, error } = await db.from("students").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!student) return res.status(404).json({ error: "Student not found" });
    const [{ data: milestones }, { data: reports }, { data: competitions }] = await Promise.all([
      db.from("milestones").select("event_type,external_ref,occurred_at,details,first_seen_at").eq("student_id", student.id),
      db.from("progress_reports").select("doc_id,doc_url,report_no,report_date,sessions_completed,group_name").eq("student_id", student.id).order("report_no"),
      // An error here means the table is not created yet: show none.
      db.from("competitions").select("*").eq("student_id", student.id).order("assigned_at", { ascending: false }),
    ]);
    res.json({ student, milestones: milestones ?? [], reports: reports ?? [], competitions: competitions ?? [] });
  } catch (err) {
    next(err);
  }
});

const STAT_FIELDS =
  "student_id,name,withdrawn,outcome_text,resubmissions,sections_total,required_total,required_approved," +
  "approved,submitted,changes_required,in_progress,not_started,past_due";

/**
 * Competition stats across every child on the sheet: the section pipeline,
 * past-due sections, and a per-competition breakdown. Withdrawn entries count
 * only as withdrawals.
 */
api.get("/competitions/stats", async (_req, res, next) => {
  try {
    const onSheet = await all<{ id: string }>((from, to) =>
      db.from("students").select("id").eq("in_sheet", true).order("id").range(from, to),
    );
    const ids = new Set(onSheet.map((r) => r.id));
    let rows: any[] = [];
    try {
      rows = (await all<any>((from, to) => db.from("competitions").select(STAT_FIELDS).order("id").range(from, to)))
        .filter((r) => ids.has(r.student_id));
    } catch {
      return res.json({ available: false });
    }
    const swaps = await all<{ details: any; student_id: string }>((from, to) =>
      db.from("milestones").select("student_id,details").eq("event_type", "comps_suggested").order("id").range(from, to),
    );

    const active = rows.filter((r) => !r.withdrawn);
    const sum = (list: any[], k: string) => list.reduce((n, r) => n + (r[k] ?? 0), 0);
    const pct = (num: number, den: number) => (den ? Math.round((num / den) * 100) : null);
    const byName = new Map<string, any[]>();
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);

    res.json({
      available: true,
      children: new Set(active.map((r) => r.student_id)).size,
      entries: active.length,
      withdrawn: rows.length - active.length,
      outcomes: active.filter((r) => r.outcome_text).length,
      sections: {
        total: sum(active, "sections_total"),
        approved: sum(active, "approved"),
        submitted: sum(active, "submitted"),
        changes_required: sum(active, "changes_required"),
        in_progress: sum(active, "in_progress"),
        not_started: sum(active, "not_started"),
        past_due: sum(active, "past_due"),
      },
      completion: pct(sum(active, "required_approved"), sum(active, "required_total")),
      childrenWithPastDue: new Set(active.filter((r) => r.past_due > 0).map((r) => r.student_id)).size,
      resubmissionRequests: rows.reduce((n, r) => n + (Array.isArray(r.resubmissions) ? r.resubmissions.length : 0), 0),
      swapRequests: swaps
        .filter((m) => ids.has(m.student_id))
        .reduce((n, m) => n + (Array.isArray(m.details?.swaps) ? m.details.swaps.length : 0), 0),
      byCompetition: [...byName.entries()]
        .map(([name, list]) => {
          const live = list.filter((r) => !r.withdrawn);
          return {
            name,
            children: new Set(live.map((r) => r.student_id)).size,
            withdrawn: list.length - live.length,
            completion: pct(sum(live, "required_approved"), sum(live, "required_total")),
            submitted: sum(live, "submitted"),
            changes_required: sum(live, "changes_required"),
            past_due: sum(live, "past_due"),
            outcomes: live.filter((r) => r.outcome_text).length,
            resubmissions: list.reduce((n, r) => n + (Array.isArray(r.resubmissions) ? r.resubmissions.length : 0), 0),
          };
        })
        .sort((a, b) => b.children - a.children || a.name.localeCompare(b.name)),
    });
  } catch (err) {
    next(err);
  }
});

/** A fresh, short-lived link to the scope document in COSMIC's private bucket. */
api.get("/students/:id/scope-url", async (req, res, next) => {
  try {
    const { data: student } = await db.from("students").select("scope_file_path").eq("id", req.params.id).maybeSingle();
    if (!student?.scope_file_path) return res.status(404).json({ error: "No scope document" });
    const url = await getScopeDownloadUrl(student.scope_file_path, config.cosmicScopeBucket, config.signedUrlTtl);
    if (!url) return res.status(502).json({ error: "Could not get a download link from COSMIC" });
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

/**
 * A progress report as a PDF, exported from Drive by the service account.
 * Only a report recorded against this child can be fetched.
 */
api.get("/students/:id/reports/:docId/pdf", async (req, res, next) => {
  try {
    const { data: report } = await db
      .from("progress_reports")
      .select("doc_id")
      .eq("student_id", req.params.id)
      .eq("doc_id", req.params.docId)
      .maybeSingle();
    if (!report) return res.status(404).json({ error: "Report not found for this child" });
    const { name, pdf } = await exportReportPdf(report.doc_id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${pdfFilename(name)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    if (err instanceof DriveExportError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

api.get("/sync", async (_req, res, next) => {
  try {
    const { data } = await db.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();
    res.json({ running: syncInProgress(), lastRun: data ?? null, schedule: config.cronSchedule });
  } catch (err) {
    next(err);
  }
});

api.post("/sync", requireAdmin, (_req, res) => {
  const alreadyRunning = syncInProgress();
  runSync("manual").catch((err) => console.error("Manual sync failed:", err));
  res.status(202).json({ started: !alreadyRunning, running: true });
});

