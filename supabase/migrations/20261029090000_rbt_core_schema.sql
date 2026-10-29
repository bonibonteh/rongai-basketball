-- Rongai Basketball League: core schema
-- Safe to run once on a NEW Supabase project. Do not run on a project that hosts another app.
-- Every table has RLS enabled in this file; policies live in the next migration.

-- ---------------------------------------------------------------------------
-- Roles and permissions (extensible: the Director edits permissions in the portal)
-- ---------------------------------------------------------------------------
create table if not exists public.official_roles (
  key         text primary key check (key ~ '^[a-z][a-z_]{1,39}$'),
  label       text not null,
  description text not null default '',
  permissions text[] not null default '{}',
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.official_roles (key, label, description, permissions, is_system) values
  ('director',            'Tournament Director',          'Full tournament administration, official approvals, audit access.', array['*'], true),
  ('fixture_manager',     'Competition / Fixture Manager','Creates and reschedules fixtures, assigns courts and officials, manages brackets.', array['matches.view_all','matches.manage','matches.lifecycle'], true),
  ('scorekeeper',         'Courtside Scorekeeper',        'Scores assigned games, runs the clock, finalises assigned games.', array['matches.score','matches.finalize'], true),
  ('referee',             'Referee / Match Official',     'Views assigned games, submits match reports and incidents.', array['reports.submit'], true),
  ('registration_officer','Team Registration Officer',    'Reviews team registrations, rosters and eligibility.', array['teams.review'], true),
  ('stats_officer',       'Statistics and Results Officer','Verifies box scores, results and standings; reads match reports.', array['matches.view_all','stats.verify','reports.review'], true),
  ('media_officer',       'Media / Communications Officer','Drafts announcements; the Director publishes them.', array['matches.view_all','content.manage'], true),
  ('read_only',           'Read-Only Official',           'Views tournament information. Cannot change anything.', array['matches.view_all'], true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Profiles: one row per approved official. No row = no official access.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null check (char_length(btrim(full_name)) between 2 and 120),
  display_name  text check (display_name is null or char_length(btrim(display_name)) between 1 and 60),
  email         text not null,
  phone         text check (phone is null or char_length(phone) <= 30),
  role          text not null references public.official_roles(key),
  department    text not null default '' check (char_length(department) <= 80),
  bio           text not null default '' check (char_length(bio) <= 500),
  avatar_path   text check (avatar_path is null or char_length(avatar_path) <= 200),
  status        text not null default 'active' check (status in ('active','suspended','revoked')),
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_status_idx on public.profiles(status);
create unique index if not exists profiles_email_uidx on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- Account requests (no passwords are ever stored here)
-- ---------------------------------------------------------------------------
create table if not exists public.account_requests (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null check (char_length(btrim(full_name)) between 2 and 120),
  email          text not null check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone          text check (phone is null or char_length(phone) <= 30),
  requested_role text not null references public.official_roles(key) check (requested_role <> 'director'),
  reason         text not null check (char_length(btrim(reason)) between 10 and 1000),
  status         text not null default 'pending' check (status in ('pending','more_info','approved','rejected')),
  approved_role  text references public.official_roles(key),
  invited_user_id uuid,
  requested_at   timestamptz not null default now(),
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  review_notes   text check (review_notes is null or char_length(review_notes) <= 1000)
);
create unique index if not exists account_requests_open_email_uidx
  on public.account_requests (lower(email)) where status in ('pending','more_info');
create index if not exists account_requests_status_idx on public.account_requests(status, requested_at desc);

-- ---------------------------------------------------------------------------
-- Teams and players
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 2 and 80),
  short_name          text check (short_name is null or char_length(short_name) <= 12),
  pool                text check (pool is null or char_length(pool) <= 20),
  registration_status text not null default 'pending' check (registration_status in ('pending','approved','rejected')),
  is_published        boolean not null default false,
  captain_name        text check (captain_name is null or char_length(captain_name) <= 120),
  contact_phone       text check (contact_phone is null or char_length(contact_phone) <= 30),
  contact_email       text check (contact_email is null or char_length(contact_email) <= 254),
  roster_notes        text check (roster_notes is null or char_length(roster_notes) <= 2000),
  review_notes        text check (review_notes is null or char_length(review_notes) <= 1000),
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists teams_name_uidx on public.teams (lower(name));

create table if not exists public.players (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete restrict,
  full_name    text not null check (char_length(btrim(full_name)) between 2 and 120),
  jersey_no    int check (jersey_no between 0 and 99),
  position     text check (position is null or char_length(position) <= 20),
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (team_id, jersey_no)
);

-- ---------------------------------------------------------------------------
-- Matches. Score, clock and status columns can only change through the
-- functions in the third migration. Clients have no UPDATE right on them.
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id                 uuid primary key default gen_random_uuid(),
  home_team_id       uuid not null references public.teams(id) on delete restrict,
  away_team_id       uuid not null references public.teams(id) on delete restrict,
  round              text not null default 'Pool' check (char_length(round) <= 40),
  court              text not null default 'Court 1' check (char_length(court) <= 40),
  scheduled_at       timestamptz not null,
  notes              text check (notes is null or char_length(notes) <= 500),
  is_published       boolean not null default false,
  status             text not null default 'scheduled'
                       check (status in ('scheduled','ready','live','final','postponed','cancelled','under_review')),
  status_reason      text,
  period             int not null default 1 check (period between 1 and 8),
  home_score         int not null default 0 check (home_score >= 0),
  away_score         int not null default 0 check (away_score >= 0),
  home_fouls         int not null default 0 check (home_fouls >= 0),
  away_fouls         int not null default 0 check (away_fouls >= 0),
  home_timeouts      int not null default 3 check (home_timeouts >= 0),
  away_timeouts      int not null default 3 check (away_timeouts >= 0),
  clock_seconds      int not null default 600 check (clock_seconds >= 0),
  shot_clock_seconds int not null default 24 check (shot_clock_seconds between 0 and 24),
  clock_running      boolean not null default false,
  clock_updated_at   timestamptz not null default now(),
  version            int not null default 0,
  started_at         timestamptz,
  final_at           timestamptz,
  archived_at        timestamptz,
  archived_by        uuid,
  archive_reason     text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);
