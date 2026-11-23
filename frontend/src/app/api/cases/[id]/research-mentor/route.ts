import { NextResponse } from "next/server";
import { z } from "zod";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, parseBody, requireAdmin } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  mentor: z.string().trim().min(1),
  variant: z.string().trim().min(1).optional(),
});

/**
 * Assigns (or replaces) an RBP group's research mentor: they are invited,
 * introduced once they join, and become the COSMIC project mentor. Admin-only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, schema, "Choose a research mentor.");
  if (!body.ok) return body.response;
  try {
    return NextResponse.json(await automations(`/cases/${enc((await params).id)}/research-mentor`, { method: "POST", body: body.data }));
  } catch (err) {
    return backendFailure(err);
  }
}
