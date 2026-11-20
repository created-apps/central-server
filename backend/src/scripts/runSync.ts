/**
 * One sync from the command line.
 *   npm run sync              writes to the database
 *   npm run sync -- --dry-run reads the sources only and prints a summary
 */
import { collectSnapshots, runSync } from "../syncJob.js";

if (process.argv.includes("--dry-run")) {
  // --assess N also runs the LLM progress update for the first N children with sessions.
  const assessArg = process.argv.indexOf("--assess");
  const { snapshots, failed } = await collectSnapshots(null);
  if (assessArg > -1) {
    const { assessProgress } = await import("../progress.js");
    const n = Number(process.argv[assessArg + 1] ?? 2);
    for (const s of snapshots.filter((x) => x.progress.counts.completed > 0).slice(0, n)) {
      console.log(JSON.stringify({ key: s.key, counts: s.progress.counts, result: await assessProgress(s.progress, null) }));
    }
  }
  const counts: Record<string, number> = {};
  for (const s of snapshots) for (const m of s.milestones) counts[m.eventType] = (counts[m.eventType] ?? 0) + 1;
  console.log(`children: ${snapshots.length}, failed: ${failed.length}`);
  console.log("milestones by type:", counts);
  console.log("with scope:", snapshots.filter((s) => s.student.scope_approved).length,
    "with reports:", snapshots.filter((s) => s.reports.length).length);
  const comps = snapshots.flatMap((s) => s.competitions);
  const live = comps.filter((c) => !c.withdrawn);
  const total = (k: "approved" | "submitted" | "changes_required" | "in_progress" | "not_started" | "past_due") =>
    live.reduce((n, c) => n + c[k], 0);
  console.log("competitions:", {
    entries: live.length,
    withdrawn: comps.length - live.length,
    children: snapshots.filter((s) => s.competitions.some((c) => !c.withdrawn)).length,
    approved: total("approved"),
    awaiting: total("submitted"),
    changes_required: total("changes_required"),
    in_progress: total("in_progress"),
    not_started: total("not_started"),
    past_due: total("past_due"),
    no_sections: live.filter((c) => !c.sections_total).length,
  });
  const sample = snapshots.find((s) => s.reports.length && s.student.scope_approved) ?? snapshots[0];
  if (sample) console.log("sample:", JSON.stringify({ key: sample.key, student: { ...sample.student, scope_json: "…" }, milestones: sample.milestones.map((m) => [m.eventType, m.occurredAt]) }, null, 1));
  failed.slice(0, 5).forEach((f) => console.log("failed:", f));
} else {
  const result = await runSync("manual");
  console.log(result);
}
