/**
 * The sync: reads the enrolment sheet and the three sources, and writes each
 * enrolled child's milestones, scope and progress reports to this app's DB.
 * Runs hourly from the cron and on demand from the dashboard.
 */
import { config } from "./config.js";
import { db, dbConfigured } from "./db.js";
import { buildChild, type ChildSnapshot } from "./milestones.js";
import { assessProgress, type ProgressResult } from "./progress.js";
import { ProgressReportIndex } from "./sources/automations.js";
import { loadEnrolledChildren } from "./sources/sheet.js";

let running: Promise<SyncResult> | null = null;

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

export interface SyncResult {
  runId: string | null;
  students: number;
  milestones: number;
  errors: number;
  message: string;
}

/** Runs f over items with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await f(items[i]);
      }
    }),
  );
  return results;
}

export type Snapshot = ChildSnapshot & { assessment: ProgressResult | null };

/**
 * Builds every child's snapshot. With `previousHashes` (the stored
 * progress-input hashes by key) the LLM progress update is also run, for
 * children whose sessions or summaries changed since the last one.
 *
 * `onSnapshot` runs for each child as soon as it is built, so the sync can
 * save children one by one instead of waiting for all of them. Without it
 * nothing is written (the dry run).
 */
export async function collectSnapshots(
  previousHashes: Map<string, string | null> | null,
  onSnapshot?: (snapshot: Snapshot) => Promise<void>,
): Promise<{ snapshots: Snapshot[]; failed: { key: string; error: string }[] }> {
  const [children, reports] = await Promise.all([loadEnrolledChildren(), ProgressReportIndex.load()]);
  const failed: { key: string; error: string }[] = [];
  const snapshots = await pool(children, config.syncConcurrency, async (row) => {
    try {
      const child = await buildChild(row, reports);
      const assessment = previousHashes
        ? await assessProgress(child.progress, previousHashes.get(child.key) ?? null)
        : null;
      const snapshot = { ...child, assessment };
      await onSnapshot?.(snapshot);
      return snapshot;
    } catch (err) {
      failed.push({ key: row.studentEmail || row.parentEmail, error: (err as Error).message });
      return null;
    }
  });
  return { snapshots: snapshots.filter((s): s is Snapshot => s !== null), failed };
}

async function save(snapshot: Snapshot, now: string): Promise<number> {
  const sorted = [...snapshot.milestones].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));
  const latest = sorted.find((m) => m.occurredAt) ?? sorted[0];

  const { data: student, error } = await db
    .from("students")
    .upsert(
      {
        key: snapshot.key,
        ...snapshot.student,
        latest_milestone: latest?.eventType ?? null,
        latest_milestone_at: latest?.occurredAt ?? null,
        milestone_count: snapshot.milestones.length,
        report_count: snapshot.reports.length,
        // Session counts are always current; the LLM fields only change when
        // a new assessment was made this run.
        meetings_completed: snapshot.progress.counts.completed,
        sessions_cancelled: snapshot.progress.counts.cancelled,
        sessions_scheduled: snapshot.progress.counts.scheduled,
        sessions_planned: snapshot.progress.planned,
        last_session_date: snapshot.progress.counts.lastSessionDate,
        next_session_date: snapshot.progress.counts.nextSessionDate,
        ...(snapshot.assessment
          ? {
              progress_status: snapshot.assessment.status,
              progress_headline: snapshot.assessment.headline,
              progress_reason: snapshot.assessment.reason,
              progress_recent_work: snapshot.assessment.recentWork,
              progress_model: snapshot.assessment.model,
              progress_input_hash: snapshot.progress.hash,
              progress_assessed_at: now,
            }
          : {}),
        last_synced_at: now,
        sync_error: null,
        updated_at: now,
      },
      { onConflict: "key" },
    )
    .select("id")
    .single();
  if (error || !student) throw new Error(`students upsert: ${error?.message}`);

  if (snapshot.milestones.length) {
    // first_seen_at is left to its default, so an existing row keeps it.
    const { error: mErr } = await db.from("milestones").upsert(
      snapshot.milestones.map((m) => ({
        student_id: student.id,
        event_type: m.eventType,
        external_ref: m.externalRef,
        occurred_at: m.occurredAt,
        details: m.details,
        last_seen_at: now,
      })),
      { onConflict: "student_id,event_type,external_ref" },
    );
    if (mErr) throw new Error(`milestones upsert: ${mErr.message}`);
  }

  if (snapshot.reports.length) {
    const { error: rErr } = await db.from("progress_reports").upsert(
      snapshot.reports.map((r) => ({
        student_id: student.id,
        doc_id: r.docId,
        doc_url: r.docUrl,
        report_no: r.reportNo,
        report_date: r.date || null,
        sessions_completed: r.sessionsCompleted,
        group_name: r.groupName || null,
      })),
      { onConflict: "student_id,doc_id" },
    );
    if (rErr) throw new Error(`progress_reports upsert: ${rErr.message}`);
  }

  await saveCompetitions(student.id, snapshot, now);
  return snapshot.milestones.length;
}

