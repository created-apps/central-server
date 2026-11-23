/** Looking a child up by the email an outside caller gives. */
import { db } from "./db.js";

/**
 * The email, lowercased, or null when it is not a plain address. Strict on
 * purpose: the value goes into a PostgREST or() filter, so commas, brackets
 * and quotes are never let through.
 */
export function normaliseEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) ? email : null;
}

/**
 * The child whose student email (or record key, which is the parent's email
 * when the sheet has no student email) matches. A child still on the sheet
 * wins over one who has left it.
 */
export async function findStudentByEmail<T = Record<string, any>>(email: string, fields: string): Promise<T | null> {
  const { data, error } = await db
    .from("students")
    .select(fields)
    .or(`student_email.eq.${email},key.eq.${email}`)
    .order("in_sheet", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as T | null) ?? null;
}
