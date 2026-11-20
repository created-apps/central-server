import { NextResponse } from "next/server";
import { automations } from "@/lib/server/automations";
import { backendFailure, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await automations("/curriculum-subjects"));
  } catch (err) {
    return backendFailure(err);
  }
}