let competitionsTableMissing = false;

/**
 * Replaces the child's competitions with what COSMIC has now. If the
 * competitions table has not been created yet, this is skipped (with one
 * warning per run) so the rest of the sync still lands.
 */
async function saveCompetitions(studentId: string, snapshot: Snapshot, now: string): Promise<void> {
  if (competitionsTableMissing) return;
  const missing = (e: { code?: string; message?: string } | null) =>
    Boolean(e && (e.code === "PGRST205" || e.code === "42P01" || (/competitions/.test(e.message ?? "") && /not find|does not exist/.test(e.message ?? ""))));

  if (snapshot.competitions.length) {
    const { error } = await db.from("competitions").upsert(
      snapshot.competitions.map((c) => ({ ...c, student_id: studentId, last_seen_at: now })),
      { onConflict: "student_id,enrollment_id" },
    );
    if (missing(error)) {
      competitionsTableMissing = true;
      console.warn("The competitions table does not exist yet. Run supabase/schema.sql; competitions are skipped this run.");
      return;
    }
    if (error) throw new Error(`competitions upsert: ${error.message}`);
  }
  // Enrollments deleted in COSMIC drop off (withdrawn ones are still listed there).
  const keep = snapshot.competitions.map((c) => c.enrollment_id);
  let stale = db.from("competitions").delete().eq("student_id", studentId);
  if (keep.length) stale = stale.not("enrollment_id", "in", `(${keep.join(",")})`);
  const { error } = await stale;
  if (missing(error)) competitionsTableMissing = true;
  else if (error) throw new Error(`competitions cleanup: ${error.message}`);
}

async function runOnce(trigger: string): Promise<SyncResult> {
  if (!dbConfigured()) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const started = new Date().toISOString();
  const { data: run } = await db.from("sync_runs").insert({ trigger, started_at: started }).select("id").single();
  const runId = run?.id ?? null;

  let students = 0;
  let milestones = 0;
  let errors = 0;
  let message = "";
  competitionsTableMissing = false;
  try {
    const previous = await all<{ key: string; progress_input_hash: string | null }>((from, to) =>
      db.from("students").select("key,progress_input_hash").order("key").range(from, to),
    );
    // Each child is saved as soon as it is built, so the list fills in while
    // the sync runs and a failure midway keeps everyone saved so far.
    let lastProgress = 0;
    const saveOne = async (s: Snapshot) => {
      try {
        milestones += await save(s, started);
        students += 1;
      } catch (err) {
        errors += 1;
        console.warn(`Save failed for ${s.key}: ${(err as Error).message}`);
        await db.from("students").update({ sync_error: (err as Error).message.slice(0, 500) }).eq("key", s.key);
      }
      // The dashboard shows the run's counts; keep them current, every few seconds at most.
      if (runId && Date.now() - lastProgress > 5000) {
        lastProgress = Date.now();
        await db.from("sync_runs").update({ students, milestones, errors }).eq("id", runId);
      }
    };
    const { snapshots, failed } = await collectSnapshots(
      new Map(previous.map((r) => [r.key, r.progress_input_hash])),
      saveOne,
    );
    errors += failed.length;
    if (!snapshots.length && !failed.length) {
      // An unreadable sheet looks like an empty one. Do not mark everyone as
      // having left the sheet on the strength of that.
      message = "The enrolment sheet returned no children; nothing changed";
    } else {
      // Children no longer on the sheet keep their history but drop off the list.
      const keys = new Set([...snapshots.map((s) => s.key), ...failed.map((f) => f.key)]);
      const { data: existing } = await db.from("students").select("key").eq("in_sheet", true);
      const gone = (existing ?? []).map((r) => r.key).filter((k) => !keys.has(k));
      if (gone.length) await db.from("students").update({ in_sheet: false, updated_at: started }).in("key", gone);
      message = `${students} children, ${milestones} milestones${gone.length ? `, ${gone.length} left the sheet` : ""}`;
    }
  } catch (err) {
    errors += 1;
    message = (err as Error).message;
  }

  if (runId) {
    await db
      .from("sync_runs")
      .update({
        status: errors && !students ? "failed" : "done",
        finished_at: new Date().toISOString(),
        students,
        milestones,
        errors,
        message: message.slice(0, 1000),
      })
      .eq("id", runId);
  }
  console.log(`[sync:${trigger}] ${message} (${errors} errors)`);
  return { runId, students, milestones, errors, message };
}

/** Starts a sync, or joins the one already running so two never overlap. */
export function runSync(trigger: "cron" | "manual" | "startup"): Promise<SyncResult> {
  if (!running) running = runOnce(trigger).finally(() => (running = null));
  return running;
}

export function syncInProgress(): boolean {
  return running !== null;
}