create index if not exists matches_status_idx on public.matches(status) where archived_at is null;
create index if not exists matches_sched_idx on public.matches(scheduled_at);

-- Append-only history of everything that happened in a match.
create table if not exists public.match_events (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches(id) on delete restrict,
  client_event_id uuid not null,
  event_type      text not null check (event_type in
                    ('score','undo_score','foul','timeout','period','clock_start','clock_stop','clock_set','shot_clock','status','correction')),
  team            text check (team in ('home','away')),
  value           int,
  period          int,
  clock_seconds   int,
  reason          text,
  home_score_after int,
  away_score_after int,
  version_after   int,
  details         jsonb not null default '{}'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (match_id, client_event_id)
);
create index if not exists match_events_match_idx on public.match_events(match_id, created_at desc);

create table if not exists public.official_assignments (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches(id) on delete restrict,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  assignment_role text not null check (assignment_role in ('scorekeeper','referee','statistician')),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (match_id, user_id, assignment_role)
);
create index if not exists official_assignments_user_idx on public.official_assignments(user_id);

create table if not exists public.match_reports (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches(id) on delete restrict,
  author_id  uuid not null default auth.uid(),
  kind       text not null check (kind in ('report','incident')),
  body       text not null check (char_length(btrim(body)) between 5 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists match_reports_match_idx on public.match_reports(match_id);

-- ---------------------------------------------------------------------------
-- Tasks, announcements, preferences, audit
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(btrim(title)) between 3 and 140),
  description   text not null default '' check (char_length(description) <= 1000),
  assigned_to   uuid not null references public.profiles(id) on delete cascade,
  match_id      uuid references public.matches(id) on delete set null,
  priority      text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at        timestamptz,
  status        text not null default 'open' check (status in ('open','in_progress','done','blocked')),
  notes         text not null default '' check (char_length(notes) <= 1000),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on public.tasks(assigned_to, status);

create table if not exists public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 3 and 140),
  body         text not null check (char_length(btrim(body)) between 3 and 4000),
  is_banner    boolean not null default false,
  status       text not null default 'draft' check (status in ('draft','pending_approval','published','archived')),
  author_id    uuid not null default auth.uid(),
  published_by uuid,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists announcements_status_idx on public.announcements(status, published_at desc);

