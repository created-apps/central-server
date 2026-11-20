import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The group's activity. Anyone signed in may read it. */
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await automations(`/cases/${enc((await params).id)}/actions`));
  } catch (err) {
    return backendFailure(err);
  }
}

const schema = z.intersection(
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ADD_MENTOR"), mentor: z.string().trim().min(1), variant: z.string().trim().min(1).optional() }),
    z.object({ kind: z.literal("CS_ASSESSMENT"), deadline: z.string().trim().min(1) }),
    z.object({ kind: z.literal("PROTOTYPING_ASSESSMENT"), deadline: z.string().trim().min(1) }),
    z.object({ kind: z.literal("SCHEDULE_MEETING"), host: z.string().trim().min(1) }),
    z.object({ kind: z.literal("INTRODUCE_SRM"), srm: z.string().trim().min(1) }),
  ]),
  z.object({ idempotency_key: z.string().trim().min(1).max(200).optional() }),
);

/**
 * Sends a WhatsApp message to the group, so it is admin-only. The actor is the
 * session user, never the body, so nobody can send under another name.
 */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    const result = await automations(`/cases/${enc((await params).id)}/actions`, {
      method: "POST",
      body: { ...body.data, actor: auth.user.name },
    });
    return NextResponse.json(result);
  } catch (err) {
    return backendFailure(err);
  }
}
