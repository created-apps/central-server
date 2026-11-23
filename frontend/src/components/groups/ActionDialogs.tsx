"use client";

/**
 * The six group actions. Each sends a real WhatsApp message (or, for project
 * setup, queues automation that will), so each shows the backend-rendered
 * preview before anything goes out. While nobody has joined the group
 * (AWAITING_JOIN) the action is queued instead and runs once the welcome goes
 * out.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Dialog, Field, inputClass, toast } from "@/components/ui";
import {
  MEETING_HOSTS,
  PROGRAM_CODES,
  SRMS,
  ops,
  toLocalDate,
  useCurriculumSubjects,
  useMessagePreview,
  usePocOwners,
  useProjectSetup,
  type GroupCase,
  type Mentor,
  type ProgramCode,
  type SetupStepStatus,
} from "@/lib/ops";
import { Preview, WhatsappPreview } from "./shared";

type Props = { groupCase: GroupCase; open: boolean; onClose: () => void; onDone: () => void };

const errMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message) || fallback;

function SendFooter({ onClose, onSend, disabled, pending, queueing, label = "Send message" }: {
  onClose: () => void;
  onSend: () => void;
  disabled: boolean;
  pending: boolean;
  queueing: boolean;
  label?: string;
}) {
  return (
    <>
      <Button onClick={onClose} disabled={pending}>
        Cancel
      </Button>
      <Button variant="primary" onClick={onSend} disabled={disabled || pending}>
        {pending ? "Working…" : queueing ? "Add to queue" : label}
      </Button>
    </>
  );
}

// ---------------------------------------------------------------- Assessments

const DEFAULT_DAYS = 7;

export function AssessmentDialog({ kind, groupCase, open, onClose, onDone }: Props & { kind: "CS" | "PROTOTYPING" }) {
  const defaultDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + DEFAULT_DAYS);
    return toLocalDate(d);
  };
  const [deadline, setDeadline] = useState(defaultDate);
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setDeadline(defaultDate());
      setDays(String(DEFAULT_DAYS));
    }
  }, [open]);

  // Nobody has joined: queue it, with a deadline in days counted from when it sends.
  const queueing = groupCase.stage === "AWAITING_JOIN";
  const dayCount = Number(days);
  const daysValid = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 365;
  const previewDate = useMemo(() => {
    if (!queueing) return deadline;
    const d = new Date();
    d.setDate(d.getDate() + (daysValid ? dayCount : DEFAULT_DAYS));
    return toLocalDate(d);
  }, [queueing, deadline, daysValid, dayCount]);

  const actionKind = kind === "CS" ? "CS_ASSESSMENT" : "PROTOTYPING_ASSESSMENT";
  const { message, error, isLoading } = useMessagePreview(groupCase.id, open && previewDate ? { kind: actionKind, deadline: previewDate } : null);
  const noun = kind === "CS" ? "CS assessment" : "Prototyping assessment";
  const today = toLocalDate(new Date());

  const send = async () => {
    setPending(true);
    try {
      if (queueing) {
        await ops.queueAction(groupCase.id, { kind: actionKind, deadline_days: dayCount });
        toast.success("Assessment queued", {
          description: `It sends once ${groupCase.student_name} joins the group, with a ${dayCount}-day deadline from then.`,
        });
      } else {
        await ops.sendAction(groupCase.id, { kind: actionKind, deadline });
        toast.success("Assessment sent", { description: `${groupCase.student_name} will receive it on WhatsApp.` });
      }
      onClose();
      onDone();
    } catch (err) {
      toast.error(errMessage(err, "Could not send the assessment. Please try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={queueing ? `Queue ${noun}` : `Send ${noun}`}
      description={
        queueing
          ? `Nobody has joined ${groupCase.group_name} yet. This will be queued and sent in order once the welcome message goes out.`
          : `Set a deadline, review the exact message, then send it to ${groupCase.group_name}.`
      }
      footer={
        <SendFooter
          onClose={onClose}
          onSend={send}
          pending={pending}
          queueing={queueing}
          disabled={isLoading || !message || Boolean(error) || (queueing ? !daysValid : !deadline || deadline < today)}
        />
      }
    >
      {queueing ? (
        <Field label="Deadline, in days from sending" hint="Counted from the day it actually sends, so a family who takes a while to join still gets the full window.">
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={inputClass} />
        </Field>
      ) : (
        <Field label="Submission deadline">
          <input type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
        </Field>
      )}
      <Preview message={message} error={error} groupName={groupCase.group_name} note={queueing ? "(as it would read if sent today)" : undefined} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- Booking link

export function MeetingDialog({ groupCase, open, onClose, onDone }: Props) {
  const [host, setHost] = useState<string>(MEETING_HOSTS[0]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) setHost(MEETING_HOSTS[0]);
  }, [open]);
  const { message, error, isLoading } = useMessagePreview(groupCase.id, open ? { kind: "SCHEDULE_MEETING", host } : null);
  const queueing = groupCase.stage === "AWAITING_JOIN";

  const send = async () => {
    setPending(true);
    try {
      if (queueing) {
        await ops.queueAction(groupCase.id, { kind: "SCHEDULE_MEETING", host });
        toast.success("Booking link queued", { description: `It sends once ${groupCase.student_name} joins the group.` });
      } else {
        await ops.sendAction(groupCase.id, { kind: "SCHEDULE_MEETING", host });
        toast.success("Booking link sent", { description: `${host} will host the call with ${groupCase.student_name}.` });
      }
      onClose();
      onDone();
    } catch (err) {
      toast.error(errMessage(err, "Could not send the booking link. Please try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Send booking link"
      description={`Choose who will host the intro call, then send the scheduling link to ${groupCase.group_name}.`}
      footer={<SendFooter onClose={onClose} onSend={send} pending={pending} queueing={queueing} disabled={isLoading || !message || Boolean(error)} />}
    >
      <Field label="Meeting host">
        <select value={host} onChange={(e) => setHost(e.target.value)} className={inputClass}>
          {MEETING_HOSTS.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </Field>
      <Preview message={message} error={error} groupName={groupCase.group_name} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- SRM

export function SrmDialog({ groupCase, open, onClose, onDone }: Props) {
  const [srm, setSrm] = useState<string>(SRMS[0]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) setSrm(SRMS[0]);
  }, [open]);
  const { message, error, isLoading } = useMessagePreview(groupCase.id, open ? { kind: "INTRODUCE_SRM", srm } : null);
  // The introduction only ever goes out after the family has joined.
  const queueing = groupCase.stage === "AWAITING_JOIN";

  const send = async () => {
    setPending(true);
    try {
      if (queueing) {
        await ops.queueAction(groupCase.id, { kind: "INTRODUCE_SRM", srm });
        toast.success("SRM introduction queued", { description: `${srm} will be introduced once ${groupCase.student_name} joins the group.` });
      } else {
        await ops.sendAction(groupCase.id, { kind: "INTRODUCE_SRM", srm });
        toast.success("SRM introduced", { description: `${srm} has been introduced to ${groupCase.group_name}.` });
      }
      onClose();
      onDone();
    } catch (err) {
      toast.error(errMessage(err, "Could not send the SRM introduction. Please try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Introduce SRM"
      description={
        queueing
          ? `Nobody has joined ${groupCase.group_name} yet, so the introduction is queued and goes out once the family joins.`
          : `Choose the Student Relationship Manager to introduce to ${groupCase.group_name}.`
      }
      footer={<SendFooter onClose={onClose} onSend={send} pending={pending} queueing={queueing} disabled={isLoading || !message || Boolean(error)} />}
    >
      <Field label="SRM">
        <select value={srm} onChange={(e) => setSrm(e.target.value)} className={inputClass}>
          {SRMS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Preview message={message} error={error} groupName={groupCase.group_name} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- Mentor

/** "No variant": the backend then uses the default introduction. */
const GENERAL = "__general__";

