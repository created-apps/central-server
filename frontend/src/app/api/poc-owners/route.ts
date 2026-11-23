import { NextResponse } from "next/server";
import { automations } from "@/lib/server/automations";
import { backendFailure, requireUser } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The people who can own a group's POC: Aashna, Dhruv and Urja. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await automations("/poc-owners"));
  } catch (err) {
    return backendFailure(err);
  }
}
