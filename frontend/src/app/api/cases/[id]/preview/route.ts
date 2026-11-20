import { NextResponse } from "next/server";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The exact message an action would send, rendered by the backend's templates. Viewers may preview. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  try {
    return NextResponse.json(await automations(`/cases/${enc((await params).id)}/preview`, { method: "POST", body }));
  } catch (err) {
    return backendFailure(err);
  }
}
