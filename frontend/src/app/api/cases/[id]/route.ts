import { NextResponse } from "next/server";
import { automations, enc } from "@/lib/server/automations";
import { backendFailure, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await automations(`/cases/${enc((await params).id)}`));
  } catch (err) {
    return backendFailure(err);
  }
}
