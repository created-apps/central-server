"use client";

/**
 * Small building blocks in the tracker's own style (plain Tailwind over the
 * tokens in globals.css): buttons, a modal dialog, form fields and toasts.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- Button

type Variant = "primary" | "outline" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent shadow-sm hover:bg-accent-strong",
  outline: "border border-accent/70 bg-card text-accent hover:bg-accent-soft",
  ghost: "text-muted hover:bg-soft hover:text-fg",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

export function Button({
  variant = "outline",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------- Badge

export function Badge({ className, children, title }: { className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Dialog

/**
 * A modal on the native <dialog> element, so focus trapping and Escape come
 * from the browser. The body scrolls; the header and footer stay put.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] rounded-3xl border border-line bg-card p-0 text-fg shadow-2xl backdrop:bg-black/30 backdrop:backdrop-blur-[2px]",
        wide ? "max-w-lg" : "max-w-md",
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="-mr-1 rounded-md px-1.5 text-lg leading-none text-muted hover:text-fg">
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- Fields

export function Field({ label, hint, error, children }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </label>
  );
}

export const inputClass = "w-full rounded-xl border border-line bg-soft px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent focus:bg-card";

// ---------------------------------------------------------------- Toasts

type Toast = { id: number; kind: "success" | "error" | "info"; title: string; description?: string };
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(kind: Toast["kind"], title: string, opts?: { description?: string }) {
  const t = { id: nextId++, kind, title, description: opts?.description };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, kind === "error" ? 8000 : 5000);
}

export const toast = {
  success: (title: string, opts?: { description?: string }) => push("success", title, opts),
  error: (title: string, opts?: { description?: string }) => push("error", title, opts),
  info: (title: string, opts?: { description?: string }) => push("info", title, opts),
};

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
  return (
    <div aria-live="polite" className="fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx(
            "w-full rounded-2xl border bg-card px-4 py-3 text-sm shadow-lg",
            t.kind === "error" ? "border-red-500/40" : t.kind === "success" ? "border-done/40" : "border-line",
          )}
        >
          <p className={cx("font-medium", t.kind === "error" && "text-red-600 dark:text-red-400")}>{t.title}</p>
          {t.description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{t.description}</p>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Copy

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      aria-label={label ? `Copy ${label}` : "Copy"}
      className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-soft hover:text-fg"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------- Layout pieces

/** A white rounded panel, the basic surface of every screen. */
export function Panel({ title, action, className, children }: { title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cx("rounded-3xl bg-card p-5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** The page heading, with a subtitle and actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** An arrow in a ring, the "open" affordance on stat cards. */
export function ArrowRing({ inverted }: { inverted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
        inverted ? "border-white/70 bg-white text-accent" : "border-fg/70 text-fg",
      )}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 11 11 5M6 5h5v5" />
      </svg>
    </span>
  );
}

/**
 * One headline number. The `hero` card is filled brand green; the rest are
 * white. With `onClick` the whole card is a button (used as a filter).
 */
export function StatCard({
  label,
  value,
  note,
  hero,
  active,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  hero?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className={cx("text-[15px] font-medium", hero ? "text-white" : "text-fg")}>{label}</p>
        <ArrowRing inverted={hero} />
      </div>
      <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{value}</p>
      {note && <p className={cx("mt-3 text-xs", hero ? "text-white/80" : "text-muted")}>{note}</p>}
    </>
  );
  const cls = cx(
    "rounded-3xl p-4 text-left transition-shadow sm:p-5",
    hero ? "hero-card shadow-md" : "bg-card shadow-[0_1px_2px_rgba(16,24,20,0.04)]",
    active && !hero && "ring-2 ring-accent",
    active && hero && "ring-2 ring-accent-strong ring-offset-2 ring-offset-bg",
    onClick && "cursor-pointer hover:shadow-md",
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Initials in a coloured circle, for people with no photo. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .replace(/^(Dr\.?|Prof\.?)\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hues = ["bg-emerald-100 text-emerald-800", "bg-amber-100 text-amber-800", "bg-sky-100 text-sky-800", "bg-rose-100 text-rose-800", "bg-violet-100 text-violet-800", "bg-lime-100 text-lime-800"];
  const hue = hues[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % hues.length];
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", hue, size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm")}>
      {initials || "?"}
    </span>
  );
}
