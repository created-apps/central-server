import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ role: z.enum(["student", "parent"]), phone: z.string().trim().min(8).max(24) });

/** Changes which number the automations use for the student or parent. Admin-only. */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema, "Give the number in full, with its country code.");
  if (!body.ok) return body.response;
  try {
    return NextResponse.json(
      await automations(`/cases/${enc((await params).id)}/phone`, { method: "PATCH", body: { ...body.data, actor: auth.user.name } }),
    );
  } catch (err) {
    return backendFailure(err);
  }
}
