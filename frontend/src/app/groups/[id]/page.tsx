"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useIsAdmin } from "@/components/AuthProvider";
import {
  AssessmentDialog,
  MeetingDialog,
  MentorDialog,
  PocOwnerDialog,
  ProgrammeDialog,
  ProjectSetupDialog,
  ResearchMentorDialog,
  SrmDialog,
} from "@/components/groups/ActionDialogs";
import { StageBadge, StopOperationsButton, StoppedBadge, StoppedNotice } from "@/components/groups/shared";
import { Badge, Button, CopyButton, Dialog, Field, inputClass, toast } from "@/components/ui";
import { fmtDate } from "@/lib/milestones";
import {
  ACTION_LABELS,
  formatPhone,
  ops,
  relativeTime,
  useCase,
  useCaseActions,
  useMentors,
  usePocOwners,
  useQueue,
  type CaseAction,
  type GroupCase,
  type PhoneChangeResult,
  type QueuedAction,
} from "@/lib/ops";

type ActionId = "programme" | "poc" | "cs" | "prototyping" | "meeting" | "mentor" | "research" | "srm" | "setup" | null;

interface ActionDef {
  id: Exclude<ActionId, null>;
  label: string;
  description: string;
  /** Why it can't be used yet, shown in place of the description. */
  blocked: string | null;
  highlight?: boolean;
}

/**
 * The actions a group offers, mirroring the operations dashboard:
 * - the programme comes first and every other action waits on it;
 * - the POC owner needs the family in the group, and is set once;
 * - CMP groups have no regular mentor or project setup;
 * - RBP groups add a research mentor once the regular mentor is introduced.
 */
function actionsFor(c: GroupCase): ActionDef[] {
  const needsProgramme = c.program_code ? null : "Choose the programme first";
  const list: ActionDef[] = [
    {
      id: "programme",
      label: c.program_code ? `Programme: ${c.program_code}` : "Choose programme",
      description: c.poc_owner_id ? "Locked after the POC owner assignment" : "Set PPP, RBP or CMP",
      blocked: c.poc_owner_id ? "Locked: the POC owner is assigned" : null,
      highlight: !c.program_code,
    },
    {
      id: "poc",
      label: c.poc_owner_id ? "POC owner assigned" : "Assign POC owner",
      description: "Aashna, Dhruv or Urja; first entry wins",
      blocked:
        needsProgramme ??
        (c.stage === "AWAITING_JOIN" ? "Waits until the family joins and is welcomed" : null) ??
        (c.poc_owner_id ? "Already assigned, permanently" : null),
    },
    { id: "cs", label: "CS assessment", description: "Send the Computer Science task", blocked: needsProgramme },
    { id: "prototyping", label: "Prototyping", description: "Send the Prototyping task", blocked: needsProgramme },
    { id: "meeting", label: "Booking link", description: "Send a call scheduling link", blocked: needsProgramme },
    { id: "mentor", label: "Introduce mentor", description: "Assign and introduce a mentor", blocked: needsProgramme },
    { id: "srm", label: "Introduce SRM", description: "Introduce the family's SRM", blocked: needsProgramme },
    { id: "setup", label: "Project setup", description: "Queue the Stage 5 automation", blocked: needsProgramme },
  ];
  if (c.program_code === "RBP") {
    list.push({
      id: "research",
      label: c.research_mentor_name ? "Replace research mentor" : "Assign research mentor",
      description: c.research_mentor_name ? `Currently ${c.research_mentor_name}` : "Introduce, and make them the COSMIC project mentor",
      blocked: c.mentor_intro_sent_at ? null : "Introduce the regular mentor first",
    });
  }
  // CMP uses its POC competition project, not the regular mentor flow.
  return c.program_code === "CMP" ? list.filter((a) => a.id !== "mentor" && a.id !== "setup") : list;
}

