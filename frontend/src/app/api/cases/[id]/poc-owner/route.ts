import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ poc_owner_id: z.string().uuid() });

/**
 * Assigns the POC owner, permanently: the first answer wins, from here or the
 * emailed links. Admin-only; the actor is the session user, never the body.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema, "Choose a POC owner.");
  if (!body.ok) return body.response;
  try {
    const result = await automations(`/cases/${enc((await params).id)}/poc-owner`, {
      method: "POST",
      body: { poc_owner_id: body.data.poc_owner_id, actor: auth.user.name },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return backendFailure(err);
  }
}
