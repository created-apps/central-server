"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StageBadge, StopOperationsButton } from "@/components/groups/shared";
import { ACTION_SHORT, STAGE_LABELS, daysSince, relativeTime, useCases, type CaseSummary, type Stage } from "@/lib/ops";

type Filter = Stage | "ALL";
type Sort = "newest" | "oldest";

const TILES: { key: Filter; label: string; count: (c: CaseSummary[]) => number; dot: string }[] = [
  { key: "NEW", label: "Awaiting first action", count: (c) => c.filter((x) => x.stage === "NEW").length, dot: "bg-amber-500" },
  { key: "IN_PROGRESS", label: "In progress", count: (c) => c.filter((x) => x.stage === "IN_PROGRESS").length, dot: "bg-accent" },
  { key: "MENTOR_ASSIGNED", label: "Mentor assigned", count: (c) => c.filter((x) => x.stage === "MENTOR_ASSIGNED").length, dot: "bg-done" },
  { key: "ALL", label: "Total active", count: (c) => c.filter((x) => x.stage !== "ABANDONED").length, dot: "bg-fg" },
];

const CHIPS: Filter[] = ["ALL", "AWAITING_JOIN", "NEW", "IN_PROGRESS", "AWAITING_MENTOR_JOIN", "MENTOR_ASSIGNED", "ABANDONED"];

function OpenFor({ row }: { row: CaseSummary }) {
  const days = daysSince(row.created_at);
  const overdue = days > 14 && row.stage !== "MENTOR_ASSIGNED";
  return <span className={`tabular-nums ${overdue ? "font-semibold text-red-600 dark:text-red-400" : "text-muted"}`}>{days === 0 ? "today" : `${days}d`}</span>;
}

export default function GroupsPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useCases();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const cases = data ?? [];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases
      .filter((c) => filter === "ALL" || c.stage === filter)
      .filter((c) => !q || [c.student_name, c.project_name, c.mentor_name, c.group_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .sort((a, b) => (sort === "newest" ? 1 : -1) * (+new Date(b.created_at) - +new Date(a.created_at)));
  }, [cases, filter, query, sort]);

  if (error) return <p className="rounded-3xl bg-card p-5 text-sm">{error.message || "Could not load the groups."}</p>;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Groups</h1>
        <p className="mt-1 text-sm text-muted">WhatsApp groups created for students and the follow-up actions the team owns.</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            aria-pressed={filter === t.key}
            className={`rounded-3xl bg-card px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(16,24,20,0.04)] ${filter === t.key ? "border-accent" : "border-line"}`}
          >
            <p className="text-xl font-semibold">{isLoading ? "–" : t.count(cases)}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
              {t.label}
            </p>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search student, project, mentor or group"
          className="flex-1 rounded-full border border-line bg-card px-4 py-2 text-sm outline-none focus:border-accent"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded-full border border-line bg-card px-3.5 py-2 text-sm">
          {CHIPS.map((c) => (
            <option key={c} value={c}>
              {c === "ALL" ? "Any stage" : STAGE_LABELS[c]}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-full border border-line bg-card px-3.5 py-2 text-sm">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-3xl bg-card shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
        {isLoading ? (
          <p className="p-6 text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted">{cases.length ? "No groups match these filters." : "New student groups appear here once they are created."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => {
              const stopped = Boolean(row.operations_stopped_at);
              const isNew = row.stage === "NEW" && !stopped;
              return (
                <li
                  key={row.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/groups/${row.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/groups/${row.id}`);
                  }}
                  className={`grid cursor-pointer gap-2 px-4 py-3 hover:bg-soft sm:grid-cols-[minmax(0,2fr)_10.5rem_minmax(0,1.4fr)_minmax(0,1.4fr)_6.5rem_4.5rem] sm:items-center sm:gap-4 ${
                    isNew ? "border-l-2 border-l-amber-500" : ""
                  } ${stopped ? "opacity-60" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.student_name}</p>
                    <p className="truncate text-xs text-muted">{row.project_name ?? "No project name"}</p>
                  </div>
                  <div>
                    <StageBadge stage={row.stage} />
                  </div>
                  <p className="truncate text-sm">{row.mentor_name ?? <span className="text-xs text-muted">No mentor yet</span>}</p>
                  <p className="truncate text-xs text-muted">
                    {row.last_action_kind && row.last_action_at ? `${ACTION_SHORT[row.last_action_kind]} · ${relativeTime(row.last_action_at)}` : "No actions yet"}
                  </p>
                  <p className="text-xs" title={row.nudge_count ? `${row.nudge_count} nudges, last ${relativeTime(row.last_nudged_at)}` : "No nudges"}>
                    <OpenFor row={row} />
                    {row.nudge_count ? <span className="text-muted"> · {row.nudge_count} nudges</span> : null}
                  </p>
                  <div className="sm:text-right">
                    <StopOperationsButton groupCase={row} label="Stop" onDone={() => mutate()} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {!isLoading && rows.length > 0 && <p className="mt-2 text-xs text-muted">{rows.length} {rows.length === 1 ? "group" : "groups"}</p>}
    </div>
  );
}
