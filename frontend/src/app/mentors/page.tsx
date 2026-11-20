"use client";

import { useEffect, useMemo, useState } from "react";
import { useIsAdmin } from "@/components/AuthProvider";
import { Badge, Button, Dialog, Field, inputClass, toast } from "@/components/ui";
import { ops, useMentors, type Mentor } from "@/lib/ops";

// ---------------------------------------------------------------- Named introductions

interface VariantRow {
  id: string;
  label: string;
  text: string;
}

const newRow = (): VariantRow => ({ id: Math.random().toString(36).slice(2, 10), label: "", text: "" });
const rowsFrom = (v: Record<string, string> | null | undefined): VariantRow[] =>
  Object.entries(v ?? {}).map(([label, text]) => ({ id: `${label}-${Math.random().toString(36).slice(2, 8)}`, label, text }));

/** What the default introduction is called; not usable as a label. */
const RESERVED = ["general", "default"];

/** Mirrors the backend's rules, so a bad save is caught here with a readable reason. */
function variantsFromRows(rows: VariantRow[]): { variants: Record<string, string> | null; error: string | null } {
  const started = rows.filter((r) => r.label.trim() || r.text.trim());
  if (!started.length) return { variants: null, error: null };
  const out: Record<string, string> = {};
  for (const row of started) {
    const label = row.label.trim().toLowerCase();
    const text = row.text.trim();
    if (!label) return { variants: null, error: "Give every introduction a name." };
    if (!text) return { variants: null, error: `"${label}" has no message — write it or remove the row.` };
    if (RESERVED.includes(label)) return { variants: null, error: `"${label}" is reserved — it is what the default introduction is called.` };
    if (out[label] !== undefined) return { variants: null, error: `Two introductions are both named "${label}".` };
    out[label] = text;
  }
  if (Object.keys(out).length > 12) return { variants: null, error: "At most 12 named introductions." };
  return { variants: out, error: null };
}