const Card = ({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) => (
  <section className="rounded-3xl bg-card p-5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {right}
    </div>
    <div className="mt-3">{children}</div>
  </section>
);

function ActionsPanel({ groupCase, onDone }: { groupCase: GroupCase; onDone: () => void }) {
  const isAdmin = useIsAdmin();
  const { data: mentors } = useMentors();
  const [active, setActive] = useState<ActionId>(null);
  const stopped = Boolean(groupCase.operations_stopped_at);
  const canSend = isAdmin && !stopped;
  const close = () => setActive(null);
  const props = { groupCase, onClose: close, onDone };

  return (
    <Card title="Actions" right={stopped ? <StoppedBadge /> : !isAdmin ? <Badge className="bg-soft text-muted">Read-only</Badge> : null}>
      <div className="grid gap-2 sm:grid-cols-2">
        {actionsFor(groupCase).map((a) => {
          const reason = !canSend ? (stopped ? "Operations are stopped for this project" : "Read-only access — ask an admin to send this") : a.blocked;
          return (
            <button
              key={a.id}
              onClick={() => setActive(a.id)}
              disabled={Boolean(reason)}
              title={reason ?? undefined}
              className={`rounded-2xl border p-3.5 text-left hover:border-accent/50 hover:bg-accent-soft/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent ${
                a.highlight && !reason ? "border-accent bg-accent-soft" : "border-line"
              }`}
            >
              <p className="text-sm font-medium">{a.label}</p>
              <p className="text-xs text-muted">{canSend && a.blocked ? a.blocked : a.description}</p>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">Every action sends a WhatsApp message to the group. Check the preview before confirming: messages cannot be unsent.</p>
      <ProgrammeDialog open={active === "programme"} {...props} />
      <PocOwnerDialog open={active === "poc"} {...props} />
      <AssessmentDialog kind="CS" open={active === "cs"} {...props} />
      <AssessmentDialog kind="PROTOTYPING" open={active === "prototyping"} {...props} />
      <MeetingDialog open={active === "meeting"} {...props} />
      <MentorDialog mentors={mentors ?? []} open={active === "mentor"} {...props} />
      <ResearchMentorDialog mentors={mentors ?? []} open={active === "research"} {...props} />
      <SrmDialog open={active === "srm"} {...props} />
      <ProjectSetupDialog open={active === "setup"} {...props} />
    </Card>
  );
}

function describeQueued(item: QueuedAction): string {
  const p = item.params ?? {};
  switch (item.kind) {
    case "ADD_MENTOR":
      return `${String(p.mentor ?? "")}${p.variant ? ` (${String(p.variant)})` : ""}`;
    case "SCHEDULE_MEETING":
      return String(p.host ?? "");
    case "INTRODUCE_SRM":
      return String(p.srm ?? "");
    default: {
      const days = Number(p.deadline_days);
      return Number.isFinite(days) ? `${days}-day deadline` : "";
    }
  }
}

const QUEUE_STYLE: Record<QueuedAction["status"], string> = {
  QUEUED: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  SENT: "bg-done/15 text-done",
  FAILED: "bg-red-500/10 text-red-600 dark:text-red-400",
  CANCELLED: "bg-soft text-muted",
};

function QueuePanel({ groupCase, version }: { groupCase: GroupCase; version: number }) {
  const { data, mutate } = useQueue(groupCase.id);
  const isAdmin = useIsAdmin();
  const [cancelling, setCancelling] = useState<string | null>(null);
  useEffect(() => {
    if (version) mutate();
  }, [version, mutate]);

  const items = (data ?? []).filter((q) => q.status !== "CANCELLED");
  if (!items.length) return null;
  const failed = items.some((q) => q.status === "FAILED");

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      await ops.cancelQueued(groupCase.id, id);
      toast.success("Removed from the queue");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message || "Could not remove it.");
    } finally {
      setCancelling(null);
    }
  };

  return (
    <Card title="Queued actions">
      <p className="text-xs text-muted">
        {failed
          ? "Something failed, so the queue is on hold. Nothing else sends until it is sorted out."
          : groupCase.stage === "AWAITING_JOIN"
            ? "These send in order once the family joins and the welcome message goes out."
            : "These are sending in order, spaced a little apart."}
      </p>
      <ol className="mt-3 space-y-2">
        {items.map((item, i) => (
          <li key={item.id} className="flex items-start justify-between gap-2 rounded-2xl border border-line px-3.5 py-2.5">
            <div>
              <p className="text-sm font-medium">
                {i + 1}. {ACTION_LABELS[item.kind] ?? item.kind}
              </p>
              {describeQueued(item) && <p className="text-xs text-muted">{describeQueued(item)}</p>}
              {item.error && <p className="text-xs text-red-600 dark:text-red-400">{item.error}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge className={QUEUE_STYLE[item.status]}>{item.status}</Badge>
              {isAdmin && item.status === "QUEUED" && (
                <Button variant="ghost" size="sm" disabled={cancelling === item.id} onClick={() => cancel(item.id)}>
                  {cancelling === item.id ? "…" : "Remove"}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

const ACTION_STATUS: Record<CaseAction["status"], [string, string]> = {
  OK: ["Delivered", "bg-done/15 text-done"],
  PENDING: ["Sending", "bg-amber-500/15 text-amber-700 dark:text-amber-400"],
  FAILED: ["Failed", "bg-red-500/10 text-red-600 dark:text-red-400"],
};

function Activity({ actions, loading }: { actions: CaseAction[] | undefined; loading: boolean }) {
  return (
    <Card title="Activity">
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !actions?.length ? (
        <p className="text-sm text-muted">No activity yet. Actions run on this group appear here.</p>
      ) : (
        <ol className="space-y-4 border-l border-line pl-5">
          {actions.map((a) => {
            const d = (a.detail ?? {}) as Record<string, unknown>;
            const [label, style] = ACTION_STATUS[a.status] ?? ACTION_STATUS.PENDING;
            return (
              <li key={a.id} className="relative">
                <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${a.status === "FAILED" ? "bg-red-500" : "bg-done"}`} />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{ACTION_LABELS[a.kind] ?? a.kind}</p>
                  <Badge className={style}>{label}</Badge>
                </div>
                {typeof d.mentor === "string" && <p className="text-sm text-muted">Mentor: {d.mentor}</p>}
                {typeof d.host === "string" && <p className="text-sm text-muted">Host: {d.host}</p>}
                {typeof d.srm === "string" && <p className="text-sm text-muted">SRM: {d.srm}</p>}
                {a.error && <p className="text-sm text-red-600 dark:text-red-400">{a.error}</p>}
                <p className="text-xs text-muted" title={fmtDate(a.created_at, true)}>
                  {relativeTime(a.created_at)}
                  {a.actor ? ` · by ${a.actor}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/** What happened to the join check and SYNC, said only when it matters. */
function phoneNotes(r: PhoneChangeResult): string[] {
  const notes: string[] = [];
  if (r.participant.status === "updated") notes.push("The join check is now waiting on the new number instead.");
  if (r.participant.status === "already_joined") notes.push("The old number is already in the WhatsApp group, so its join record was left as it is.");
  if (r.participant.status === "target_exists")
    notes.push(r.participant.joined ? "The new number is already in the WhatsApp group." : "The new number was already on the group's waiting list.");
  if (r.sync.status === "taken") notes.push(`SYNC still has the old number: another account (${r.sync.name ?? "unknown"}) already holds the new one.`);
  if (r.sync.status === "failed") notes.push("SYNC could not be updated — its account still has the old number.");
  return notes;
}

function EditPhone({ groupCase, role, onClose, onDone }: { groupCase: GroupCase; role: "student" | "parent"; onClose: () => void; onDone: () => void }) {
  const current = role === "student" ? groupCase.student_phone : groupCase.parent_phone;
  const who = (role === "student" ? groupCase.student_name : groupCase.parent_name) ?? `the ${role}`;
  const [phone, setPhone] = useState(current ?? "");
  const [pending, setPending] = useState(false);
  const digits = phone.replace(/\D/g, "");
  const canSave = digits.length >= 8 && digits.length <= 15 && digits !== (current ?? "").replace(/\D/g, "") && !pending;

  const save = async () => {
    setPending(true);
    try {
      const r = await ops.changePhone(groupCase.id, role, digits);
      if (r.unchanged) toast.info("Already that number", { description: "Nothing changed." });
      else
        toast.success(`${who}'s number updated`, {
          description: [`Now ${formatPhone(r.phone)}.`, ...phoneNotes(r), "They are not added to the WhatsApp group — share the invite link if they need to join."].join(" "),
        });
      onClose();
      onDone();
    } catch (err) {
      toast.error((err as Error).message || "Could not change the number.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change ${role} number`}
      description={`Every message for ${groupCase.group_name} goes to this number, and while the group is waiting to be joined it is the number being waited on. It is corrected in both places at once.`}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {pending ? "Saving…" : "Save number"}
          </Button>
        </>
      }
    >
      <Field
        label="Phone"
        hint={`${current ? `Currently ${formatPhone(current)}. ` : "No number on file. "}With the country code, no spaces. The new number is not added to the WhatsApp group.`}
      >
        <input inputMode="tel" autoComplete="off" value={phone} placeholder="919876543210" onChange={(e) => setPhone(e.target.value)} className={inputClass} />
      </Field>
    </Dialog>
  );
}

function Contacts({ groupCase, onDone }: { groupCase: GroupCase; onDone: () => void }) {
  const isAdmin = useIsAdmin();
  const [editing, setEditing] = useState<"student" | "parent" | null>(null);
  const contacts = (
    [
      { role: "student", label: "Student", name: groupCase.student_name, phone: groupCase.student_phone, email: groupCase.student_email },
      { role: "parent", label: "Parent", name: groupCase.parent_name, phone: groupCase.parent_phone, email: groupCase.parent_email },
    ] as const
  ).filter((c) => c.name || c.phone || c.email);

  return (
    <Card title="Contacts">
      <div className="divide-y divide-line">
        {contacts.map((c) => (
          <div key={c.role} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium">
              {c.name ?? "Unknown"} <span className="text-xs font-normal text-muted">· {c.label}</span>
            </p>
            {c.phone ? (
              <div className="flex items-center justify-between rounded-xl bg-soft px-3 py-2 text-sm tabular-nums">
                {formatPhone(c.phone)}
                <span className="flex items-center">
                  {isAdmin && (
                    <button onClick={() => setEditing(c.role)} className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-card hover:text-fg">
                      Change
                    </button>
                  )}
                  <CopyButton value={c.phone} label="phone number" />
                </span>
              </div>
            ) : (
              isAdmin && (
                <Button size="sm" onClick={() => setEditing(c.role)}>
                  Add {c.label.toLowerCase()} number
                </Button>
              )
            )}
            {c.email && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-soft px-3 py-2 text-sm">
                <span className="truncate">{c.email}</span>
                <CopyButton value={c.email} label="email" />
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && <EditPhone groupCase={groupCase} role={editing} onClose={() => setEditing(null)} onDone={onDone} />}
    </Card>
  );
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: groupCase, error, isLoading, mutate } = useCase(id);
  const { data: pocOwners } = usePocOwners();
  const { data: actions, isLoading: actionsLoading, mutate: mutateActions } = useCaseActions(id);
  const [version, setVersion] = useState(0);
  const refresh = () => {
    mutate();
    mutateActions();
    setVersion((v) => v + 1);
  };

  if (error) return <p className="rounded-3xl bg-card p-5 text-sm">{error.message || "Could not load the group."}</p>;
  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!groupCase) {
    return (
      <div className="space-y-3">
        <Link href="/groups" className="inline-flex items-center gap-1 rounded-full bg-card px-3.5 py-1.5 text-sm text-muted hover:text-fg">← All groups</Link>
        <p className="rounded-3xl bg-card p-5 text-sm">This group doesn&apos;t exist or may have been removed.</p>
      </div>
    );
  }

  const pocOwner = pocOwners?.find((o) => o.id === groupCase.poc_owner_id);
  const meta = [
    ["Programme", groupCase.program_code],
    ["Project", groupCase.project_name],
    ["Source", groupCase.source],
    ["Sheet row", groupCase.sheet_row ? `Row ${groupCase.sheet_row}` : null],
  ].filter(([, v]) => v);

  return (
    <div className="space-y-5">
      <Link href="/groups" className="inline-flex items-center gap-1 rounded-full bg-card px-3.5 py-1.5 text-sm text-muted hover:text-fg">← All groups</Link>

      <section className="rounded-3xl bg-card p-5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{groupCase.group_name}</h1>
            <p className="mt-1 text-sm text-muted">
              {groupCase.student_name}
              {groupCase.mentor_name ? ` · Mentor: ${groupCase.mentor_name}` : ""}
              {groupCase.pending_mentor_name ? ` · ${groupCase.pending_mentor_name} invited, not joined yet` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StageBadge stage={groupCase.stage} />
            <StopOperationsButton groupCase={groupCase} onDone={refresh} />
          </div>
        </div>
        {meta.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {meta.map(([k, v]) => (
              <span key={k}>
                <span className="text-muted">{k}:</span> <span className="font-medium">{v}</span>
              </span>
            ))}
          </p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {groupCase.operations_stopped_at && <StoppedNotice groupCase={groupCase} />}
          <ActionsPanel groupCase={groupCase} onDone={refresh} />
          <QueuePanel groupCase={groupCase} version={version} />
          <Activity actions={actions} loading={actionsLoading} />
        </div>
        <div className="space-y-5">
          <Contacts groupCase={groupCase} onDone={refresh} />
          <Card title="Group details">
            <dl className="space-y-2 text-sm">
              {[
                ["Created", fmtDate(groupCase.created_at)],
                ["Last updated", relativeTime(groupCase.updated_at)],
                ["Mentor intro", groupCase.mentor_intro_sent_at ? fmtDate(groupCase.mentor_intro_sent_at) : "Not sent"],
                ["POC owner", pocOwner?.name ?? (groupCase.poc_owner_id ? "Assigned" : "Not assigned")],
                ...(groupCase.program_code === "RBP"
                  ? [
                      [
                        "Research mentor",
                        groupCase.research_mentor_name ??
                          (groupCase.pending_research_mentor_name ? `${groupCase.pending_research_mentor_name} (not joined yet)` : "Not assigned"),
                      ],
                    ]
                  : []),
                ["First class", groupCase.first_class_confirmed_at ? fmtDate(groupCase.first_class_confirmed_at) : "Not confirmed"],
                ["Nudges", groupCase.nudge_count > 0 ? `${groupCase.nudge_count} · last ${relativeTime(groupCase.last_nudged_at)}` : "None"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
              {groupCase.invite_link && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Invite link</dt>
                  <dd className="flex items-center gap-1">
                    <a href={groupCase.invite_link} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
                      Open
                    </a>
                    <CopyButton value={groupCase.invite_link} label="invite link" />
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
