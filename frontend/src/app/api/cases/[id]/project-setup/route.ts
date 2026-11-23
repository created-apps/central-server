import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await automations(`/cases/${enc((await params).id)}/project-setup`));
  } catch (err) {
    return backendFailure(err);
  }
}

const schema = z.object({
  project_title: z.string().trim().min(1),
  // Required: COSMIC project creation needs it.
  project_description: z.string().trim().min(1).max(4000),
  curriculum_subject: z.string().trim().max(200).optional(),
});

/** Saves the Stage 5 details and queues the project-setup automation. Admin-only. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json(
      await automations(`/cases/${enc((await params).id)}/project-setup`, { method: "POST", body: { ...body.data, actor: auth.user.name } }),
    );
  } catch (err) {
    return backendFailure(err);
  }
}
