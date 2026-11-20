"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { api, ApiError, openPdf, type MilestoneRow, type StudentDetail } from "@/lib/api";
import { LABELS, STAGES, displayName, fmtDate } from "@/lib/milestones";
import { ProgressBadge } from "@/components/StageDots";
import { CompetitionsPanel } from "@/components/Competitions";

function MilestoneDetails({ m, onOpenReport }: { m: MilestoneRow; onOpenReport: (docId: string) => void }) {
  const d = m.details || {};
  const link = (href: string, text: string) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        {text}
      </a>
    ) : null;
  switch (m.event_type) {
    case "enrolled":
      return <>{[d.program, d.track].filter(Boolean).join(" · ")}</>;
    case "first_consult_done":
      return <>{d.mentor ? `With ${d.mentor}` : ""}</>;
    case "scope_call":
    case "midway_call":
      return <>{fmtDate(d.start, true)} {link(d.meetLink, "Meet link")}</>;
    case "project_confirmed":
      return <>{d.projectName}</>;
    case "scope_available":
      return <>{d.title || d.projectName}</>;
    case "comps_suggested":
      return (
        <ul className="mt-1 list-disc pl-4">
          {(d.competitions || []).map((c: any) => (
            <li key={c.name}>
              {c.url ? link(c.url, c.name) : c.name}
              {c.deadline ? <span className="text-muted"> · {c.deadline}</span> : null}
            </li>
          ))}
        </ul>
      );
    case "competition_entered":
      return <>{d.competition}</>;
    case "competition_outcome":
      return <>{d.competition}: {d.outcome}</>;
    case "closure_call":
      return <>{fmtDate(d.start || d.date, Boolean(d.start))} {d.outcome ? `· ${d.outcome}` : ""} {link(d.meetLink, "Meet link")}</>;
    case "progress_report":
      return (
        <>
          Report {d.reportNo ?? ""}
          {d.sessionsCompleted != null ? ` · ${d.sessionsCompleted} sessions` : ""}{" "}
          <button onClick={() => onOpenReport(m.external_ref)} className="text-accent hover:underline">
            Open PDF
          </button>
        </>
      );
    default:
      return null;
  }
}

