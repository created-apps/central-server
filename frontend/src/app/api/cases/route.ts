import { NextResponse } from "next/server";
import { automations } from "@/lib/server/automations";
import { backendFailure, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every group, with its most recent action folded in. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await automations("/cases/summaries"));
  } catch (err) {
    return backendFailure(err);
  }
}
