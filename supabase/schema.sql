-- Milestones Tracker schema. Run once in the new Supabase project's SQL editor.
--
-- Only the backend touches these tables, with the service role key. RLS is on
-- with no policies, so the anon key (used by the frontend for sign-in) cannot
-- read student data directly.

create extension if not exists pgcrypto;

-- One row per enrolled child on the enrolment sheet.
create table if not exists students (
  id                  uuid primary key default gen_random_uuid(),
  -- The student's email, lowercased; the parent's when the sheet has no student email.
  key                 text not null unique,
  student_email       text,
  parent_email        text,
  student_name        text,
  parent_name         text,
  program             text,
  track               text,
  enrolled_on         text,
  sheet_row           integer,
  -- False once the child is no longer on the sheet. Their history is kept.
  in_sheet            boolean not null default true,

  -- COSMIC: the newest project and its scope.
  cosmic_student_id   text,
  project_id          text,
  project_name        text,
  project_description text,
  project_track       text,
  project_status      text,
  scope_title         text,
  scope_summary       text,
  -- The whole scope document when COSMIC stores it as JSON.
  scope_json          jsonb,
  scope_file_name     text,
  scope_file_path     text,
  scope_approved      boolean not null default false,
  scope_approved_at   timestamptz,

  -- SYNC
  meetings_completed  integer not null default 0,

  latest_milestone    text,
  latest_milestone_at timestamptz,
  milestone_count     integer not null default 0,
  report_count        integer not null default 0,

  last_synced_at      timestamptz,
  sync_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists students_in_sheet_idx on students (in_sheet);

-- One row per milestone that holds for a child. Keyed like the booking
-- platform's counselor_feed_events: singletons use external_ref '-', repeatable
-- ones (calls, competitions, reports) are keyed on the source object.
create table if not exists milestones (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students (id) on delete cascade,
  event_type     text not null,
  external_ref   text not null default '-',
  occurred_at    timestamptz,
  details        jsonb not null default '{}'::jsonb,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (student_id, event_type, external_ref)
);

create index if not exists milestones_student_idx on milestones (student_id);
create index if not exists milestones_type_idx on milestones (event_type);

-- Every progress report for a child (the milestone only tracks the latest).
create table if not exists progress_reports (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references students (id) on delete cascade,
  doc_id             text not null,
  doc_url            text,
  report_no          integer,
  report_date        text,
  sessions_completed integer,
  group_name         text,
  first_seen_at      timestamptz not null default now(),
  unique (student_id, doc_id)
);

create index if not exists progress_reports_student_idx on progress_reports (student_id);

-- One row per cron or manual run.
create table if not exists sync_runs (
  id           uuid primary key default gen_random_uuid(),
  trigger      text not null default 'cron',
  status       text not null default 'running',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  students     integer not null default 0,
  milestones   integer not null default 0,
  errors       integer not null default 0,
  message      text
);

alter table students enable row level security;
alter table milestones enable row level security;
alter table progress_reports enable row level security;
alter table sync_runs enable row level security;

-- The LLM progress update (on track / ahead / lagging / not started).
-- Safe to run again on an existing database.
alter table students add column if not exists progress_status      text;
alter table students add column if not exists progress_headline    text;
alter table students add column if not exists progress_reason      text;
alter table students add column if not exists progress_recent_work text;
alter table students add column if not exists progress_model       text;
alter table students add column if not exists progress_input_hash  text;
alter table students add column if not exists progress_assessed_at timestamptz;
alter table students add column if not exists sessions_cancelled   integer not null default 0;
alter table students add column if not exists sessions_scheduled   integer not null default 0;
alter table students add column if not exists sessions_planned     integer;
alter table students add column if not exists last_session_date    date;
alter table students add column if not exists next_session_date    date;

-- One row per COSMIC competition enrollment, withdrawn ones included.
-- `sections` holds each requirement with the child's submission metadata (no
-- essay text). The counts cover every section; completion uses required ones.
-- Safe to run again on an existing database.
create table if not exists competitions (
  id                     uuid primary key default gen_random_uuid(),
  student_id             uuid not null references students (id) on delete cascade,
  enrollment_id          text not null,
  template_id            text,
  name                   text not null,
  status                 text,
  withdrawn              boolean not null default false,
  assigned_at            timestamptz,
  withdrawn_at           timestamptz,
  withdrawal_reason      text,
  final_deadline         date,
  competition_id_value   text,
  outcome_text           text,
  outcome_media_count    integer not null default 0,
  outcome_updated_at     timestamptz,
  sections               jsonb not null default '[]'::jsonb,
  resubmissions          jsonb not null default '[]'::jsonb,
  sections_total         integer not null default 0,
  required_total         integer not null default 0,
  required_approved      integer not null default 0,
  approved               integer not null default 0,
  submitted              integer not null default 0,
  changes_required       integer not null default 0,
  in_progress            integer not null default 0,
  not_started            integer not null default 0,
  past_due               integer not null default 0,
  next_deadline          date,
  last_seen_at           timestamptz not null default now(),
  unique (student_id, enrollment_id)
);

create index if not exists competitions_student_idx on competitions (student_id);
alter table competitions enable row level security;