/** Renders COSMIC's scope document: nested sections of text and lists. */
function ScopeNode({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {value.map((v, i) => (
          <li key={i}>
            <ScopeNode value={v} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    return (
      <div className={depth ? "space-y-2" : "space-y-5"}>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k}>
            <p className={depth ? "text-sm font-medium" : "text-xs font-semibold uppercase tracking-wide text-muted"}>{k}</p>
            <div className="mt-1 text-sm leading-relaxed">
              <ScopeNode value={v} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}

export default function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<StudentDetail | null>(null);
  const [error, setError] = useState("");
  const [showScope, setShowScope] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openingReport, setOpeningReport] = useState("");

  useEffect(() => {
    api<StudentDetail>(`/students/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load"));
  }, [id]);

  if (error) return <p className="rounded-lg border border-line bg-card p-4 text-sm">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const { student: s, milestones, reports, competitions = [] } = data;
  const suggested = milestones
    .filter((m) => m.event_type === "comps_suggested")
    .sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""))[0];
  const reached = new Set(milestones.map((m) => m.event_type));
  const timeline = [...milestones].sort((a, b) =>
    (b.occurred_at || b.first_seen_at).localeCompare(a.occurred_at || a.first_seen_at),
  );

  const openScope = async () => {
    setOpening(true);
    try {
      const { url } = await api<{ url: string }>(`/students/${id}/scope-url`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Could not open the scope");
    } finally {
      setOpening(false);
    }
  };

  const openReport = async (docId: string) => {
    setOpeningReport(docId);
    try {
      await openPdf(`/students/${id}/reports/${encodeURIComponent(docId)}/pdf`);
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Could not open the report");
    } finally {
      setOpeningReport("");
    }
  };

  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm text-muted hover:text-fg">← All children</Link>

      <section className="rounded-xl border border-line bg-card p-5">
        <h1 className="text-2xl font-semibold tracking-tight">{displayName(s)}</h1>
        <p className="mt-1 text-sm text-muted">
          {[s.student_email, s.parent_name && `Parent: ${s.parent_name}`, s.parent_email].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 text-sm">
          {[s.program, s.track].filter(Boolean).join(" · ")}
          {s.meetings_completed ? <span className="text-muted"> · {s.meetings_completed} sessions completed</span> : null}
        </p>

        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STAGES.map((st) => (
            <li
              key={st.type}
              className={`rounded-lg border px-3 py-2 text-xs ${
                reached.has(st.type) ? "border-done/40 bg-done/10" : st.optional ? "border-dashed border-line text-muted" : "border-line text-muted"
              }`}
            >
              <span className="font-medium">{reached.has(st.type) ? "✓ " : ""}{st.label}</span>
              {st.optional && !reached.has(st.type) ? <span className="block">Optional</span> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Progress update</h2>
          <ProgressBadge status={s.progress_status} />
          {s.progress_assessed_at && <span className="text-xs text-muted">assessed {fmtDate(s.progress_assessed_at)}</span>}
        </div>
        {s.progress_headline ? (
          <>
            <p className="mt-3 font-medium">{s.progress_headline}</p>
            {s.progress_reason && <p className="mt-2 text-sm leading-relaxed text-muted">{s.progress_reason}</p>}
            {s.progress_recent_work && (
              <p className="mt-3 text-sm leading-relaxed">
                <span className="font-medium">Recent work: </span>
                <span className="text-muted">{s.progress_recent_work}</span>
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">Not assessed yet. It is written after the next sync.</p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm sm:grid-cols-5">
          {[
            ["Completed", s.meetings_completed + (s.sessions_planned ? ` of ${s.sessions_planned}` : "")],
            ["Cancelled", s.sessions_cancelled],
            ["Upcoming", s.sessions_scheduled],
            ["Last session", fmtDate(s.last_session_date) || "—"],
            ["Next session", fmtDate(s.next_session_date) || "—"],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="rounded-xl border border-line bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Project &amp; scope</h2>
              <p className="text-xs text-muted">
                {s.scope_approved ? `Scope approved ${fmtDate(s.scope_approved_at)}` : "Scope not approved yet"}
                {s.project_status ? ` · project ${s.project_status}` : ""}
              </p>
            </div>
            {s.scope_file_path && (
              <button onClick={openScope} disabled={opening} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                {opening ? "Opening…" : "Download scope"}
              </button>
            )}
          </div>
          {s.project_name ? (
            <>
              <p className="mt-4 font-medium">{s.scope_title || s.project_name}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.scope_summary || s.project_description}</p>
              {s.scope_json ? (
                <div className="mt-4">
                  <button onClick={() => setShowScope((v) => !v)} className="text-sm font-medium text-accent">
                    {showScope ? "Hide full scope" : "Show full scope"}
                  </button>
                  {showScope && (
                    <div className="mt-4 border-t border-line pt-4">
                      <ScopeNode value={s.scope_json} />
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">No project in COSMIC yet.</p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="text-base font-semibold">Progress reports</h2>
          {reports.length ? (
            <ul className="mt-3 divide-y divide-line">
              {reports.map((r) => (
                <li key={r.doc_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">Report {r.report_no ?? "—"}</p>
                    <p className="text-xs text-muted">
                      {fmtDate(r.report_date)}
                      {r.sessions_completed != null ? ` · ${r.sessions_completed} sessions` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs font-medium">
                    <button
                      onClick={() => openReport(r.doc_id)}
                      disabled={openingReport === r.doc_id}
                      className="rounded-md border border-line px-2.5 py-1 disabled:opacity-50"
                    >
                      {openingReport === r.doc_id ? "Opening…" : "Open PDF"}
                    </button>
                    {r.doc_url && (
                      <a href={r.doc_url} target="_blank" rel="noreferrer" className="text-muted hover:text-fg" title="Needs Drive access">
                        Doc
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No progress reports yet.</p>
          )}
        </section>
      </div>

      <CompetitionsPanel competitions={competitions} suggestions={suggested?.details ?? null} />

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="text-base font-semibold">Timeline</h2>
        <ol className="mt-4 space-y-4 border-l border-line pl-5">
          {timeline.map((m) => (
            <li key={`${m.event_type}-${m.external_ref}`} className="relative">
              <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-done" />
              <p className="text-sm font-medium">
                {LABELS[m.event_type] ?? m.event_type}
                <span className="ml-2 text-xs font-normal text-muted">{m.occurred_at ? fmtDate(m.occurred_at) : "date unknown"}</span>
              </p>
              <div className="text-sm text-muted">
                <MilestoneDetails m={m} onOpenReport={openReport} />
              </div>
            </li>
          ))}
        </ol>
      </section>
      <p className="text-xs text-muted">Last synced {fmtDate(s.last_synced_at, true)}{s.sync_error ? ` · last error: ${s.sync_error}` : ""}</p>
    </div>
  );
}
