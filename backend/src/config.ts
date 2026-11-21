import "dotenv/config";

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 4100),
  // The frontend origin(s) allowed to call the API.
  corsOrigins: list(process.env.CORS_ORIGINS ?? "http://localhost:3000"),

  // This app's own Supabase project.
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  // Verifies the session token the frontend signs at login. Must match the
  // frontend's AUTH_SECRET.
  authSecret: process.env.AUTH_SECRET ?? "",
  // Lets other services call POST /api/milestones/evaluate with the
  // X-API-Key header. Empty turns header access off.
  milestoneApiKey: (process.env.MILESTONE_API_KEY ?? "").trim(),

  // The three source projects. Read-only.
  sync: { url: process.env.SYNC_SUPABASE_URL ?? "", key: process.env.SYNC_SERVICE_ROLE_KEY ?? "" },
  cosmic: { url: process.env.COSMIC_SUPABASE_URL ?? "", key: process.env.COSMIC_SERVICE_ROLE_KEY ?? "" },
  automations: {
    url: process.env.AUTOMATIONS_SUPABASE_URL ?? "",
    key: process.env.AUTOMATIONS_SERVICE_ROLE_KEY ?? "",
  },
  cosmicScopeBucket: process.env.COSMIC_SCOPE_BUCKET ?? "project-scopes",
  signedUrlTtl: Number(process.env.COSMIC_SIGNED_URL_TTL ?? 3600),

  // The enrolment sheet.
  sheetId: process.env.ENROLLMENT_SHEET_ID ?? "",
  sheetTab: process.env.ENROLLMENT_SHEET_TAB ?? "Sheet1",
  sheetCredentialsBase64: process.env.ENROLLMENT_SHEET_CREDENTIALS_BASE64 ?? "",

  // Drive service account: exports progress-report Docs to PDF, so viewers
  // need no Drive access. Only Docs in this Shared Drive are exported.
  googleSaClientEmail: (process.env.GOOGLE_SA_CLIENT_EMAIL ?? "").trim(),
  googleSaPrivateKey: process.env.GOOGLE_SA_PRIVATE_KEY ?? "",
  googleSharedDriveId: (process.env.GOOGLE_SHARED_DRIVE_ID ?? "").trim(),

  // The LLM progress update (on track / ahead / lagging). Same model setting
  // as the booking platform. Without a key the assessment is skipped.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  progressModel: process.env.CLAUDE_PROGRESS_MODEL || "claude-sonnet-5-5",

  // Hourly by default: minute 5 of every hour.
  cronSchedule: process.env.SYNC_CRON ?? "5 * * * *",
  cronEnabled: (process.env.SYNC_CRON_ENABLED ?? "true").toLowerCase() !== "false",
  // Students processed in parallel during a sync.
  syncConcurrency: Number(process.env.SYNC_CONCURRENCY ?? 6),
};
