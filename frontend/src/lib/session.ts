import { SignJWT, jwtVerify } from "jose";

/**
 * Session tokens, signed with jose (HS256). Free of Node-only imports so the
 * middleware (Edge runtime) can verify them too. The tracker backend verifies
 * the same token with the same AUTH_SECRET.
 *
 * There is no fallback secret: a built-in default would let anyone mint an
 * admin session against a deployment that forgot to set one.
 */

export type Role = "admin" | "viewer";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

export const SESSION_COOKIE = "mt_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set — sessions cannot be signed or verified.");
  return new TextEncoder().encode(value);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (
      typeof payload.sub === "string" &&
      typeof payload.email === "string" &&
      typeof payload.name === "string" &&
      (payload.role === "admin" || payload.role === "viewer")
    ) {
      return { sub: payload.sub, email: payload.email, name: payload.name, role: payload.role };
    }
    return null;
  } catch {
    return null;
  }
}