function VariantsField({ rows, onChange }: { rows: VariantRow[]; onChange: (r: VariantRow[]) => void }) {
  const { error } = variantsFromRows(rows);
  const update = (id: string, patch: Partial<VariantRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div>
      <p className="text-xs font-medium text-muted">Additional introductions</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Optional. Alternative wordings, one per subject or project type. When a mentor has more than one, whoever sends the introduction has to choose.
      </p>
      <div className="mt-2 space-y-2">
        {rows.map((row, i) => (
          <div key={row.id} className="space-y-2 rounded-2xl border border-line p-3.5">
            <div className="flex gap-2">
              <input
                value={row.label}
                placeholder="Name, e.g. chemistry"
                aria-label={`Introduction ${i + 1} name`}
                onChange={(e) => update(row.id, { label: e.target.value })}
                className={inputClass}
              />
              <Button variant="ghost" size="sm" onClick={() => onChange(rows.filter((r) => r.id !== row.id))}>
                Remove
              </Button>
            </div>
            <textarea
              value={row.text}
              rows={4}
              placeholder="The wording that goes out for this one…"
              aria-label={`Introduction ${i + 1} message`}
              onChange={(e) => update(row.id, { text: e.target.value })}
              className={inputClass}
            />
          </div>
        ))}
        <Button size="sm" onClick={() => onChange([...rows, newRow()])}>
          {rows.length ? "Add one more" : "Add another introduction"}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Add / edit

function AddMentor({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setIntro("");
      setEmail("");
      setPhone("");
      setRows([]);
    }
  }, [open]);
  const extra = variantsFromRows(rows);
  // Phone is required: the mentor's SYNC account is keyed on it, and it receives the group invite.
  const canSave = name.trim() && intro.trim() && phone.trim() && !extra.error && !pending;

  const save = async () => {
    setPending(true);
    try {
      await ops.createMentor({
        name: name.trim(),
        intro: intro.trim(),
        email: email.trim() || undefined,
        phone: phone.trim(),
        ...(extra.variants ? { variants: extra.variants } : {}),
      });
      toast.success("Mentor added", { description: `${name.trim()} is now in the directory.` });
      onClose();
      onDone();
    } catch (err) {
      toast.error((err as Error).message || "Could not add the mentor.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Add a mentor"
      description="Adds a mentor to the directory and gives them a SYNC mentor account. The introduction is sent verbatim over WhatsApp when they are introduced to a group."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {pending ? "Adding…" : "Add mentor"}
          </Button>
        </>
      }
    >
      <Field label="Name" hint="Use the mentor's exact name as it appears in SYNC, so Stage 5 can link them automatically.">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dr. Nirupma Singh" className={inputClass} />
      </Field>
      <Field label="Introduction message" hint="Sent as-is into the WhatsApp group. This is the default; add named alternatives below if needed.">
        <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={6} className={inputClass} />
      </Field>
      <VariantsField rows={rows} onChange={setRows} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="mentor@example.com" className={inputClass} />
        </Field>
        <Field label="Phone (required)">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" className={inputClass} />
        </Field>
      </div>
    </Dialog>
  );
}

function EditMentor({ mentor, onClose, onDone }: { mentor: Mentor | null; onClose: () => void; onDone: () => void }) {
  const [intro, setIntro] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!mentor) return;
    setIntro(mentor.intro);
    setEmail(mentor.email ?? "");
    setPhone(mentor.phone ?? "");
    setRows(rowsFrom(mentor.variants));
  }, [mentor]);
  const extra = variantsFromRows(rows);

  /** Only what changed, so a save never overwrites someone else's correction. Empty clears. */
  const changes = useMemo(() => {
    if (!mentor) return {};
    const out: { intro?: string; email?: string | null; phone?: string | null; variants?: Record<string, string> | null } = {};
    if (intro.trim() && intro.trim() !== mentor.intro.trim()) out.intro = intro.trim();
    if (email.trim() !== (mentor.email ?? "").trim()) out.email = email.trim() || null;
    if (phone.trim() !== (mentor.phone ?? "").trim()) out.phone = phone.trim() || null;
    if (!extra.error) {
      const key = (v: Record<string, string> | null | undefined) =>
        !v || !Object.keys(v).length ? "null" : JSON.stringify(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
      if (key(extra.variants) !== key(mentor.variants)) out.variants = extra.variants;
    }
    return out;
  }, [mentor, intro, email, phone, extra.error, extra.variants]);

  const canSave = Boolean(mentor) && Object.keys(changes).length > 0 && !extra.error && intro.trim() && !pending;

  const save = async () => {
    if (!mentor) return;
    setPending(true);
    try {
      await ops.updateMentor(mentor.name, changes);
      toast.success("Mentor updated", { description: `${mentor.name}'s details have changed for everyone.` });
      onClose();
      onDone();
    } catch (err) {
      toast.error((err as Error).message || "Could not save the changes.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={Boolean(mentor)}
      onClose={onClose}
      wide
      title={mentor ? `Edit ${mentor.name}` : "Edit mentor"}
      description="Changes what is sent when this mentor is introduced, and how they are identified. It takes effect immediately, for everyone. The name can't be changed."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <Field label="Email" hint="How the intake sheet identifies this mentor, matched exactly. Without one they can't be named from the sheet.">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={inputClass} />
      </Field>
      <Field label="Phone" hint="Receives the group invite, and links them to their SYNC account.">
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="919876543210" className={inputClass} />
      </Field>
      <Field label="Introduction message" hint="Sent as-is into the WhatsApp group, unless a named alternative is picked.">
        <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={8} className={inputClass} />
      </Field>
      <VariantsField rows={rows} onChange={setRows} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- Page

export default function MentorsPage() {
  const { data: mentors, error, isLoading, mutate } = useMentors();
  const isAdmin = useIsAdmin();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Mentor | null>(null);

  // The intake sheet names a mentor by exact email, so one without an email is invisible to it.
  const missingEmail = (mentors ?? []).filter((m) => !(m.email ?? "").trim());
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (mentors ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.intro.toLowerCase().includes(q));
  }, [mentors, query]);

  if (error) return <p className="rounded-3xl bg-card p-5 text-sm">{error.message || "Could not load the mentors."}</p>;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Mentors</h1>
          <p className="mt-1 text-sm text-muted">
            {mentors ? `${mentors.length} mentors. ` : ""}The roster used when introducing groups. Each introduction is sent verbatim over WhatsApp.
          </p>
        </div>
        {isAdmin && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add mentor
          </Button>
        )}
      </div>

      {missingEmail.length > 0 && (
        <p className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted">
          <span className="font-medium text-fg">
            {missingEmail.length} mentor{missingEmail.length === 1 ? " has" : "s have"} no email
          </span>{" "}
          and can&apos;t be named from the intake sheet, which matches mentors by exact email.
        </p>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search mentors"
        className="mb-4 w-full rounded-full border border-line bg-card px-4 py-2 text-sm outline-none focus:border-accent sm:max-w-sm"
      />

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-3xl bg-card shadow-[0_1px_2px_rgba(16,24,20,0.04)] p-6 text-sm text-muted">{query ? `No mentors match “${query}”.` : "No mentors yet."}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m) => {
            const variants = m.variants ? Object.keys(m.variants) : [];
            return (
              <li key={m.name} className="flex flex-col rounded-3xl bg-card p-5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{m.name}</p>
                    <p className="truncate text-xs text-muted">{[m.email, m.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
                    {!(m.email ?? "").trim() && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">No email — not nameable from the sheet</p>}
                  </div>
                  {isAdmin && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                      Edit
                    </Button>
                  )}
                </div>
                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted">{m.intro}</p>
                {variants.length > 0 && (
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                    <Badge className="bg-soft capitalize">General</Badge>
                    {variants.map((v) => (
                      <Badge key={v} className="border border-line capitalize">
                        {v}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AddMentor open={adding} onClose={() => setAdding(false)} onDone={() => mutate()} />
      <EditMentor mentor={editing} onClose={() => setEditing(null)} onDone={() => mutate()} />
    </div>
  );
}
