import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "./current-user";
import { AutomationsError } from "./automations";
import type { SessionUser } from "../session";

type Guard = { ok: true; user: SessionUser } | { ok: false; response: NextResponse };

export async function requireUser(): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "You are not signed in." }, { status: 401 }) };
  return { ok: true, user };
}

/**
 * Anything that sends, changes or stops something is admin-only. Disabled
 * buttons are a convenience; this is the enforcement.
 */
export async function requireAdmin(): Promise<Guard> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (auth.user.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Read-only access — ask an admin to do this" }, { status: 403 }),
    };
  }
  return auth;
}

/** Parses a JSON body against a schema, or returns the 400 to send. */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
  message = "Invalid request.",
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const raw = await req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: message, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/** A backend failure as a response, without leaking internals. */
export function backendFailure(err: unknown): NextResponse {
  if (err instanceof AutomationsError) {
    // 422 carries the mentor suggestions the dialog shows, so pass it through.
    return NextResponse.json({ error: err.message, ...err.details }, { status: err.status });
  }
  console.error("route error:", err);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
