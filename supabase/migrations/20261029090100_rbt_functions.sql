-- Rongai Basketball League: helper and trusted functions.
-- All privileged changes go through these. Each one re-checks the caller in the database.
-- Errors use custom codes: RB400 invalid input, RB403 not allowed, RB404 not found, RB409 conflict / wrong state.

-- ---------------------------------------------------------------------------
-- Permission helpers (used by RLS policies and by the functions below)
-- ---------------------------------------------------------------------------
create or replace function public.rbt_has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select true
    from public.profiles pr
    join public.official_roles r on r.key = pr.role
    where pr.id = auth.uid()
      and pr.status = 'active'
      and ('*' = any(r.permissions) or p = any(r.permissions))
    limit 1), false);
$$;

create or replace function public.rbt_is_official() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.rbt_my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.rbt_is_assigned(p_match uuid, p_role text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select public.rbt_is_official() and exists (
    select 1 from public.official_assignments a
    where a.match_id = p_match and a.user_id = auth.uid()
      and (p_role is null or a.assignment_role = p_role));
$$;

create or replace function public.rbt_can_score(p_match uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.rbt_has_perm('matches.score')
     and (public.rbt_is_assigned(p_match, 'scorekeeper') or public.rbt_has_perm('matches.manage'));
$$;

create or replace function public.rbt_role_is_elevated(p_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select permissions && array['*','access.manage'] from public.official_roles where key = p_role), false);
$$;

create or replace function public.rbt_audit(p_action text, p_table text, p_id text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(actor_id, actor_role, action, target_table, target_id, details)
  values (auth.uid(), (select role from public.profiles where id = auth.uid()), p_action, p_table, p_id, coalesce(p_details, '{}'::jsonb));
end $$;

create or replace function public.rbt_require_official() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.rbt_is_official() then
    raise exception 'You do not have an active official account.' using errcode = 'RB403';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Public intake: account requests and team registrations
-- ---------------------------------------------------------------------------
create or replace function public.submit_account_request(
  p_full_name text, p_email text, p_phone text, p_requested_role text, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if p_requested_role is null or p_requested_role = 'director'
     or not exists (select 1 from public.official_roles where key = p_requested_role) then
    raise exception 'Choose one of the listed roles.' using errcode = 'RB400';
  end if;
  if (select count(*) from public.account_requests where requested_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many requests right now. Try again later.' using errcode = 'RB429';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'This email already belongs to an official. Use Forgot Password if you cannot sign in.' using errcode = 'RB409';
  end if;
  begin
    insert into public.account_requests(full_name, email, phone, requested_role, reason)
    values (btrim(p_full_name), v_email, nullif(btrim(coalesce(p_phone,'')), ''), p_requested_role, btrim(p_reason))
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'A request for this email is already waiting for review.' using errcode = 'RB409';
    when check_violation then
      raise exception 'Some details are missing or too short. Check the form and try again.' using errcode = 'RB400';
  end;
  return v_id;
end $$;

create or replace function public.submit_team_registration(
  p_team_name text, p_captain text, p_phone text, p_email text, p_roster text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if (select count(*) from public.teams where created_at > now() - interval '1 hour' and registration_status = 'pending') >= 30 then
    raise exception 'Too many registrations right now. Try again later.' using errcode = 'RB429';
  end if;
  begin
    insert into public.teams(name, captain_name, contact_phone, contact_email, roster_notes, registration_status, is_published)
    values (btrim(p_team_name), btrim(p_captain), nullif(btrim(coalesce(p_phone,'')), ''),
            nullif(lower(btrim(coalesce(p_email,''))), ''), nullif(btrim(coalesce(p_roster,'')), ''), 'pending', false)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'A team with this name is already registered.' using errcode = 'RB409';
    when check_violation then
      raise exception 'Some details are missing or too long. Check the form and try again.' using errcode = 'RB400';
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Official access management (Director)
-- ---------------------------------------------------------------------------
create or replace function public.review_account_request(p_id uuid, p_decision text, p_notes text default null)
returns public.account_requests language plpgsql security definer set search_path = public as $$
declare r public.account_requests;
begin
  if not public.rbt_has_perm('access.manage') then
    raise exception 'Only the Director can review account requests.' using errcode = 'RB403';
  end if;
  if p_decision not in ('rejected','more_info') then
    raise exception 'Unknown decision.' using errcode = 'RB400';
  end if;
  select * into r from public.account_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'RB404'; end if;
  if r.status not in ('pending','more_info') then
    raise exception 'This request was already %.', r.status using errcode = 'RB409';
  end if;
  if lower(r.email) = lower((select email from public.profiles where id = auth.uid())) then
    raise exception 'You cannot review your own request.' using errcode = 'RB403';
  end if;
  update public.account_requests
     set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(btrim(coalesce(p_notes,'')), '')
   where id = p_id returning * into r;
  perform public.rbt_audit('account_request.' || p_decision, 'account_requests', p_id::text,
                           jsonb_build_object('email', r.email, 'notes', r.review_notes));
  return r;
end $$;

-- Called by the official-admin Edge Function, with the Director's own token, after Auth has
-- created the invited user. The function checks that the Auth user really has the request's email.
create or replace function public.approve_account_request(p_id uuid, p_user_id uuid, p_role text, p_department text default '')
returns public.profiles language plpgsql security definer set search_path = public, auth as $$
declare r public.account_requests; v_caller_role text := public.rbt_my_role(); p public.profiles; v_auth_email text;
begin
  if not public.rbt_has_perm('access.manage') then
    raise exception 'Only the Director can approve account requests.' using errcode = 'RB403';
  end if;
  if not exists (select 1 from public.official_roles where key = p_role) then
    raise exception 'Unknown role.' using errcode = 'RB400';
  end if;
  if public.rbt_role_is_elevated(p_role) and v_caller_role <> 'director' then
    raise exception 'Only the Director can grant an administrative role.' using errcode = 'RB403';
  end if;
  select * into r from public.account_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'RB404'; end if;
  if r.status not in ('pending','more_info') then
    raise exception 'This request was already %.', r.status using errcode = 'RB409';
  end if;
  if p_user_id = auth.uid() or lower(r.email) = lower((select email from public.profiles where id = auth.uid())) then
    raise exception 'You cannot approve your own request.' using errcode = 'RB403';
  end if;
  select lower(email) into v_auth_email from auth.users where id = p_user_id;
  if v_auth_email is null or v_auth_email <> lower(r.email) then
    raise exception 'The invited account does not match the request email.' using errcode = 'RB400';
  end if;
  insert into public.profiles(id, full_name, email, phone, role, department, status, approved_by, approved_at)
  values (p_user_id, r.full_name, lower(r.email), r.phone, p_role, left(coalesce(p_department,''), 80), 'active', auth.uid(), now())
  on conflict (id) do update
    set role = excluded.role, department = excluded.department, status = 'active',
        approved_by = excluded.approved_by, approved_at = excluded.approved_at
  returning * into p;
  update public.account_requests
     set status = 'approved', approved_role = p_role, invited_user_id = p_user_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  perform public.rbt_audit('account_request.approved', 'account_requests', p_id::text,
                           jsonb_build_object('email', r.email, 'role', p_role, 'user_id', p_user_id));
  return p;
end $$;

create or replace function public.admin_set_official(p_user uuid, p_role text default null, p_department text default null, p_status text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare t public.profiles; v_caller_role text := public.rbt_my_role(); v_new_role text; v_new_status text;
begin
  if not public.rbt_has_perm('access.manage') then
    raise exception 'Only the Director can change official access.' using errcode = 'RB403';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot change your own role or access.' using errcode = 'RB403';
  end if;
  select * into t from public.profiles where id = p_user for update;
  if not found then raise exception 'Official not found.' using errcode = 'RB404'; end if;
  v_new_role := coalesce(p_role, t.role);
  v_new_status := coalesce(p_status, t.status);
  if v_new_status not in ('active','suspended','revoked') then
    raise exception 'Unknown status.' using errcode = 'RB400';
  end if;
  if not exists (select 1 from public.official_roles where key = v_new_role) then
    raise exception 'Unknown role.' using errcode = 'RB400';
  end if;
  if v_caller_role <> 'director' and (public.rbt_role_is_elevated(v_new_role) or public.rbt_role_is_elevated(t.role)) then
    raise exception 'Only the Director can change an administrative account.' using errcode = 'RB403';
  end if;
  if t.role = 'director' and t.status = 'active'
     and (v_new_role <> 'director' or v_new_status <> 'active')
     and (select count(*) from public.profiles where role = 'director' and status = 'active') <= 1 then
    raise exception 'The tournament must keep at least one active Director.' using errcode = 'RB409';
  end if;
  update public.profiles
     set role = v_new_role, status = v_new_status, department = left(coalesce(p_department, department), 80)
   where id = p_user returning * into t;
  perform public.rbt_audit('official.access_changed', 'profiles', p_user::text,
                           jsonb_build_object('role', t.role, 'status', t.status, 'department', t.department));
  return t;
end $$;

create or replace function public.set_role_permissions(p_role text, p_permissions text[])
returns public.official_roles language plpgsql security definer set search_path = public as $$
declare r public.official_roles; v_allowed text[] := array[
  'matches.view_all','matches.manage','matches.lifecycle','matches.score','matches.finalize','matches.correct',
  'matches.cancel_live','matches.archive','matches.restore','reports.submit','reports.review','teams.review',
  'stats.verify','content.manage','content.publish','tasks.manage','audit.read','access.manage','config.manage'];
begin
  if coalesce(public.rbt_my_role(), '') <> 'director' then
    raise exception 'Only the Director can change role permissions.' using errcode = 'RB403';
  end if;
  if p_role = 'director' then
    raise exception 'The Director role always has full access.' using errcode = 'RB403';
  end if;
  if exists (select 1 from unnest(coalesce(p_permissions, '{}')) x where x <> all (v_allowed)) then
    raise exception 'Unknown permission in list.' using errcode = 'RB400';
  end if;
  update public.official_roles set permissions = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(coalesce(p_permissions,'{}')) x)
   where key = p_role returning * into r;
  if not found then raise exception 'Role not found.' using errcode = 'RB404'; end if;
  perform public.rbt_audit('role.permissions_changed', 'official_roles', p_role, jsonb_build_object('permissions', r.permissions));
  return r;
end $$;

create or replace function public.list_assignable_officials()
returns table(id uuid, name text, role text, department text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.display_name, p.full_name), p.role, p.department
  from public.profiles p
  where p.status = 'active'
    and (public.rbt_has_perm('matches.manage') or public.rbt_has_perm('tasks.manage') or public.rbt_has_perm('access.manage'))
  order by 2;
$$;

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
create or replace function public.review_team(p_team uuid, p_decision text, p_notes text default null)
returns public.teams language plpgsql security definer set search_path = public as $$
declare t public.teams;
begin
  if not public.rbt_has_perm('teams.review') then
    raise exception 'You cannot review team registrations.' using errcode = 'RB403';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Unknown decision.' using errcode = 'RB400'; end if;
  update public.teams
     set registration_status = p_decision, is_published = (p_decision = 'approved'),
         review_notes = nullif(btrim(coalesce(p_notes,'')), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_team returning * into t;
  if not found then raise exception 'Team not found.' using errcode = 'RB404'; end if;
  perform public.rbt_audit('team.' || p_decision, 'teams', p_team::text, jsonb_build_object('name', t.name));
  return t;
end $$;

-- ---------------------------------------------------------------------------
-- Announcements and tasks
-- ---------------------------------------------------------------------------
create or replace function public.set_announcement_status(p_id uuid, p_to text)
returns public.announcements language plpgsql security definer set search_path = public as $$
declare a public.announcements;
begin
  perform public.rbt_require_official();
  select * into a from public.announcements where id = p_id for update;
  if not found then raise exception 'Announcement not found.' using errcode = 'RB404'; end if;
  if p_to = 'pending_approval' then
    if not (public.rbt_has_perm('content.manage') and (a.author_id = auth.uid() or public.rbt_has_perm('content.publish'))) then
      raise exception 'You cannot submit this announcement.' using errcode = 'RB403';
    end if;
    if a.status <> 'draft' then raise exception 'Only drafts can be submitted.' using errcode = 'RB409'; end if;
  elsif p_to in ('published','archived','draft') then
    if not public.rbt_has_perm('content.publish') then
      raise exception 'Only the Director can publish or archive announcements.' using errcode = 'RB403';
    end if;
  else
    raise exception 'Unknown status.' using errcode = 'RB400';
  end if;
  update public.announcements
     set status = p_to,
         published_by = case when p_to = 'published' then auth.uid() else published_by end,
         published_at = case when p_to = 'published' then now() else published_at end
   where id = p_id returning * into a;
  perform public.rbt_audit('announcement.' || p_to, 'announcements', p_id::text, jsonb_build_object('title', a.title));
  return a;
end $$;

create or replace function public.update_task_status(p_id uuid, p_status text, p_notes text default null)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  perform public.rbt_require_official();
  if p_status not in ('open','in_progress','done','blocked') then raise exception 'Unknown status.' using errcode = 'RB400'; end if;
  select * into t from public.tasks where id = p_id for update;
  if not found then raise exception 'Task not found.' using errcode = 'RB404'; end if;
  if t.assigned_to <> auth.uid() and not public.rbt_has_perm('tasks.manage') then
    raise exception 'This task is not assigned to you.' using errcode = 'RB403';
  end if;
  update public.tasks
     set status = p_status, notes = left(coalesce(p_notes, notes), 1000),
         completed_at = case when p_status = 'done' then now() else null end
   where id = p_id returning * into t;
  return t;
end $$;

-- ---------------------------------------------------------------------------
-- Live scoring
-- ---------------------------------------------------------------------------
create or replace function public.record_match_event(
  p_match_id uuid, p_client_event_id uuid, p_event_type text,
  p_team text default null, p_value int default null,
  p_expected_version int default null, p_reason text default null)
returns public.matches language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  v_elapsed int := 0;
  v_home int; v_away int; v_hf int; v_af int; v_hto int; v_ato int;
  v_period int; v_clock int; v_shot int; v_running boolean; v_stamp timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
  perform public.rbt_require_official();
  if p_client_event_id is null then raise exception 'An event id is required.' using errcode = 'RB400'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
  if not public.rbt_can_score(p_match_id) then
    raise exception 'You are not assigned to score this game.' using errcode = 'RB403';
  end if;
  -- A retried request returns the current state and records nothing twice.
  if exists (select 1 from public.match_events where match_id = p_match_id and client_event_id = p_client_event_id) then
    return m;
  end if;
  if m.archived_at is not null then raise exception 'This game is archived.' using errcode = 'RB409'; end if;
  if m.status <> 'live' then raise exception 'The game is not live (it is %).', m.status using errcode = 'RB409'; end if;
  if p_expected_version is not null and p_expected_version <> m.version then
    raise exception 'version_conflict: another official changed this game. Refresh and try again.' using errcode = 'RB409';
  end if;
  if p_team is not null and p_team not in ('home','away') then raise exception 'Unknown team side.' using errcode = 'RB400'; end if;

  v_home := m.home_score; v_away := m.away_score; v_hf := m.home_fouls; v_af := m.away_fouls;
  v_hto := m.home_timeouts; v_ato := m.away_timeouts; v_period := m.period;
  v_clock := m.clock_seconds; v_shot := m.shot_clock_seconds; v_running := m.clock_running; v_stamp := m.clock_updated_at;
  if v_running then
    v_elapsed := greatest(0, floor(extract(epoch from (now() - m.clock_updated_at)))::int);
  end if;

  if p_event_type = 'score' then
    if p_team is null or p_value not in (1,2,3) then raise exception 'A score is 1, 2 or 3 points for a team.' using errcode = 'RB400'; end if;
    if p_team = 'home' then v_home := v_home + p_value; else v_away := v_away + p_value; end if;
  elsif p_event_type = 'undo_score' then
    if p_team is null or p_value not in (1,2,3) then raise exception 'Choose the team and the points to remove.' using errcode = 'RB400'; end if;
    if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason for the correction.' using errcode = 'RB400'; end if;
    if p_team = 'home' then v_home := v_home - p_value; else v_away := v_away - p_value; end if;
    if v_home < 0 or v_away < 0 then raise exception 'A score cannot go below zero.' using errcode = 'RB400'; end if;
  elsif p_event_type = 'foul' then
    if p_team is null then raise exception 'Choose a team.' using errcode = 'RB400'; end if;
    if p_team = 'home' then v_hf := v_hf + 1; else v_af := v_af + 1; end if;
  elsif p_event_type = 'timeout' then
    if p_team is null then raise exception 'Choose a team.' using errcode = 'RB400'; end if;
    if p_team = 'home' then
      if v_hto <= 0 then raise exception 'No timeouts left for the home team.' using errcode = 'RB409'; end if;
      v_hto := v_hto - 1;
    else
      if v_ato <= 0 then raise exception 'No timeouts left for the away team.' using errcode = 'RB409'; end if;
      v_ato := v_ato - 1;
    end if;
    if v_running then  -- a timeout stops the clock
      v_clock := greatest(0, v_clock - v_elapsed); v_shot := greatest(0, v_shot - v_elapsed); v_running := false; v_stamp := now();
    end if;
  elsif p_event_type = 'period' then
    if p_value is null or p_value not between 1 and 8 then raise exception 'Period must be 1 to 8.' using errcode = 'RB400'; end if;
    v_period := p_value;
  elsif p_event_type = 'clock_start' then
    if not v_running then v_running := true; v_stamp := now(); end if;
  elsif p_event_type = 'clock_stop' then
    if v_running then
      v_clock := greatest(0, v_clock - v_elapsed); v_shot := greatest(0, v_shot - v_elapsed); v_running := false; v_stamp := now();
    end if;
  elsif p_event_type = 'clock_set' then
    if p_value is null or p_value not between 0 and 3600 then raise exception 'Clock must be 0 to 3600 seconds.' using errcode = 'RB400'; end if;
    v_clock := p_value; v_stamp := now();
  elsif p_event_type = 'shot_clock' then
    if p_value is null or p_value not between 0 and 24 then raise exception 'Shot clock must be 0 to 24 seconds.' using errcode = 'RB400'; end if;
    if v_running then v_clock := greatest(0, v_clock - v_elapsed); end if;
    v_shot := p_value; v_stamp := now();
  else
    raise exception 'Unknown event type.' using errcode = 'RB400';
  end if;

  update public.matches
     set home_score = v_home, away_score = v_away, home_fouls = v_hf, away_fouls = v_af,
         home_timeouts = v_hto, away_timeouts = v_ato, period = v_period,
         clock_seconds = v_clock, shot_clock_seconds = v_shot, clock_running = v_running, clock_updated_at = v_stamp,
         version = version + 1
   where id = p_match_id returning * into m;

  insert into public.match_events(match_id, client_event_id, event_type, team, value, period, clock_seconds, reason,
                                  home_score_after, away_score_after, version_after, created_by)
  values (p_match_id, p_client_event_id, p_event_type, p_team, p_value, m.period, m.clock_seconds, v_reason,
          m.home_score, m.away_score, m.version, auth.uid());

  if p_event_type = 'undo_score' then
    perform public.rbt_audit('match.score_corrected', 'matches', p_match_id::text,
      jsonb_build_object('team', p_team, 'removed', p_value, 'reason', v_reason, 'home', m.home_score, 'away', m.away_score));
  end if;
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- Match lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.transition_match(
  p_match_id uuid, p_to text, p_reason text default null, p_expected_version int default null)
returns public.matches language plpgsql security definer set search_path = public as $$
declare
  m public.matches; v_ok boolean := false; v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
  v_elapsed int := 0; v_from text; v_clock int; v_shot int;
begin
  perform public.rbt_require_official();
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
  if m.archived_at is not null then raise exception 'This game is archived. Restore it first.' using errcode = 'RB409'; end if;
  if p_expected_version is not null and p_expected_version <> m.version then
    raise exception 'version_conflict: another official changed this game. Refresh and try again.' using errcode = 'RB409';
  end if;
  if m.status = p_to then return m; end if;  -- a retry of the same transition
  v_from := m.status;

  v_ok := case m.status
    when 'scheduled'    then p_to in ('ready','postponed','cancelled')
    when 'ready'        then p_to in ('scheduled','live','postponed','cancelled')
    when 'live'         then p_to in ('final','under_review','postponed','cancelled')
    when 'postponed'    then p_to in ('scheduled','ready','cancelled')
    when 'under_review' then p_to in ('live','final')
    when 'final'        then p_to in ('under_review')
    when 'cancelled'    then p_to in ('scheduled')
    else false end;
  if not v_ok then
    raise exception 'A % game cannot move to %.', m.status, p_to using errcode = 'RB409';
  end if;

  if m.status = 'cancelled' then
    if not public.rbt_has_perm('matches.restore') then raise exception 'Only the Director can restore a cancelled game.' using errcode = 'RB403'; end if;
  elsif p_to = 'cancelled' and m.status = 'live' then
    if not public.rbt_has_perm('matches.cancel_live') then raise exception 'Only the Director can cancel a live game.' using errcode = 'RB403'; end if;
  elsif p_to = 'cancelled' then
    if not public.rbt_has_perm('matches.manage') then raise exception 'You cannot cancel fixtures.' using errcode = 'RB403'; end if;
  elsif m.status = 'live' and p_to = 'final' then
    if not (public.rbt_has_perm('matches.finalize') and public.rbt_can_score(p_match_id)) then
      raise exception 'You cannot finalise this game.' using errcode = 'RB403';
    end if;
  elsif m.status = 'live' and p_to = 'under_review' then
    if not (public.rbt_can_score(p_match_id) or public.rbt_has_perm('matches.lifecycle')) then
      raise exception 'You cannot flag this game for review.' using errcode = 'RB403';
    end if;
  elsif m.status = 'live' and p_to = 'postponed' then
    if not public.rbt_has_perm('matches.lifecycle') then raise exception 'You cannot suspend a live game.' using errcode = 'RB403'; end if;
  elsif m.status = 'ready' and p_to = 'live' then
    if not (public.rbt_has_perm('matches.manage') or public.rbt_can_score(p_match_id)) then
      raise exception 'You cannot start this game.' using errcode = 'RB403';
    end if;
  elsif m.status = 'under_review' and p_to = 'live' then
    if not public.rbt_has_perm('matches.lifecycle') then raise exception 'You cannot resume this game.' using errcode = 'RB403'; end if;
  elsif m.status in ('under_review','final') then
    if not public.rbt_has_perm('matches.correct') then raise exception 'Only the Director can approve or reopen a final result.' using errcode = 'RB403'; end if;
  else
    if not public.rbt_has_perm('matches.manage') then raise exception 'You cannot change fixtures.' using errcode = 'RB403'; end if;
  end if;

  if (p_to in ('postponed','cancelled','under_review') or m.status in ('live','final','under_review'))
     and (v_reason is null or char_length(v_reason) < (case when p_to = 'cancelled' then 10 else 5 end)) then
    raise exception 'A reason is required (at least % characters).', (case when p_to = 'cancelled' then 10 else 5 end) using errcode = 'RB400';
  end if;
  if p_to = 'final' and m.home_score = m.away_score then
    raise exception 'The score is tied. Play overtime before finalising.' using errcode = 'RB409';
  end if;

  v_clock := m.clock_seconds; v_shot := m.shot_clock_seconds;
  if m.clock_running then
    v_elapsed := greatest(0, floor(extract(epoch from (now() - m.clock_updated_at)))::int);
    v_clock := greatest(0, v_clock - v_elapsed); v_shot := greatest(0, v_shot - v_elapsed);
  end if;

  update public.matches
     set status = p_to,
         status_reason = case when p_to in ('postponed','cancelled','under_review') then v_reason else null end,
         clock_seconds = v_clock, shot_clock_seconds = v_shot, clock_running = false, clock_updated_at = now(),
         started_at = case when p_to = 'live' and started_at is null then now() else started_at end,
         final_at = case when p_to = 'final' then now() else null end,
         version = version + 1
   where id = p_match_id returning * into m;

  insert into public.match_events(match_id, client_event_id, event_type, reason, period, clock_seconds,
                                  home_score_after, away_score_after, version_after, details, created_by)
  values (p_match_id, gen_random_uuid(), 'status', v_reason, m.period, m.clock_seconds, m.home_score, m.away_score, m.version,
          jsonb_build_object('from', v_from, 'to', p_to), auth.uid());
  perform public.rbt_audit('match.status', 'matches', p_match_id::text,
                           jsonb_build_object('from', v_from, 'to', p_to, 'reason', v_reason, 'home', m.home_score, 'away', m.away_score));
  return m;
end $$;

create or replace function public.correct_match_score(p_match_id uuid, p_home int, p_away int, p_reason text)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches; v_reason text := nullif(btrim(coalesce(p_reason,'')), ''); v_old_h int; v_old_a int;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('matches.correct') then
    raise exception 'Only the Director can correct a result.' using errcode = 'RB403';
  end if;
  if p_home is null or p_away is null or p_home < 0 or p_away < 0 then raise exception 'Enter valid scores.' using errcode = 'RB400'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason for the correction.' using errcode = 'RB400'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
  if m.status <> 'under_review' then
    raise exception 'Move the game to under review before correcting its score.' using errcode = 'RB409';
  end if;
  v_old_h := m.home_score; v_old_a := m.away_score;
  update public.matches set home_score = p_home, away_score = p_away, version = version + 1
   where id = p_match_id returning * into m;
  insert into public.match_events(match_id, client_event_id, event_type, reason, period, clock_seconds,
                                  home_score_after, away_score_after, version_after, details, created_by)
  values (p_match_id, gen_random_uuid(), 'correction', v_reason, m.period, m.clock_seconds, m.home_score, m.away_score, m.version,
          jsonb_build_object('home_before', v_old_h, 'away_before', v_old_a), auth.uid());
  perform public.rbt_audit('match.result_corrected', 'matches', p_match_id::text,
    jsonb_build_object('home_before', v_old_h, 'away_before', v_old_a, 'home_after', p_home, 'away_after', p_away, 'reason', v_reason));
  return m;
end $$;

create or replace function public.archive_match(p_match_id uuid, p_reason text)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches; v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('matches.archive') then raise exception 'Only the Director can archive games.' using errcode = 'RB403'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason for archiving.' using errcode = 'RB400'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
  if m.archived_at is not null then return m; end if;
  if m.status = 'live' then raise exception 'A live game cannot be archived. Finish, suspend or cancel it first.' using errcode = 'RB409'; end if;
  update public.matches set archived_at = now(), archived_by = auth.uid(), archive_reason = v_reason, version = version + 1
   where id = p_match_id returning * into m;
  insert into public.match_events(match_id, client_event_id, event_type, reason, period, clock_seconds,
                                  home_score_after, away_score_after, version_after, details, created_by)
  values (p_match_id, gen_random_uuid(), 'status', v_reason, m.period, m.clock_seconds, m.home_score, m.away_score, m.version,
          jsonb_build_object('action', 'archive', 'status', m.status), auth.uid());
  perform public.rbt_audit('match.archived', 'matches', p_match_id::text, jsonb_build_object('status', m.status, 'reason', v_reason));
  return m;
end $$;

create or replace function public.restore_match(p_match_id uuid)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('matches.restore') then raise exception 'Only the Director can restore games.' using errcode = 'RB403'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
  if m.archived_at is null then return m; end if;
  update public.matches set archived_at = null, archived_by = null, archive_reason = null, version = version + 1
   where id = p_match_id returning * into m;
  insert into public.match_events(match_id, client_event_id, event_type, period, clock_seconds,
                                  home_score_after, away_score_after, version_after, details, created_by)
  values (p_match_id, gen_random_uuid(), 'status', m.period, m.clock_seconds, m.home_score, m.away_score, m.version,
          jsonb_build_object('action', 'restore', 'status', m.status), auth.uid());
  perform public.rbt_audit('match.restored', 'matches', p_match_id::text, jsonb_build_object('status', m.status));
  return m;
end $$;

-- The only way to remove a fixture: an untouched, scheduled game with no history.
create or replace function public.delete_draft_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('matches.manage') then raise exception 'You cannot delete fixtures.' using errcode = 'RB403'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
  if m.status <> 'scheduled' or exists (select 1 from public.match_events where match_id = p_match_id) then
    raise exception 'Only a scheduled game with no history can be deleted. Cancel or archive this one instead.' using errcode = 'RB409';
  end if;
  perform public.rbt_audit('match.deleted', 'matches', p_match_id::text,
                           jsonb_build_object('home_team_id', m.home_team_id, 'away_team_id', m.away_team_id, 'scheduled_at', m.scheduled_at));
  delete from public.official_assignments where match_id = p_match_id;
  delete from public.matches where id = p_match_id;
end $$;

-- Standings are computed from published, final, non-archived games (win = 2 points, loss = 1).
create or replace function public.get_standings()
returns table(team_id uuid, team_name text, pool text, played int, wins int, losses int, points_for int, points_against int, points int)
language sql stable security definer set search_path = public as $$
  with g as (
    select home_team_id as t, home_score as pf, away_score as pa from public.matches
      where status = 'final' and is_published and archived_at is null
    union all
    select away_team_id, away_score, home_score from public.matches
      where status = 'final' and is_published and archived_at is null)
  select t.id, t.name, t.pool,
         count(g.t)::int,
         (count(*) filter (where g.pf > g.pa))::int,
         (count(*) filter (where g.pf < g.pa))::int,
         coalesce(sum(g.pf), 0)::int,
         coalesce(sum(g.pa), 0)::int,
         (2 * count(*) filter (where g.pf > g.pa) + count(*) filter (where g.pf < g.pa))::int
  from public.teams t left join g on g.t = t.id
  where t.is_published and t.registration_status = 'approved'
  group by t.id, t.name, t.pool
  order by 9 desc, (coalesce(sum(g.pf),0) - coalesce(sum(g.pa),0)) desc, t.name;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'rbt\_%' or p.proname in (
             'submit_account_request','submit_team_registration','review_account_request','approve_account_request',
             'admin_set_official','set_role_permissions','list_assignable_officials','review_team','set_announcement_status',
             'update_task_status','record_match_event','transition_match','correct_match_score','archive_match',
             'restore_match','delete_draft_match','get_standings'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Internal helpers are not callable from the API at all.
revoke execute on function public.rbt_audit(text,text,text,jsonb) from authenticated;
revoke execute on function public.rbt_touch_updated_at() from authenticated;
revoke execute on function public.rbt_block_mutation() from authenticated;
revoke execute on function public.rbt_matches_delete_guard() from authenticated;
revoke execute on function public.rbt_matches_schedule_guard() from authenticated;
revoke execute on function public.rbt_profiles_guard() from authenticated;

-- Public visitors may use only the intake forms and the standings table.
grant execute on function public.submit_account_request(text,text,text,text,text) to anon;
grant execute on function public.submit_team_registration(text,text,text,text,text) to anon;
grant execute on function public.get_standings() to anon;
-- RLS policies call these helpers as the signed-in or anonymous caller.
grant execute on function public.rbt_has_perm(text) to anon;
grant execute on function public.rbt_is_official() to anon;
grant execute on function public.rbt_is_assigned(uuid, text) to anon;
