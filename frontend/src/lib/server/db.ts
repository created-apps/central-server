import "server-only";
import { Pool } from "pg";

/**
 * The accounts database: the operations dashboard's DATABASE_URL, which holds
 * public.dashboard_users. Null when unset, and then nobody can sign in.
 */
let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres requires TLS.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}
