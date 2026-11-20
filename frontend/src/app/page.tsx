"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProgressBadge, StageDots } from "@/components/StageDots";
import { CompetitionStatsStrip } from "@/components/Competitions";
import { useIsAdmin } from "@/components/AuthProvider";
import { api, ApiError, type CompetitionStats, type StudentListItem, type SyncStatus } from "@/lib/api";
import { LABELS, PROGRESS, STAGES, displayName, fmtDate } from "@/lib/milestones";

export default function Dashboard() {
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [compStats, setCompStats] = useState<CompetitionStats | null>(null);
  const isAdmin = useIsAdmin();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [program, setProgram] = useState("");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([api<StudentListItem[]>("/students"), api<SyncStatus>("/sync")]);
      setStudents(list);
      setSync(status);
      // The stats strip is optional; a failure here leaves the list working.
      api<CompetitionStats>("/competitions/stats").then(setCompStats).catch(() => setCompStats(null));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the API");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While a sync runs, poll its status and reload the list when it finishes.
  useEffect(() => {
    if (!sync?.running) return;
    const timer = setInterval(async () => {
      const status = await api<SyncStatus>("/sync").catch(() => null);
      if (status && !status.running) load();
      else if (status) {
        setSync(status);
        // Children are saved one by one, so show them as they land.
        api<StudentListItem[]>("/students").then(setStudents).catch(() => undefined);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [sync?.running, load]);

  const refresh = async () => {
    await api("/sync", { method: "POST" }).catch(() => null);
    setSync((s) => (s ? { ...s, running: true } : { running: true, schedule: "", lastRun: null }));
  };

  const programs = useMemo(
    () => [...new Set((students ?? []).map((s) => s.program).filter(Boolean) as string[])].sort(),
    [students],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (students ?? []).filter((s) => {
      if (program && s.program !== program) return false;
      if (stage && !s.milestone_types.includes(stage)) return false;
      if (progress && (s.progress_status ?? "unknown") !== progress) return false;
      if (!needle) return true;
      return [s.student_name, s.student_email, s.parent_email, s.project_name, s.scope_title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [students, query, program, stage, progress]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of students ?? []) for (const t of s.milestone_types) counts[t] = (counts[t] ?? 0) + 1;
    return counts;
  }, [students]);

  if (error) {
    return <p className="rounded-lg border border-line bg-card p-4 text-sm">{error}</p>;
  }

  const summaryStages = ["first_consult_done", "project_confirmed", "scope_available", "competition_entered", "progress_report"];

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Enrolled children</h1>
          <p className="mt-1 text-sm text-muted">
            {students ? `${students.length} on the enrolment sheet` : "Loading…"}
            {sync?.lastRun?.finished_at && ` · updated ${fmtDate(sync.lastRun.finished_at, true)}`}
          </p>
        </div>
        {isAdmin && <button
          onClick={refresh}
          disabled={sync?.running}
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {sync?.running ? `Refreshing… ${sync.lastRun?.students ? `${sync.lastRun.students} saved` : "starting"}` : "Refresh now"}
        </button>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {summaryStages.map((type) => (
          <button
            key={type}
            onClick={() => setStage(stage === type ? "" : type)}
            className={`rounded-lg border bg-card px-3 py-2 text-left ${stage === type ? "border-accent" : "border-line"}`}
          >
            <p className="text-xl font-semibold">{stageCounts[type] ?? 0}</p>
            <p className="text-xs text-muted">{LABELS[type]}</p>
          </button>
        ))}
      </div>

      <CompetitionStatsStrip stats={compStats} />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or project"
          className="flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <select value={program} onChange={(e) => setProgram(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-sm">
          <option value="">All programmes</option>
          {programs.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={progress} onChange={(e) => setProgress(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-sm">
          <option value="">Any progress</option>
          {Object.entries(PROGRESS).map(([value, p]) => (
            <option key={value} value={value}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-lg border border-line bg-card px-3 py-2 text-sm">
          <option value="">Any stage</option>
          {[...STAGES, { type: "progress_report", label: "Progress report" }].map((s) => (
            <option key={s.type} value={s.type}>
              Reached: {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-card">
        {!students ? (
          <p className="p-6 text-sm text-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            {students.length ? "No children match these filters." : sync?.running ? "A sync is running. Children appear here as each one is saved." : isAdmin ? "No data yet. Press Refresh now to run the first sync." : "No data yet. The first sync has not run."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/students/${s.id}`}
                  className="grid gap-2 px-4 py-3 hover:bg-soft sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{displayName(s)}</p>
                      <ProgressBadge status={s.progress_status} />
                    </div>
                    <p className="truncate text-xs text-muted">
                      {[s.program, s.track].filter(Boolean).join(" · ") || "Programme not on sheet"}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {s.scope_title || s.project_name || <span className="text-muted">No project yet</span>}
                    </p>
                    {s.progress_headline && (
                      <p className="truncate text-xs text-muted" title={s.progress_headline}>{s.progress_headline}</p>
                    )}
                    <p className="truncate text-xs text-muted">
                      {s.latest_milestone
                        ? `${LABELS[s.latest_milestone] ?? s.latest_milestone}${s.latest_milestone_at ? ` · ${fmtDate(s.latest_milestone_at)}` : ""}`
                        : ""}
                      {s.report_count ? ` · ${s.report_count} report${s.report_count === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <StageDots reached={s.milestone_types} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