export function MentorDialog({ groupCase, mentors, open, onClose, onDone }: Props & { mentors: Mentor[] }) {
  const [name, setName] = useState("");
  // A mentor with several introductions needs an explicit pick: nothing is
  // preselected, so the general wording can't go out by accident.
  const [variant, setVariant] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setVariant(null);
    }
  }, [open]);
  useEffect(() => setVariant(null), [name]);

  const mentor = mentors.find((m) => m.name === name) ?? null;
  const variantKeys = mentor?.variants ? Object.keys(mentor.variants) : [];
  const chosen = variantKeys.length ? variant : GENERAL;
  const message = mentor && chosen ? (chosen !== GENERAL && mentor.variants?.[chosen]) || mentor.intro : "";
  const queueing = groupCase.stage === "AWAITING_JOIN";

  const send = async () => {
    if (!mentor || !chosen) return;
    const v = chosen !== GENERAL ? chosen : undefined;
    setPending(true);
    try {
      if (queueing) {
        await ops.queueAction(groupCase.id, { kind: "ADD_MENTOR", mentor: mentor.name, ...(v ? { variant: v } : {}) });
        toast.success("Mentor introduction queued", { description: `${mentor.name} will be introduced once the family joins ${groupCase.group_name}.` });
      } else {
        const result = await ops.sendAction(groupCase.id, { kind: "ADD_MENTOR", mentor: mentor.name, ...(v ? { variant: v } : {}) });
        // The introduction waits until the mentor is in the group; say so.
        const held = Boolean((result.action?.detail as { held?: boolean } | null)?.held);
        toast.success(held ? "Mentor assigned, introduction held" : "Mentor introduced", {
          description: held
            ? `${mentor.name} has been sent the group link. The introduction goes out once they join ${groupCase.group_name}.`
            : `${mentor.name} was introduced to ${groupCase.group_name}.`,
        });
      }
      onClose();
      onDone();
    } catch (err) {
      toast.error(errMessage(err, "Could not introduce the mentor. Please try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={queueing ? "Queue a mentor introduction" : "Introduce a mentor"}
      description={
        queueing
          ? `Pick a mentor and, if offered, a subject-specific introduction. Nobody has joined ${groupCase.group_name} yet, so it is queued until the welcome goes out.`
          : `Pick a mentor and, if offered, a subject-specific introduction to send to ${groupCase.group_name}.`
      }
      footer={<SendFooter onClose={onClose} onSend={send} pending={pending} queueing={queueing} disabled={!mentor || !chosen} label="Send introduction" />}
    >
      <Field label="Mentor">
        <select value={name} onChange={(e) => setName(e.target.value)} className={inputClass}>
          <option value="">Select a mentor</option>
          {mentors.map((m) => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
      </Field>
      {variantKeys.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">Which introduction? (required)</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[GENERAL, ...variantKeys].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setVariant(k)}
                className={`rounded-full border px-3 py-1 text-xs capitalize ${variant === k ? "border-accent bg-accent/10 text-accent" : "border-line hover:bg-soft"}`}
              >
                {k === GENERAL ? "General" : k}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">
            {mentor?.name} has {variantKeys.length + 1} introductions. Pick the one that fits this group&apos;s project.
          </p>
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Message preview</p>
        {mentor && chosen ? (
          <WhatsappPreview message={message} groupName={groupCase.group_name} />
        ) : (
          <p className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">
            {mentor ? "Pick an introduction to preview it." : "Select a mentor to preview the introduction."}
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Project setup

const NONE = "NONE";
const STEPS: [keyof NonNullable<ReturnType<typeof useProjectSetup>["data"]>, string][] = [
  ["step_whatsapp", "WhatsApp"],
  ["step_drive", "Drive"],
  ["step_sync", "SYNC"],
  ["step_mentor_access", "Mentor Drive access"],
  ["step_whatsapp_drive_link", "WhatsApp Drive link"],
  ["step_cosmic_student", "COSMIC student"],
  ["step_cosmic_project", "COSMIC project"],
  ["step_cosmic_sync_group", "COSMIC ↔ SYNC"],
  ["step_curriculum", "Curriculum"],
];
const STEP_STYLE: Record<SetupStepStatus, string> = {
  OK: "bg-done/15 text-done",
  FAILED: "bg-red-500/10 text-red-600 dark:text-red-400",
  PENDING: "bg-soft text-muted",
  SKIPPED: "bg-soft text-muted",
};

export function ProjectSetupDialog({ groupCase, open, onClose, onDone }: Props) {
  const { data: setup, mutate } = useProjectSetup(open ? groupCase.id : null);
  const { data: subjects } = useCurriculumSubjects();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [subject, setSubject] = useState(NONE);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(setup?.project_title ?? groupCase.project_name ?? "");
    setDescription(setup?.project_description ?? "");
    setSubject(setup?.curriculum_subject ?? NONE);
  }, [open, setup, groupCase.project_name]);

  const mentorAssigned = groupCase.stage === "MENTOR_ASSIGNED";
  const submitted = Boolean(setup?.submitted_at);

  const save = async () => {
    if (!title.trim() || !description.trim()) return;
    setPending(true);
    try {
      await ops.saveProjectSetup(groupCase.id, {
        project_title: title.trim(),
        project_description: description.trim(),
        curriculum_subject: subject,
      });
      toast.success("Project setup saved", {
        description: mentorAssigned
          ? "The setup will run automatically within a few minutes."
          : "The WhatsApp group updates within a few minutes. Drive, SYNC and COSMIC follow once a mentor is introduced.",
      });
      await mutate();
      onClose();
      onDone();
    } catch (err) {
      toast.error(errMessage(err, "Could not save. Please try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Project setup"
      description={`Enter the project details after the brainstorm. Saving queues the Stage 5 automation for ${groupCase.group_name}: it updates the WhatsApp group, links the mentor on SYNC, and creates the student Drive with the curriculum. Nothing is sent from this screen.`}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={pending || !title.trim() || !description.trim()}>
            {pending ? "Saving…" : submitted ? "Update project setup" : "Save & queue setup"}
          </Button>
        </>
      }
    >
      {!mentorAssigned && (
        <p className="rounded-2xl border border-dashed border-line p-3 text-sm text-muted">
          No mentor is assigned yet. Saving now still renames the WhatsApp group and sets its description. The Drive folder, SYNC link and COSMIC
          project follow once a mentor has been introduced.
        </p>
      )}
      <Field label="Project title" hint="Becomes the WhatsApp group title (when it's still the default) and the student's Drive folder name.">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wildfire early-warning model" className={inputClass} />
      </Field>
      <Field label="Project description (required)" hint="Shown as the WhatsApp group description, and needed before the COSMIC project is created.">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputClass} />
      </Field>
      <Field label="Curriculum" hint="The matching curriculum templates are copied into the student's Drive folder. Choose None to skip.">
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass}>
          <option value={NONE}>None</option>
          {(subjects ?? []).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      {submitted && setup && (
        <div className="space-y-2 rounded-2xl border border-line p-3.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Setup status</span>
            <Badge className={setup.status === "FAILED" ? STEP_STYLE.FAILED : setup.status === "DONE" ? STEP_STYLE.OK : STEP_STYLE.PENDING}>{setup.status}</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STEPS.map(([key, label]) => (
              <Badge key={key} className={`font-normal ${STEP_STYLE[setup[key] as SetupStepStatus] ?? STEP_STYLE.PENDING}`}>
                {label}: {String(setup[key])}
              </Badge>
            ))}
          </div>
          {setup.last_error && <p className="text-red-600 dark:text-red-400">{setup.last_error}</p>}
          {setup.drive_folder_url && (
            <a href={setup.drive_folder_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Open student Drive folder
            </a>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- Programme

/** Chosen before anything else; copied to COSMIC as program_enrolled. */
export function ProgrammeDialog({ groupCase, open, onClose, onDone }: Props) {
  const [value, setValue] = useState<ProgramCode | "">("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) setValue(groupCase.program_code ?? "");
  }, [open, groupCase.program_code]);

  const save = async () => {
    if (!value) return;
    setPending(true);
    try {
      await ops.setProgramme(groupCase.id, value);
      toast.success(`Programme set to ${value}`);
      onClose();
      onDone();
    } catch (err) {
      toast.error(errMessage(err, "Could not save the programme."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Programme"
      description="Choose the programme before any other action or setup can go ahead. It locks once a POC owner is assigned."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!value || pending}>
            {pending ? "Saving…" : "Save programme"}
          </Button>
        </>
      }
    >
      <Field label="Programme code" hint="Saved in Assessment Automations and copied to COSMIC as program_enrolled.">
        <select value={value} onChange={(e) => setValue(e.target.value as ProgramCode)} className={inputClass}>
          <option value="">Select PPP, RBP or CMP</option>
          {PROGRAM_CODES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
    </Dialog>
  );
}

// ---------------------------------------------------------------- POC owner

/** The permanent POC owner. First answer wins, here or from the emailed links. */
export function PocOwnerDialog({ groupCase, open, onClose, onDone }: Props) {
  const { data: owners } = usePocOwners();
  const [ownerId, setOwnerId] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) setOwnerId("");
  }, [open]);

  const assign = async () => {
    if (!ownerId) return;
    setPending(true);
    try {
      const result = await ops.assignPocOwner(groupCase.id, ownerId);
      toast.success(`${result.owner.name} assigned as POC owner`, {
        description: "This is final. The early COSMIC student and POC project setup will now run.",
      });
      onClose();
      onDone();
    } catch (err) {
      toast.error(errMessage(err, "Could not assign the POC owner."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Who is the POC owner?"
      description="The dashboard and the emailed links share one first-entry-wins assignment. It can't be changed afterwards, and it locks the programme."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={assign} disabled={!ownerId || pending}>
            {pending ? "Assigning…" : "Assign permanently"}
          </Button>
        </>
      }
    >
      <Field label="POC owner" hint="They get Drive access, but are not added to the WhatsApp group or SYNC membership.">
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass}>
          <option value="">{owners ? "Select Aashna, Dhruv or Urja" : "Loading…"}</option>
          {(owners ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Research mentor

/** RBP only: a research mentor alongside the regular one. */
export function ResearchMentorDialog({ groupCase, mentors, open, onClose, onDone }: Props & { mentors: Mentor[] }) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) setName("");
  }, [open]);
  const replacing = Boolean(groupCase.research_mentor_name);

  const assign = async () => {
    if (!name) return;
    setPending(true);
    try {
      const result = await ops.assignResearchMentor(groupCase.id, name);
      toast.success(result.held ? "Research mentor assigned, introduction held" : "Research mentor introduced", {
        description: [
          result.held
            ? "The introduction goes out when the research mentor joins the group."
            : "Drive access and the COSMIC mentor replacement will run automatically.",
          ...(result.warnings ?? []),
        ].join(" "),
      });
      onClose();
      onDone();
    } catch (err) {
      toast.error(errMessage(err, "Could not assign the research mentor."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={replacing ? "Replace research mentor" : "Assign research mentor"}
      description={
        replacing
          ? `${groupCase.research_mentor_name} is the current research mentor. Replacing them removes their research membership; the regular mentor stays.`
          : "The regular mentor stays. The research mentor is added alongside them."
      }
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={assign} disabled={!name || pending}>
            {pending ? "Assigning…" : replacing ? "Replace research mentor" : "Assign research mentor"}
          </Button>
        </>
      }
    >
      <Field
        label="Research mentor"
        hint="They are invited, introduced once they join, added to SYNC, given Drive access, and become the COSMIC project mentor."
      >
        <select value={name} onChange={(e) => setName(e.target.value)} className={inputClass}>
          <option value="">Select a mentor</option>
          {mentors.map((m) => (
            <option key={m.name}>{m.name}</option>
          ))}
        </select>
      </Field>
    </Dialog>
  );
}
