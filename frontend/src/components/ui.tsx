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
  primary: "bg-fg text-bg hover:opacity-90",
  outline: "border border-line bg-card hover:bg-soft",
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
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm",
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
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] rounded-xl border border-line bg-card p-0 text-fg shadow-xl backdrop:bg-black/40",
        wide ? "max-w-lg" : "max-w-md",
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="-mr-1 rounded-md px-1.5 text-lg leading-none text-muted hover:text-fg">
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
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

export const inputClass = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

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
            "w-full rounded-lg border bg-card px-4 py-3 text-sm shadow-lg",
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
