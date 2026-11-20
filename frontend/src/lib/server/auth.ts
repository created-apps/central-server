import "server-only";
import bcrypt from "bcryptjs";
import { getPool } from "./db";
import type { Role, SessionUser } from "../session";

/**
 * Credential checks against public.dashboard_users, the same accounts as the
 * operations dashboard. Missing configuration fails closed: there are no
 * built-in accounts.
 */

/** A valid bcrypt hash, compared against for unknown emails so timing doesn't reveal which exist. */
const DECOY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO3jQ4pM0aQ5r9wF1lVQ2pQ0Zp1qk2wKO";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function authConfigured(): boolean {
  return Boolean(getPool());
}

/** The account for an email and password, or null for any failure (one generic message). */
export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set — credentials cannot be checked.");
  const { rows } = await pool.query(
    `select id, email, name, role, password_hash, is_active
       from public.dashboard_users
      where lower(email) = $1
      limit 1`,
    [email.trim().toLowerCase()],
  );
  const row = rows[0];
  if (!row) {
    await bcrypt.compare(password, DECOY_HASH);
    await sleep(200);
    return null;
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok || !row.is_active) {
    await sleep(200);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role as Role };
}

export async function recordLogin(userId: string): Promise<void> {
  await getPool()?.query(`update public.dashboard_users set last_login_at = now() where id = $1`, [userId]);
}
