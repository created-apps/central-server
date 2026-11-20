"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useIsAdmin } from "@/components/AuthProvider";
import { CompetitionStatsStrip } from "@/components/Competitions";
import { Gauge, PipelineChart } from "@/components/DashboardCharts";
import { ProgressBadge, StageDots } from "@/components/StageDots";
import { Avatar, Button, PageHeader, Panel, StatCard } from "@/components/ui";
import { api, ApiError, type CompetitionStats, type StudentListItem, type SyncStatus } from "@/lib/api";
import { LABELS, PROGRESS, STAGES, displayName, fmtDate } from "@/lib/milestones";

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const selectClass = "rounded-full border border-line bg-card px-3.5 py-2 text-sm outline-none focus:border-accent";

function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [students, setStudents] = useState<StudentListItem[] | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [compStats, setCompStats] = useState<CompetitionStats | null>(null);
  const isAdmin = useIsAdmin();
  const [error, setError] = useState("");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [program, setProgram] = useState("");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState("");

  // The top bar's search lands here as ?q=.
  useEffect(() => setQuery(params.get("q") ?? ""), [params]);

  const load = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([api<StudentListItem[]>("/students"), api<SyncStatus>("/sync")]);
      setStudents(list);
      setSync(status);
      // Competition stats are optional; a failure here leaves the rest working.
      api<CompetitionStats>("/competitions/stats").then(setCompStats).catch(() => setCompStats(null));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the API");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While a sync runs, children are saved one by one: keep the list current.
  useEffect(() => {
    if (!sync?.running) return;
    const timer = setInterval(async () => {
      const status = await api<SyncStatus>("/sync").catch(() => null);
      if (status && !status.running) load();
      else if (status) {
        setSync(status);
        api<StudentListItem[]>("/students").then(setStudents).catch(() => undefined);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [sync?.running, load]);

  const refresh = async () => {
    await api("/sync", { method: "POST" }).catch(() => null);
    setSync((s) => (s ? { ...s, running: true } : { running: true, schedule: "", lastRun: null }));
  };

  const all = students ?? [];
  const programs = useMemo(() => [...new Set(all.map((s) => s.program).filter(Boolean) as string[])].sort(), [all]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of all) for (const t of s.milestone_types) counts[t] = (counts[t] ?? 0) + 1;
    return counts;
  }, [all]);

  const progressCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of all) c[s.progress_status ?? "unknown"] = (c[s.progress_status ?? "unknown"] ?? 0) + 1;
    return c;
  }, [all]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((s) => {
      if (program && s.program !== program) return false;
      if (stage && !s.milestone_types.includes(stage)) return false;
      if (progress && (s.progress_status ?? "unknown") !== progress) return false;
      if (!needle) return true;
      return [s.student_name, s.student_email, s.parent_email, s.project_name, s.scope_title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [all, query, program, stage, progress]);

  // Lagging children first, then the ones whose last session is oldest.
  const attention = useMemo(
    () =>
      all
        .filter((s) => s.progress_status === "lagging")
        .sort((a, b) => (a.last_session_date ?? "").localeCompare(b.last_session_date ?? ""))
        .slice(0, 5),
    [all],
  );

  if (error) return <Panel>{error}</Panel>;

  const total = all.length;
  const withProject = all.filter((s) => s.project_name).length;
  const scoped = stageCounts.scope_available ?? 0;
  const entered = stageCounts.competition_entered ?? 0;
  const lagging = progressCounts.lagging ?? 0;
  const onTrack = (progressCounts.on_track ?? 0) + (progressCounts.ahead ?? 0);
  const assessed = total - (progressCounts.unknown ?? 0) - (progressCounts.not_started ?? 0);
  const filtersOn = Boolean(stage || progress || program || query);
  const clearFilters = () => {
    setStage("");
    setProgress("");
    setProgram("");
    setQuery("");
    if (params.get("q")) router.replace("/");
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            Every enrolled child&apos;s programme, project and competitions.
            {sync?.lastRun?.finished_at && !sync.running ? ` Updated ${fmtDate(sync.lastRun.finished_at, true)}.` : ""}
          </>
        }
        actions={
          <>
            {isAdmin && (
              <Button variant="primary" onClick={refresh} disabled={sync?.running}>
                <span aria-hidden="true" className="text-base leading-none">↻</span>
                {sync?.running ? `Syncing… ${sync.lastRun?.students ? `${sync.lastRun.students} saved` : "starting"}` : "Refresh now"}
              </Button>
            )}
            <Link href="/groups" className="inline-flex items-center rounded-full border border-accent/70 bg-card px-4 py-2 text-sm font-medium text-accent hover:bg-accent-soft">
              WhatsApp groups
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard hero label="Enrolled children" value={students ? total : "–"} note={`${withProject} with a confirmed project`} active={!filtersOn} onClick={clearFilters} />
        <StatCard
          label="Scope approved"
          value={students ? scoped : "–"}
          note={`${pct(scoped, total)}% of children`}
          active={stage === "scope_available"}
          onClick={() => setStage(stage === "scope_available" ? "" : "scope_available")}
        />
        <StatCard
          label="In competitions"
          value={students ? entered : "–"}
          note={compStats?.available ? `${compStats.sections?.submitted ?? 0} sections awaiting approval` : `${pct(entered, total)}% of children`}
          active={stage === "competition_entered"}
          onClick={() => setStage(stage === "competition_entered" ? "" : "competition_entered")}
        />
        <StatCard
          label="Lagging"
          value={students ? lagging : "–"}
          note={lagging ? "Need a closer look" : "Nobody is behind"}
          active={progress === "lagging"}
          onClick={() => setProgress(progress === "lagging" ? "" : "lagging")}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Programme pipeline" action={<span className="text-xs text-muted">Children who reached each stage</span>}>
          {students ? (
            <PipelineChart counts={stageCounts} total={total} active={stage} onSelect={setStage} />
          ) : (
            <div className="flex h-[13.5rem] animate-pulse items-end gap-3">
              {[45, 70, 55, 90, 40, 60, 30, 50, 35].map((h, i) => (
                <span key={i} className="flex-1 rounded-full bg-soft" style={{ height: `${h}%` }} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Progress">
          {!students ? (
            <div className="mx-auto mt-2 h-[7.5rem] w-full max-w-[260px] animate-pulse rounded-t-full bg-soft" />
          ) : (
          <Gauge
            centre={`${pct(onTrack, assessed)}%`}
            caption="on track or ahead"
            segments={[
              { key: "ahead", label: "Ahead", value: progressCounts.ahead ?? 0, color: "var(--accent-strong)" },
              { key: "on_track", label: "On track", value: progressCounts.on_track ?? 0, color: "var(--done)" },
              { key: "lagging", label: "Lagging", value: lagging, color: "#e0a43a" },
              { key: "not_started", label: "Not started", value: (progressCounts.not_started ?? 0) + (progressCounts.unknown ?? 0), color: "hatch" },
            ]}
          />
          )}
        </Panel>

        <Panel
          title="Needs attention"
          action={
            lagging > 5 ? (
              <button onClick={() => setProgress("lagging")} className="rounded-full border border-accent/70 px-3 py-1 text-xs font-medium text-accent hover:bg-accent-soft">
                All {lagging}
              </button>
            ) : null
          }
        >
          {attention.length ? (
            <ul className="space-y-3">
              {attention.map((s) => (
                <li key={s.id}>
                  <Link href={`/students/${s.id}`} className="flex items-center gap-3 rounded-2xl p-1 hover:bg-soft">
                    <Avatar name={displayName(s)} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{displayName(s)}</p>
                      <p className="truncate text-xs text-muted">
                        {s.last_session_date ? `Last session ${fmtDate(s.last_session_date)}` : "No sessions yet"}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{students ? "No child is lagging right now." : "Loading…"}</p>
          )}
        </Panel>
      </div>

      <CompetitionStatsStrip stats={compStats} />

      <Panel
        title={
          <>
            Children <span className="ml-1 text-sm font-normal text-muted">{students ? `${filtered.length} of ${total}` : ""}</span>
          </>
        }
        action={
          filtersOn ? (
            <button onClick={clearFilters} className="text-xs font-medium text-accent hover:underline">
              Clear filters
            </button>
          ) : null
        }
      >
        <div className="mb-4 flex flex-col gap-2 lg:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, email or project"
            className="flex-1 rounded-full border border-line bg-soft px-4 py-2 text-sm outline-none focus:border-accent focus:bg-card"
          />
          <select value={program} onChange={(e) => setProgram(e.target.value)} className={selectClass}>
            <option value="">All programmes</option>
            {programs.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={progress} onChange={(e) => setProgress(e.target.value)} className={selectClass}>
            <option value="">Any progress</option>
            {Object.entries(PROGRESS).map(([value, p]) => (
              <option key={value} value={value}>
                {p.label}
              </option>
            ))}
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
            <option value="">Any stage</option>
            {[...STAGES, { type: "progress_report", label: "Progress report" }].map((s) => (
              <option key={s.type} value={s.type}>
                Reached: {s.label}
              </option>
            ))}
          </select>
        </div>

        {!students ? (
          <p className="py-6 text-sm text-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-sm text-muted">
            {total
              ? "No children match these filters."
              : sync?.running
                ? "A sync is running. Children appear here as each one is saved."
                : isAdmin
                  ? "No data yet. Press Refresh now to run the first sync."
                  : "No data yet. The first sync has not run."}
          </p>
        ) : (
          <ul className="-mx-2 divide-y divide-line">
            {filtered.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/students/${s.id}`}
                  className="grid items-center gap-3 rounded-2xl px-2 py-3 hover:bg-soft md:grid-cols-[minmax(0,2fr)_minmax(0,2.4fr)_auto]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={displayName(s)} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{displayName(s)}</p>
                        <ProgressBadge status={s.progress_status} />
                      </div>
                      <p className="truncate text-xs text-muted">{[s.program, s.track].filter(Boolean).join(" · ") || "Programme not on sheet"}</p>
                    </div>
                  </div>
                  <div className="min-w-0 pl-[52px] md:pl-0">
                    <p className="truncate text-sm">{s.scope_title || s.project_name || <span className="text-muted">No project yet</span>}</p>
                    <p className="truncate text-xs text-muted" title={s.progress_headline ?? undefined}>
                      {s.progress_headline ||
                        (s.latest_milestone
                          ? `${LABELS[s.latest_milestone] ?? s.latest_milestone}${s.latest_milestone_at ? ` · ${fmtDate(s.latest_milestone_at)}` : ""}`
                          : "")}
                    </p>
                  </div>
                  <div className="pl-[52px] md:pl-0">
                    <StageDots reached={s.milestone_types} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Dashboard />
    </Suspense>
  );
}
