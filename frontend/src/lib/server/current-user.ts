import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type SessionUser } from "../session";

/** The signed-in user from the session cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const payload = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return payload ? { id: payload.sub, email: payload.email, name: payload.name, role: payload.role } : null;
}

/** The raw session token, to forward to the tracker backend. */
export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}
