# CreatED Dashboard (Milestones Tracker)

The central staff dashboard. **Children** lists every child on the enrolment sheet with their programme milestones, competitions, project scope and progress reports. **Groups** and **Mentors** are the WhatsApp operations screens ported from `assessment_automations`.

- **backend/**: Express and TypeScript. An hourly cron reads the enrolment sheet, SYNC, COSMIC and AUTOMATIONS, all read-only, and writes each child's milestones to this app's own Supabase project. It also serves the API.
- **frontend/**: Next.js. Staff sign in with email and password, using the operations dashboard's accounts (`dashboard_users`). Its server routes call both backends, so no backend credential reaches the browser:
  - `/api/tracker/*` forwards to this app's backend, with the session token.
  - `/api/cases/*`, `/api/mentors/*` and `/api/curriculum-subjects` call the assessment-automations backend with `BACKEND_API_SECRET`. That backend is a separate service that sends the WhatsApp messages and runs its own crons.
- **supabase/schema.sql**: the tables for this app's Supabase project.

Milestone detection mirrors the booking platform's counsellor feed (`booking-platform-clean/backend/app/services/counselor_feed.py`):

- enrolled
- first consult done
- scope call with the SRM
- project confirmed
- scope approved
- competitions suggested
- competition entered
- mid-programme review
- competition outcome
- closure call
- progress reports

## Setup

1. **Create the Supabase project.** Make a new project. In its SQL editor, run `supabase/schema.sql`.
2. **Configure the backend.** In `backend/.env`, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. `AUTH_SECRET` (which must match the frontend's) and `PORT=4100` are set. These are already filled in: the source credentials, the enrolment sheet's `ENROLLMENT_SHEET_*` values and the Drive service account's `GOOGLE_SA_*` and `GOOGLE_SHARED_DRIVE_ID`.
3. **Configure the frontend.** `frontend/.env.local` is filled in:
   - `AUTH_SECRET` signs the session cookie.
   - `DATABASE_URL` is the operations dashboard's Postgres, holding `dashboard_users`.
   - `BACKEND_API_URL` and `BACKEND_API_SECRET` reach the assessment-automations backend.
   - `TRACKER_API_URL` is this app's backend.

   Accounts are created with `pnpm invite:user` in `assessment_automations/frontend`. Roles:
   - **admin** can send group actions, edit mentors, stop operations and press Refresh now.
   - **viewer** can read everything.

   Both apps enforce the roles on the server.
4. **Run both apps.**
   ```bash
   cd backend && npm install && npm run dev
   cd frontend && npm install && npm run dev -- -p 3100
   ```
   The first sync runs at the next scheduled time. To run it sooner, press **Refresh now** on the dashboard or run `npm run sync` in `backend/`.

To read the sources without writing anything, run `npm run sync -- --dry-run`. Add `--assess 2` to also run the progress update for two children.

## Configuration (backend)

| Variable | Default | Meaning |
|---|---|---|
| `SYNC_CRON` | `5 * * * *` | When the sync runs (hourly, at minute 5) |
| `SYNC_CRON_ENABLED` | `true` | `false` turns the schedule off; manual refresh still works |
| `SYNC_CONCURRENCY` | `6` | Children read in parallel |
| `AUTH_SECRET` | | Verifies sign-in sessions; must match the frontend's |
| `MILESTONE_API_KEY` | | `X-API-Key` header value for `POST /api/milestones/evaluate`, `/api/milestones/derive`, `/api/progress-reports/pdf`, `/api/scope/file` and `/api/students/timeline`; empty turns header access off |
| `ANTHROPIC_API_KEY` | | Turns on the LLM progress update |
| `CLAUDE_PROGRESS_MODEL` | `claude-sonnet-5-5` | Model for the progress update |
| `PORT` | `4100` | API port. The assessment-automations backend uses 4000 |
| `CORS_ORIGINS` | `http://localhost:3000` | Frontend origin(s) |

## Notes

- **Source access is read-only.** The app never writes to SYNC, COSMIC, AUTOMATIONS or the sheet.
- **Children who leave the sheet** are hidden from the list. Their history is kept.
- **Scope downloads** use a fresh one-hour signed link from COSMIC's private bucket, created when you click.
- **Progress reports** open as PDFs. The backend exports each Google Doc using the Drive service account (`GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`). Viewers therefore don't need Drive access. Only Docs in `GOOGLE_SHARED_DRIVE_ID`, and only reports recorded against that child, can be exported. A one-line private key is also accepted.
- **Progress update (LLM):** every child with completed sessions gets a status from Claude (on track, ahead or lagging), with a headline, a reason and their recent work. Children with no completed sessions show "Not started". The model reads the child's SYNC sessions and session summaries, plus the COSMIC project dates. The prompt and logic are a port of the booking platform's `student_progress.py`, and it uses the same `CLAUDE_PROGRESS_MODEL` (default `claude-sonnet-5-5`). Claude is only asked again when a child's sessions or summaries change, so a sync with no changes makes no calls. The first sync assesses everyone (about 226 children). Server-side refusal fallbacks are on. Without `ANTHROPIC_API_KEY` the update is skipped.
- **Competitions:** each child page has a Competitions panel. It lists every COSMIC competition enrollment, withdrawn ones included, with its sections (the template's requirements) and the status of each. The statuses come from COSMIC: approved, awaiting approval (`submitted`), changes required, in progress or not started. The panel also shows deadlines, reviewer feedback and review history, outcomes, resubmission requests, and the approved matcher suggestions with any swap requests. A section is past due when it is not approved and its internal deadline has passed. The child's answer text is never read. The dashboard shows a stats strip across all children, with a breakdown per competition. On an existing database, run `supabase/schema.sql` again to create the `competitions` table. Until you do, the sync skips competitions and the dashboard says so.
- **Milestone check (LLM):** `POST /api/milestones/evaluate` takes `student_email` and a list of milestones. Claude judges each one against the child's scope and the text of their latest 8 progress reports (exported from Drive), and returns a status (`completed`, `in_progress`, `not_started` or `unclear`), a confidence level and evidence. Nothing is stored. Other services call it with the header `X-API-Key: <MILESTONE_API_KEY>`. Without that header it needs a staff session token, like the rest of `/api`, and from the frontend it is reached at `/api/tracker/milestones/evaluate`. The key works only on this endpoint and the derived milestones, progress report PDF, scope document and student timeline endpoints.
- **Derived milestones (LLM):** `POST /api/milestones/derive` takes `student_email` and an optional `max_milestones` (3–15, default 8), as JSON or `multipart/form-data`. Claude first classifies the project from its scope (hardware, software, data_ml, research, design or mixed). It then decides the project's own ordered milestones, such as soldering and assembly for a hardware build or data collection and model training for ML. Finally it judges each one against the progress reports. The response has the same shape as the milestone check, plus `project_type` and, for each milestone, `order`, `description` and `category`. The first call for a child saves the decided milestones in `milestone_plans`. Every later call reuses those names, ids, order and categories, and only re-judges each one's status against the latest reports, so the names never change between calls. The response's `plan` says whether the names are `new`, `saved` or `regenerated`. `plan.scope_changed` is `true` when the scope changed after the plan was saved. To decide the milestones again, pass `regenerate=true`, which replaces the saved plan. `max_milestones` only applies when a plan is first decided or regenerated. A new plan needs a scope (422 without one). The endpoint takes the same `X-API-Key` header. On an existing database, run `supabase/schema.sql` again to create `milestone_plans`; until you do, this endpoint returns 503.
- **Student timeline:** `POST /api/students/timeline` takes `student_email`, as `multipart/form-data` or JSON. It returns a `multipart/form-data` response with two parts. `timeline` is JSON: the student, and their timeline entries newest first, with the same labels, dates and detail lines as the child page. `progress_report` is the latest report as a PDF file. The PDF part is left out when the child has no reports or Drive can't export one; `timeline.latest_report.error` then says why. It takes the same `X-API-Key` header.
- **Scope document:** `POST /api/scope/file` takes a `multipart/form-data` body with `student_email`. It returns the child's scope document exactly as COSMIC stores it, either a PDF (`application/pdf`) or a Word file (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`); most scopes are `.docx`. The `X-Scope-Format` (`pdf` or `docx`), `X-Scope-Approved` and `X-Scope-Approved-At` response headers describe it. It returns 404 when the child has no scope file. It takes the same `X-API-Key` header.
- **Progress report PDF:** `POST /api/progress-reports/pdf` takes a `multipart/form-data` body with `student_email`, plus an optional `report_no` (the latest report when it is left out). It returns the report as `application/pdf`, exported from Drive under the same Shared Drive checks as the dashboard download. The `X-Report-No`, `X-Report-Date` and `X-Report-Count` response headers say which report it is. Errors come back as JSON `{ "error": "..." }`. It takes the same `X-API-Key` header as the milestone check.
- **Enrolment date:** the sheet has no date column, so "Enrolled" shows no date.
- **Ports for local development:**

  | Service | Port |
  |---|---|
  | This backend | 4100 |
  | Assessment-automations backend | 4000 |
  | The old operations dashboard (still running for now) | 3000 |
  | This frontend | 3100 |

  The old dashboard and this one share the same accounts, but each has its own session cookie.
