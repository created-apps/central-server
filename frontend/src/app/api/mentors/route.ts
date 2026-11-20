import { NextResponse } from "next/server";
import { z } from "zod";
import { automations } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await automations("/mentors"));
  } catch (err) {
    return backendFailure(err);
  }
}

const variants = z.record(z.string().trim().min(1).max(60), z.string().trim().min(1).max(8000));
const schema = z.object({
  name: z.string().trim().min(1).max(200),
  intro: z.string().trim().min(1).max(8000),
  email: z.string().trim().email().max(320).optional(),
  // Required: the mentor's SYNC account is keyed on it, and it receives the group invite.
  phone: z.string().trim().min(3).max(40),
  variants: variants.optional(),
});

/** Adds a mentor (and their SYNC account). Admin-only. */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json(await automations("/mentors", { method: "POST", body: { ...body.data, actor: auth.user.name } }), { status: 201 });
  } catch (err) {
    return backendFailure(err);
  }
}
