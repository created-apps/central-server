import "server-only";

/**
 * In-memory limit on failed sign-ins, per IP and per email: 5 in 15 minutes.
 * Enough for a single-instance internal tool.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

function over(key: string): boolean {
  const b = buckets.get(key);
  return Boolean(b && b.resetAt >= Date.now() && b.count > MAX_ATTEMPTS);
}

function hit(key: string) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else b.count += 1;
}

export const isAllowed = (ip: string, email: string) => !over(`ip:${ip}`) && !over(`email:${email}`);
export function registerFailure(ip: string, email: string) {
  hit(`ip:${ip}`);
  hit(`email:${email}`);
}
export function clearAttempts(ip: string, email: string) {
  buckets.delete(`ip:${ip}`);
  buckets.delete(`email:${email}`);
}
