"use client";

import { useState } from "react";
import type { CompetitionRow, CompetitionStats, SectionRow } from "@/lib/api";
import { SECTION_ORDER, SECTION_STATUS, fmtDate, pctOf } from "@/lib/milestones";

type Counts = Partial<Record<(typeof SECTION_ORDER)[number], number>>;

/** A stacked bar of section counts, one segment per status. */
export function StatusBar({ counts, className = "h-2" }: { counts: Counts; className?: string }) {
  const total = SECTION_ORDER.reduce((n, k) => n + (counts[k] ?? 0), 0);
  if (!total) return <div className={`${className} w-full rounded-full bg-soft`} />;
  return (
    <div className={`${className} flex w-full overflow-hidden rounded-full bg-soft`}>
      {SECTION_ORDER.map((k) =>
        counts[k] ? (
          <span
            key={k}
            title={`${SECTION_STATUS[k].label}: ${counts[k]}`}
            className={SECTION_STATUS[k].bar}
            style={{ width: `${((counts[k] ?? 0) / total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

function Legend({ counts }: { counts: Counts }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {SECTION_ORDER.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${SECTION_STATUS[k].bar}`} />
          {SECTION_STATUS[k].label} <span className="font-medium text-fg">{counts[k] ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "bad" }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${tone === "bad" ? "text-red-600 dark:text-red-400" : ""}`}>{value}</dd>
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  approve: "Approved",
  request_changes: "Changes requested",
  allow_resubmission: "Reopened for resubmission",
  admin_upload: "Uploaded by staff",
  reviewer_edit: "Edited by reviewer",
  word_limit_reopen: "Reopened (word limit)",
  reopen_status_corrected: "Reopened (status corrected)",
  status_corrected: "Status corrected",
};

function SectionItem({ s }: { s: SectionRow }) {
  const st = SECTION_STATUS[s.status] ?? SECTION_STATUS.not_started;
  const words =
    s.wordCount != null
      ? `${s.wordCount} words${s.minWords || s.maxWords ? ` (${[s.minWords && `min ${s.minWords}`, s.maxWords && `max ${s.maxWords}`].filter(Boolean).join(", ")})` : ""}`
      : "";
  const meta = [
    s.internalDeadline && (
      <span key="d" className={s.pastDue ? "font-medium text-red-600 dark:text-red-400" : ""}>
        {s.pastDue ? "Past due " : "Due "}
        {fmtDate(s.internalDeadline)}
      </span>
    ),
    s.submittedAt && <span key="s">Submitted {fmtDate(s.submittedAt)}</span>,
    s.reviewedAt && <span key="r">Reviewed {fmtDate(s.reviewedAt)}{s.reviewer ? ` by ${s.reviewer}` : ""}</span>,
    words && <span key="w">{words}</span>,
    s.revisionCount > 0 && <span key="v">{s.revisionCount} revision{s.revisionCount === 1 ? "" : "s"}</span>,
  ].filter(Boolean);
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{s.title}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.className}`}>{st.label}</span>
        {s.locked && <span className="text-xs text-muted">Locked until the previous step is approved</span>}
        {!s.required && <span className="text-xs text-muted">Optional</span>}
      </div>
      {meta.length > 0 && <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">{meta}</p>}
      {(s.fileName || s.linkUrl) && (
        <p className="mt-1 text-xs text-muted">
          {s.fileName && <span>File: {s.fileName}</span>}
          {s.fileName && s.linkUrl && " · "}
          {s.linkUrl && (
            <a href={s.linkUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Submitted link
            </a>
          )}
        </p>
      )}
      {s.feedback && (
        <p className="mt-1.5 rounded-md bg-soft px-2.5 py-1.5 text-xs leading-relaxed">
          <span className="font-medium">Feedback: </span>
          {s.feedback}
        </p>
      )}
      {s.history.length > 0 && (
        <details className="mt-1 text-xs text-muted">
          <summary className="cursor-pointer select-none">Review history ({s.history.length})</summary>
          <ol className="mt-1 space-y-0.5 pl-3">
            {s.history.map((h, i) => (
              <li key={i}>
                {fmtDate(h.at, true)} · {ACTIONS[h.action] ?? h.action}
                {h.by ? ` by ${h.by}` : ""}
                {h.feedback ? `: “${h.feedback}”` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function CompetitionCard({ c }: { c: CompetitionRow }) {
  const [open, setOpen] = useState(!c.withdrawn);
  const pct = pctOf(c.required_approved, c.required_total);
  // Keep sections in template order, with a heading where a group starts.
  const blocks: { group: string; items: SectionRow[] }[] = [];
  for (const s of c.sections) {
    const last = blocks[blocks.length - 1];
    if (last && last.group === s.group) last.items.push(s);
    else blocks.push({ group: s.group, items: [s] });
  }

  return (
    <li className={`rounded-lg border border-line p-4 ${c.withdrawn ? "opacity-70" : ""}`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left" aria-expanded={open}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium">{c.name}</p>
            <p className="mt-0.5 text-xs text-muted">
              {[
                c.withdrawn ? "Withdrawn" : c.status === "ready" ? "Ready" : c.status === "in_progress" ? "In progress" : c.status,
                c.assigned_at && `entered ${fmtDate(c.assigned_at)}`,
                c.final_deadline && `final deadline ${fmtDate(c.final_deadline)}`,
                c.next_deadline && `next section due ${fmtDate(c.next_deadline)}`,
                c.competition_id_value && `ID ${c.competition_id_value}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">
              {c.required_approved}/{c.required_total} <span className="font-normal text-muted">approved</span>
            </p>
            {c.past_due > 0 && <p className="text-xs font-medium text-red-600 dark:text-red-400">{c.past_due} past due</p>}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <StatusBar counts={c} />
          <span className="w-10 shrink-0 text-right text-xs text-muted">{pct}%</span>
        </div>
      </button>

      {c.withdrawn && (
        <p className="mt-2 text-xs text-muted">
          Withdrawn {fmtDate(c.withdrawn_at)}
          {c.withdrawal_reason ? `: ${c.withdrawal_reason}` : ""}
        </p>
      )}
      {c.outcome_text && (
        <p className="mt-2 rounded-md bg-done/10 px-2.5 py-1.5 text-sm">
          <span className="font-medium">Outcome: </span>
          {c.outcome_text}
          <span className="text-xs text-muted">
            {c.outcome_updated_at ? ` · ${fmtDate(c.outcome_updated_at)}` : ""}
            {c.outcome_media_count ? ` · ${c.outcome_media_count} attachment${c.outcome_media_count === 1 ? "" : "s"} in COSMIC` : ""}
          </span>
        </p>
      )}

      {open && (
        <div className="mt-3 border-t border-line pt-2">
          <Legend counts={c} />
          {c.sections.length ? (
            blocks.map((b, i) => (
              <div key={i} className="mt-2">
                {b.group && <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">{b.group}</p>}
                <ul className="divide-y divide-line">
                  {b.items.map((s) => (
                    <SectionItem key={s.id} s={s} />
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="mt-2 text-sm text-muted">This competition has no sections set up in COSMIC.</p>
          )}
          {c.resubmissions.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Resubmission requests</p>
              <ul className="mt-1 space-y-1 text-xs">
                {c.resubmissions.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium">{r.section || "A section"}</span> · requested {fmtDate(r.requestedAt)} ·{" "}
                    <span className={r.status === "pending" ? "text-accent" : "text-muted"}>{r.status}</span>
                    {r.decidedBy ? <span className="text-muted"> by {r.decidedBy}</span> : null}
                    {r.reason && r.reason !== "." ? <span className="text-muted">. Reason: {r.reason}</span> : null}
                    {r.note ? <span className="text-muted">. Note: {r.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const FIT: Record<string, string> = { TARGET: "Target", REACH: "Reach", SAFETY: "Safety" };

/** The approved matcher run, from the comps_suggested milestone. */
function Suggestions({ details }: { details: Record<string, any> }) {
  const items: any[] = details.competitions ?? [];
  const swaps: any[] = details.swaps ?? [];
  if (!items.length) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Matcher suggestions</h3>
      <ul className="mt-2 divide-y divide-line">
        {items.map((c) => (
          <li key={`${c.rank}-${c.name}`} className="py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">#{c.rank ?? "–"}</span>
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                  {c.name}
                </a>
              ) : (
                <span className="font-medium">{c.name}</span>
              )}
              {c.fit && <span className="rounded-full bg-soft px-2 py-0.5 text-xs">{FIT[c.fit] ?? c.fit}</span>}
              {c.selected && <span className="rounded-full bg-done/15 px-2 py-0.5 text-xs text-done">Selected</span>}
              {c.reviewState && c.reviewState !== "approved" && (
                <span className="text-xs text-muted">{c.reviewState === "rejected" ? "Rejected by reviewer" : "Review pending"}</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted">{[c.region, c.deadline && `deadline ${c.deadline}`].filter(Boolean).join(" · ")}</p>
            {c.reason && <p className="mt-1 text-xs leading-relaxed text-muted">{c.reason}</p>}
          </li>
        ))}
      </ul>
      {swaps.length > 0 && (
        <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Swap requests</p>
          <ul className="mt-1 space-y-1 text-xs">
            {swaps.map((w, i) => (
              <li key={i}>
                {w.from} → {w.to} · <span className={w.status === "pending" ? "text-accent" : "text-muted"}>{w.status}</span>
                <span className="text-muted">
                  {w.requestedAt ? ` · requested ${fmtDate(w.requestedAt)}` : ""}
                  {w.reason ? `. Reason: ${w.reason}` : ""}
                  {w.note ? `. Note: ${w.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The child page panel: their competitions, sections and stats. */
export function CompetitionsPanel({
  competitions,
  suggestions,
}: {
  competitions: CompetitionRow[];
  suggestions: Record<string, any> | null;
}) {
  const active = competitions.filter((c) => !c.withdrawn);
  const sum = (k: keyof CompetitionRow) => active.reduce((n, c) => n + (Number(c[k]) || 0), 0);
  const totals: Counts = Object.fromEntries(SECTION_ORDER.map((k) => [k, sum(k)]));
  const sorted = [...active, ...competitions.filter((c) => c.withdrawn)];

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="text-base font-semibold">Competitions</h2>
      {competitions.length ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Stat label="Applying for" value={active.length} />
            <Stat label="Required approved" value={`${pctOf(sum("required_approved"), sum("required_total"))}%`} />
            <Stat label="Approved" value={totals.approved} />
            <Stat label="Awaiting approval" value={totals.submitted} />
            <Stat label="Changes required" value={totals.changes_required} />
            <Stat label="Past due" value={sum("past_due")} tone={sum("past_due") ? "bad" : undefined} />
          </dl>
          <div className="mt-4">
            <StatusBar counts={totals} className="h-2.5" />
            <div className="mt-2">
              <Legend counts={totals} />
            </div>
          </div>
          <ul className="mt-5 space-y-3">
            {sorted.map((c) => (
              <CompetitionCard key={c.enrollment_id} c={c} />
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">Not entered in any competition in COSMIC yet.</p>
      )}
      {suggestions && <Suggestions details={suggestions} />}
    </section>
  );
}

/** The dashboard strip: competition stats across every child on the sheet. */
export function CompetitionStatsStrip({ stats }: { stats: CompetitionStats | null }) {
  const [showAll, setShowAll] = useState(false);
  if (!stats) return null;
  if (!stats.available) {
    return (
      <p className="mb-4 rounded-lg border border-dashed border-line bg-card px-4 py-3 text-sm text-muted">
        Competition stats appear after the competitions table is created (run supabase/schema.sql) and the next sync.
      </p>
    );
  }
  const s = stats.sections!;
  const rows = stats.byCompetition ?? [];
  const shown = showAll ? rows : rows.slice(0, 6);
  return (
    <section className="mb-4 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Competitions</h2>
        <p className="text-xs text-muted">
          {stats.entries} entries · {stats.children} children · {stats.withdrawn} withdrawn · {stats.outcomes} outcomes ·{" "}
          {stats.resubmissionRequests} resubmission and {stats.swapRequests} swap requests
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Stat label="Required approved" value={stats.completion == null ? "—" : `${stats.completion}%`} />
        <Stat label="Sections approved" value={s.approved} />
        <Stat label="Awaiting approval" value={s.submitted} />
        <Stat label="Changes required" value={s.changes_required} />
        <Stat label="In progress / not started" value={`${s.in_progress} / ${s.not_started}`} />
        <Stat
          label={`Past due (${stats.childrenWithPastDue} children)`}
          value={s.past_due}
          tone={s.past_due ? "bad" : undefined}
        />
      </dl>
      <div className="mt-3">
        <StatusBar counts={s} />
      </div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 pr-3 font-medium">Competition</th>
                <th className="px-2 font-medium text-right">Children</th>
                <th className="px-2 font-medium text-right">Approved</th>
                <th className="px-2 font-medium text-right">Awaiting</th>
                <th className="px-2 font-medium text-right">Changes</th>
                <th className="px-2 font-medium text-right">Past due</th>
                <th className="px-2 font-medium text-right">Outcomes</th>
                <th className="px-2 font-medium text-right">Withdrawn</th>
                <th className="pl-2 font-medium text-right">Resubs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.name}>
                  <td className="max-w-[18rem] truncate py-1.5 pr-3" title={r.name}>{r.name}</td>
                  <td className="px-2 text-right tabular-nums">{r.children}</td>
                  <td className="px-2 text-right tabular-nums">{r.completion == null ? "—" : `${r.completion}%`}</td>
                  <td className="px-2 text-right tabular-nums">{r.submitted}</td>
                  <td className="px-2 text-right tabular-nums">{r.changes_required}</td>
                  <td className={`px-2 text-right tabular-nums ${r.past_due ? "font-medium text-red-600 dark:text-red-400" : ""}`}>{r.past_due}</td>
                  <td className="px-2 text-right tabular-nums">{r.outcomes}</td>
                  <td className="px-2 text-right tabular-nums">{r.withdrawn}</td>
                  <td className="pl-2 text-right tabular-nums">{r.resubmissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 6 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs font-medium text-accent">
              {showAll ? "Show fewer" : `Show all ${rows.length} competitions`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