create table if not exists public.user_dashboard_preferences (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  layout            jsonb not null default '{}'::jsonb check (pg_column_size(layout) < 20000),
  welcome_dismissed boolean not null default false,
  welcome_message   text check (welcome_message is null or char_length(welcome_message) <= 160),
  notifications     jsonb not null default '{}'::jsonb check (pg_column_size(notifications) < 5000),
  updated_at        timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,
  actor_role   text,
  action       text not null,
  target_table text,
  target_id    text,
  details      jsonb not null default '{}'::jsonb
);
create index if not exists audit_logs_at_idx on public.audit_logs(at desc);
create index if not exists audit_logs_target_idx on public.audit_logs(target_table, target_id);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.rbt_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['official_roles','profiles','teams','players','matches','tasks','announcements','user_dashboard_preferences']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.rbt_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- audit_logs and match_events are append-only for everyone, including the table owner.
create or replace function public.rbt_block_mutation() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op using errcode = 'RB403';
end $$;

drop trigger if exists audit_logs_no_update on public.audit_logs;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.rbt_block_mutation();
drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.rbt_block_mutation();
drop trigger if exists match_events_no_update on public.match_events;
create trigger match_events_no_update before update or delete on public.match_events
  for each row execute function public.rbt_block_mutation();
drop trigger if exists match_events_no_truncate on public.match_events;
create trigger match_events_no_truncate before truncate on public.match_events
  for each statement execute function public.rbt_block_mutation();
drop trigger if exists match_reports_no_update on public.match_reports;
create trigger match_reports_no_update before update or delete on public.match_reports
  for each row execute function public.rbt_block_mutation();

-- Match deletion backstop: only an untouched, scheduled fixture may ever be deleted.
create or replace function public.rbt_matches_delete_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status <> 'scheduled'
     or exists (select 1 from public.match_events e where e.match_id = old.id)
     or exists (select 1 from public.match_reports r where r.match_id = old.id) then
    raise exception 'A match that is %, or that has history, cannot be deleted. Archive it instead.', old.status
      using errcode = 'RB409';
  end if;
  return old;
end $$;
drop trigger if exists matches_delete_guard on public.matches;
create trigger matches_delete_guard before delete on public.matches
  for each row execute function public.rbt_matches_delete_guard();

-- Schedule fields can only change while a game has not started or finished.
create or replace function public.rbt_matches_schedule_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.home_team_id, new.away_team_id, new.scheduled_at, new.court, new.round)
     is distinct from (old.home_team_id, old.away_team_id, old.scheduled_at, old.court, old.round)
     and old.status not in ('scheduled','ready','postponed') then
    raise exception 'Fixture details cannot be changed while the game is %.', old.status using errcode = 'RB409';
  end if;
  return new;
end $$;
drop trigger if exists matches_schedule_guard on public.matches;
create trigger matches_schedule_guard before update on public.matches
  for each row execute function public.rbt_matches_schedule_guard();

-- Profile protection: role, status and approval fields never change through ordinary updates.
create or replace function public.rbt_profiles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.role, new.status, new.email, new.approved_by, new.approved_at)
     is distinct from (old.role, old.status, old.email, old.approved_by, old.approved_at)
     and coalesce(current_setting('rbt.admin_change', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception 'Protected profile fields can only be changed by the Director.' using errcode = 'RB403';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.rbt_profiles_guard();

-- ---------------------------------------------------------------------------
-- Row Level Security on everything
-- ---------------------------------------------------------------------------
alter table public.official_roles            enable row level security;
alter table public.profiles                  enable row level security;
alter table public.account_requests          enable row level security;
alter table public.teams                     enable row level security;
alter table public.players                   enable row level security;
alter table public.matches                   enable row level security;
alter table public.match_events              enable row level security;
alter table public.official_assignments      enable row level security;
alter table public.match_reports             enable row level security;
alter table public.tasks                     enable row level security;
alter table public.announcements             enable row level security;
alter table public.user_dashboard_preferences enable row level security;
alter table public.audit_logs                enable row level security;
