"use client";

/**
 * The dashboard's two charts, drawn in plain HTML/SVG to match the look:
 * rounded "pill" bars for the programme pipeline and a half-ring gauge for
 * the progress statuses. Hatched shapes mean "nothing yet / not assessed".
 */
import { STAGES } from "@/lib/milestones";

export function PipelineChart({
  counts,
  total,
  active,
  onSelect,
}: {
  counts: Record<string, number>;
  total: number;
  active: string;
  onSelect: (type: string) => void;
}) {
  const stages = STAGES.filter((s) => s.type !== "enrolled");
  const max = Math.max(1, ...stages.map((s) => counts[s.type] ?? 0));
  const top = stages.reduce((best, s) => ((counts[s.type] ?? 0) > (counts[best.type] ?? 0) ? s : best), stages[0]);

  return (
    <div>
      <div className="flex h-44 items-end gap-2 sm:gap-3">
        {stages.map((s) => {
          const n = counts[s.type] ?? 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          const isTop = s.type === top.type && n > 0;
          const selected = active === s.type;
          return (
            <button
              key={s.type}
              type="button"
              onClick={() => onSelect(selected ? "" : s.type)}
              title={`${s.label}: ${n} of ${total} children (${pct}%)`}
              aria-pressed={selected}
              className="group relative flex h-full flex-1 flex-col items-center justify-end"
            >
              <span
                className={`mb-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-opacity ${
                  isTop || selected ? "bg-card text-fg opacity-100 shadow-sm" : "text-muted opacity-0 group-hover:opacity-100"
                }`}
              >
                {n}
              </span>
              <span
                className={`w-full max-w-[46px] rounded-full transition-all ${
                  n === 0
                    ? "hatch border border-hatch"
                    : selected || isTop
                      ? "bg-accent-strong"
                      : "bg-accent/85 group-hover:bg-accent"
                } ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : ""}`}
                style={{ height: `${Math.max(18, (n / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 sm:gap-3">
        {stages.map((s) => (
          <span key={s.type} className="min-w-0 flex-1 truncate text-center text-[10px] leading-tight text-muted sm:text-[11px]" title={s.label}>
            {s.short}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface GaugeSegment {
  key: string;
  label: string;
  value: number;
  /** A CSS colour, or "hatch" for the striped pattern. */
  color: string;
}

/** A half ring split into segments, with a headline figure in the middle. */
export function Gauge({ segments, centre, caption }: { segments: GaugeSegment[]; centre: string; caption: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const r = 80;
  const length = Math.PI * r;
  const gap = total ? 4 : 0;
  let offset = 0;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 112" className="w-full max-w-[260px]" role="img" aria-label={`${centre} ${caption}`}>
        <defs>
          <pattern id="gauge-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" strokeWidth="3" />
          </pattern>
        </defs>
        <path d={`M 20 100 A ${r} ${r} 0 0 1 180 100`} fill="none" stroke="var(--soft)" strokeWidth="26" strokeLinecap="round" />
        {total > 0 &&
          segments.map((s) => {
            if (!s.value) return null;
            const len = (s.value / total) * length;
            const dash = Math.max(0, len - gap);
            const el = (
              <path
                key={s.key}
                d={`M 20 100 A ${r} ${r} 0 0 1 180 100`}
                fill="none"
                stroke={s.color === "hatch" ? "url(#gauge-hatch)" : s.color}
                strokeWidth="26"
                strokeDasharray={`${dash} ${length}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.label}: ${s.value}`}</title>
              </path>
            );
            offset += len;
            return el;
          })}
        <text x="100" y="88" textAnchor="middle" className="fill-fg" style={{ fontSize: 34, fontWeight: 600 }}>
          {centre}
        </text>
        <text x="100" y="106" textAnchor="middle" className="fill-muted" style={{ fontSize: 10 }}>
          {caption}
        </text>
      </svg>
      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${s.color === "hatch" ? "hatch border border-hatch" : ""}`}
              style={s.color === "hatch" ? undefined : { background: s.color }}
            />
            {s.label} <span className="font-medium text-fg tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
