import { PROGRESS, STAGES } from "@/lib/milestones";

/** One dot per programme stage; filled when the child has reached it. */
export function StageDots({ reached }: { reached: string[] }) {
  const set = new Set(reached);
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((s) => (
        <span
          key={s.type}
          title={`${s.label}${set.has(s.type) ? "" : s.optional ? " (optional, not booked)" : " (not yet)"}`}
          className={`h-2.5 w-2.5 rounded-full ${
            set.has(s.type) ? "bg-accent" : s.optional ? "border border-dashed border-hatch" : "hatch border border-hatch"
          }`}
        />
      ))}
    </div>
  );
}

export function ProgressBadge({ status }: { status: string | null }) {
  const p = PROGRESS[status ?? "unknown"] ?? PROGRESS.unknown;
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${p.className}`}>{p.label}</span>;
}
