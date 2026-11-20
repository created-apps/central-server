import { NextResponse } from "next/server";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, requireAdmin } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Drops something not yet sent. Admin-only. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; queuedId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id, queuedId } = await params;
  try {
    await automations(`/cases/${enc(id)}/queue/${enc(queuedId)}`, { method: "DELETE" });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return backendFailure(err);
  }
}
