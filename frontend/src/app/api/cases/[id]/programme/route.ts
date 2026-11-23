import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ program_code: z.enum(["PPP", "RBP", "CMP"]) });

/**
 * Sets the group's programme. Every other action waits on it, and it is
 * copied to COSMIC, so it is admin-only. The backend refuses a change once a
 * POC owner is assigned.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema, "Choose PPP, RBP, or CMP.");
  if (!body.ok) return body.response;
  try {
    return NextResponse.json(await automations(`/cases/${enc((await params).id)}/programme`, { method: "PUT", body: body.data }));
  } catch (err) {
    return backendFailure(err);
  }
}
