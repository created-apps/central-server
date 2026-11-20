import "server-only";

/**
 * Client for the assessment-automations backend: the service that sends the
 * WhatsApp messages and runs the nudge, queue and sync crons. Server only, so
 * BACKEND_API_SECRET never reaches the browser. The actor on every write is
 * the session user, set by the route handler, never the request body.
 */

const BASE = (process.env.BACKEND_API_URL ?? "").replace(/\/+$/, "");
const SECRET = process.env.BACKEND_API_SECRET ?? "";

export class AutomationsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function automations<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!BASE || !SECRET) throw new AutomationsError("BACKEND_API_URL and BACKEND_API_SECRET are not set", 503);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${SECRET}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (err) {
    throw new AutomationsError(`Cannot reach the automations backend: ${(err as Error).message}`, 502);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok) {
    const body = (data ?? {}) as Record<string, unknown>;
    throw new AutomationsError(typeof body.error === "string" ? body.error : `Backend returned ${res.status}`, res.status, body);
  }
  return data as T;
}

export const enc = encodeURIComponent;
