import { NextResponse } from "next/server";
import { z } from "zod";
import { recordLogin, verifyCredentials } from "@/lib/server/auth";
import { clearAttempts, isAllowed, registerFailure } from "@/lib/server/rate-limit";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

export const runtime = "nodejs";

const GENERIC = "Those details don't match an account.";
const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: GENERIC }, { status: 400 });
  const { email, password } = parsed.data;
  const ip = clientIp(req);
  if (!isAllowed(ip, email)) return NextResponse.json({ error: "Too many attempts, try again shortly." }, { status: 429 });

  let user;
  try {
    user = await verifyCredentials(email, password);
  } catch (err) {
    console.error("sign-in:", (err as Error).message);
    return NextResponse.json({ error: "Sign-in is not configured on this server." }, { status: 503 });
  }
  if (!user) {
    registerFailure(ip, email);
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  }
  clearAttempts(ip, email);
  await recordLogin(user.id).catch(() => undefined);

  const token = await signSession({ sub: user.id, email: user.email, name: user.name, role: user.role });
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
