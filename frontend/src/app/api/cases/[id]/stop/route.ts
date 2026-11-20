import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ reason: z.string().trim().max(2000).optional() });

/** Stops every automation for the group, permanently. Admin-only; the actor is the session user. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json(
      await automations(`/cases/${enc((await params).id)}/stop`, {
        method: "POST",
        body: { actor: auth.user.name, ...(body.data.reason ? { reason: body.data.reason } : {}) },
      }),
    );
  } catch (err) {
    return backendFailure(err);
  }
}
