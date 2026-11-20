import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** What is lined up for the group, in the order it will run. */
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await automations(`/cases/${enc((await params).id)}/queue`));
  } catch (err) {
    return backendFailure(err);
  }
}

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ADD_MENTOR"), mentor: z.string().trim().min(1), variant: z.string().trim().min(1).optional() }),
  z.object({ kind: z.literal("CS_ASSESSMENT"), deadline_days: z.number().int().min(1).max(365) }),
  z.object({ kind: z.literal("PROTOTYPING_ASSESSMENT"), deadline_days: z.number().int().min(1).max(365) }),
  z.object({ kind: z.literal("SCHEDULE_MEETING"), host: z.string().trim().min(1) }),
  z.object({ kind: z.literal("INTRODUCE_SRM"), srm: z.string().trim().min(1) }),
]);

/** Queues an action to send once the family joins. Admin-only, like sending now. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    const result = await automations(`/cases/${enc((await params).id)}/queue`, { method: "POST", body: { ...body.data, actor: auth.user.name } });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return backendFailure(err);
  }
}
