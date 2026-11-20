import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/server/current-user";

/**
 * Passes the browser's calls through to the tracker backend (Express), with
 * the session token as the bearer. The backend verifies it and enforces the
 * role itself, so this only forwards. Binary responses (report PDFs) are
 * streamed through unchanged.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = (process.env.TRACKER_API_URL || "http://localhost:4100").replace(/\/+$/, "");

async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  const { path } = await params;
  const search = new URL(req.url).search;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/${path.map(encodeURIComponent).join("/")}${search}`, {
      method: req.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": req.headers.get("content-type") ?? "application/json" } : {}),
      },
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Cannot reach the tracker backend." }, { status: 502 });
  }
  const headers = new Headers();
  for (const h of ["content-type", "content-disposition", "cache-control"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(res.body, { status: res.status, headers });
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
