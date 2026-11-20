"use client";

import { useState } from "react";
import { useIsAdmin } from "@/components/AuthProvider";
import { Badge, Button, Dialog, toast } from "@/components/ui";
import { fmtDate } from "@/lib/milestones";
import { ops, STAGE_LABELS, STAGE_STYLES, type Stage } from "@/lib/ops";

export function StageBadge({ stage }: { stage: Stage }) {
  const s = STAGE_STYLES[stage] ?? STAGE_STYLES.ABANDONED;
  return (
    <Badge className={s.badge}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {STAGE_LABELS[stage] ?? stage}
    </Badge>
  );
}

export function StoppedBadge() {
  return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">Stopped</Badge>;
}

/** The exact WhatsApp message, as an outgoing chat bubble. */
export function WhatsappPreview({ message, groupName }: { message: string; groupName?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-[#e6ddd4] p-3 dark:bg-[#0b141a]">
      {groupName && <p className="mb-2 truncate text-center text-[11px] font-medium text-black/50 dark:text-white/50">{groupName}</p>}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-[#d9fdd3] px-2.5 py-1.5 text-sm text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message || " "}</p>
        </div>
      </div>
    </div>
  );
}

export function Preview({ message, error, groupName, note }: { message: string | null; error?: string | null; groupName: string; note?: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">Message preview{note ? ` ${note}` : ""}</p>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : message == null ? (
        <p className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">Loading preview…</p>
      ) : (
        <WhatsappPreview message={message} groupName={groupName} />
      )}
    </div>
  );
}

export interface StoppableCase {
  id: string;
  group_name: string;
  student_name: string;
  operations_stopped_at: string | null;
  operations_stopped_by?: string | null;
}

/** Everything the switch turns off, in the order a family would notice it. */
const HALTS = [
  "Queued actions — anything lined up is cancelled and nothing new sends",
  "Mentor introductions, assessments and booking links",
  "The daily mentor chase in Slack",
  "The first-class chase and the assessment-completion announcements",
  "The Stage 5 project setup — WhatsApp, Drive, SYNC and Cosmic",
  "The join and welcome check on the WhatsApp group itself",
  "The intake sheet sync for this row",
];

/**
 * The kill switch. Hidden for viewers; a plain badge once stopped. The
 * confirmation spells out what stops, because it cannot be undone here.
 */
export function StopOperationsButton({ groupCase, onDone, label = "Stop operations" }: { groupCase: StoppableCase; onDone?: () => void; label?: string }) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  if (groupCase.operations_stopped_at) return <StoppedBadge />;
  if (!isAdmin) return null;

  const stop = async () => {
    setPending(true);
    try {
      const r = await ops.stop(groupCase.id);
      if (r.already_stopped) toast.info("Already stopped", { description: "Nothing was running for this project." });
      else
        toast.success(`Stopped ${groupCase.group_name}`, {
          description: `${r.cancelled ? `${r.cancelled} queued action${r.cancelled === 1 ? "" : "s"} cancelled. ` : ""}No automation will touch this project again.`,
        });
      setOpen(false);
      onDone?.();
    } catch (err) {
      toast.error((err as Error).message || "Could not stop this project.");
    } finally {
      setPending(false);
    }
  };

  return (
    // The list renders this inside a clickable row; keep clicks here.
    <span onClick={(e) => e.stopPropagation()}>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={<span className="text-red-600 dark:text-red-400">Stop all operations?</span>}
        description={
          <>
            This stops every automation for <span className="font-medium text-fg">{groupCase.group_name}</span> ({groupCase.student_name}). It
            takes effect immediately and cannot be undone from the dashboard.
          </>
        }
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={stop} disabled={pending}>
              {pending ? "Stopping…" : "OK, stop everything"}
            </Button>
          </>
        }
      >
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">What stops</p>
          <ul className="mt-1.5 space-y-1 text-sm text-muted">
            {HALTS.map((h) => (
              <li key={h}>— {h}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">Messages already sent are not affected, and the group&apos;s history stays on its page.</p>
      </Dialog>
    </span>
  );
}

export function StoppedNotice({ groupCase }: { groupCase: StoppableCase }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
      <p className="text-sm font-medium text-red-600 dark:text-red-400">Operations stopped</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Every automation for this project is off and nothing can be sent to the group. Stopped {fmtDate(groupCase.operations_stopped_at, true)}
        {groupCase.operations_stopped_by ? ` by ${groupCase.operations_stopped_by}` : ""}. Restarting it is a deliberate change in the
        database, not a button here.
      </p>
    </div>
  );
}
