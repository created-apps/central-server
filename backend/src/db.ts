import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export function dbConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

/** This app's own Supabase project, with the service role (server only). */
export const db = createClient(config.supabaseUrl || "http://localhost", config.supabaseServiceRoleKey || "unset", {
  auth: { persistSession: false, autoRefreshToken: false },
});
