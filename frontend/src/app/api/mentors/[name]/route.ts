import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    intro: z.string().trim().min(1).max(8000).optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().min(3).max(40).nullable().optional(),
    variants: z.record(z.string().trim().min(1).max(60), z.string().trim().min(1).max(8000)).nullable().optional(),
  })
  .refine((b) => b.intro !== undefined || b.email !== undefined || b.phone !== undefined || b.variants !== undefined, {
    message: "Nothing to change.",
  });

/** Edits a mentor's introduction, contact details or named introductions. Admin-only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  try {
    const { name } = await params;
    return NextResponse.json(await automations(`/mentors/${enc(name)}`, { method: "PATCH", body: { ...body.data, actor: auth.user.name } }));
  } catch (err) {
    return backendFailure(err);
  }
}
