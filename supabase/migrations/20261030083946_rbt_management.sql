-- Rongai Basketball League: management features (standings, results, teams, merch, roster).
-- This is the exact SQL that was applied to the live project as migration "rbt_management"
-- (version 20261030083946). It is saved here so the repository and the database stay in step.
-- Safe to run once on a project that already has the first four migrations.

update public.official_roles set permissions = (select array_agg(distinct x order by x) from unnest(permissions || array['standings.manage','results.record','matches.view_all']) x) where key = 'stats_officer';
update public.official_roles set permissions = (select array_agg(distinct x order by x) from unnest(permissions || array['merch.manage']) x) where key = 'media_officer';
update public.official_roles set permissions = (select array_agg(distinct x order by x) from unnest(permissions || array['roster.manage']) x) where key = 'registration_officer';

create or replace function public.set_role_permissions(p_role text, p_permissions text[])
returns public.official_roles language plpgsql security definer set search_path = public as $$
declare r public.official_roles; v_allowed text[] := array[
  'matches.view_all','matches.manage','matches.lifecycle','matches.score','matches.finalize','matches.correct',
  'matches.cancel_live','matches.archive','matches.restore','reports.submit','reports.review','teams.review',
  'stats.verify','content.manage','content.publish','tasks.manage','audit.read','access.manage','config.manage',
  'standings.manage','results.record','merch.manage','roster.manage'];
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
revoke all on function public.set_role_permissions(text, text[]) from public, anon;
grant execute on function public.set_role_permissions(text, text[]) to authenticated;

alter table public.teams
  add column if not exists logo_path    text check (logo_path is null or char_length(logo_path) <= 200),
  add column if not exists description  text check (description is null or char_length(description) <= 1000),
  add column if not exists coach_name   text check (coach_name is null or char_length(coach_name) <= 120),
  add column if not exists manager_name text check (manager_name is null or char_length(manager_name) <= 120),
  add column if not exists is_active    boolean not null default true;

grant select (logo_path, description, coach_name, manager_name, is_active) on public.teams to anon;
grant insert (logo_path, description, coach_name, manager_name, is_active) on public.teams to authenticated;
grant update (logo_path, description, coach_name, manager_name, is_active, registration_status) on public.teams to authenticated;

drop policy if exists teams_public_read on public.teams;
create policy teams_public_read on public.teams for select to anon, authenticated
  using (is_published and is_active and registration_status = 'approved');

alter table public.players
  add column if not exists photo_path  text check (photo_path is null or char_length(photo_path) <= 200),
  add column if not exists height_cm   int check (height_cm is null or height_cm between 120 and 250),
  add column if not exists nationality text check (nationality is null or char_length(nationality) <= 60),
  add column if not exists bio         text check (bio is null or char_length(bio) <= 1000),
  add column if not exists status      text not null default 'active' check (status in ('active','injured','unavailable','suspended','archived')),
  add column if not exists archived_at timestamptz;

alter table public.players drop constraint if exists players_team_id_jersey_no_key;
create unique index if not exists players_team_jersey_uidx on public.players (team_id, jersey_no) where archived_at is null;

grant select (photo_path, height_cm, nationality, bio, status) on public.players to anon;
drop policy if exists players_public_read on public.players;
create policy players_public_read on public.players for select to anon, authenticated
  using (is_published and archived_at is null and status <> 'archived'
         and exists (select 1 from public.teams t where t.id = team_id));
drop policy if exists players_staff_all on public.players;
create policy players_staff_all on public.players for all to authenticated
  using (public.rbt_has_perm('teams.review') or public.rbt_has_perm('roster.manage'))
  with check (public.rbt_has_perm('teams.review') or public.rbt_has_perm('roster.manage'));
drop policy if exists players_staff_read on public.players;

create table if not exists public.standings_overrides (
  team_id       uuid primary key references public.teams(id) on delete cascade,
  wins          int check (wins >= 0),
  losses        int check (losses >= 0),
  draws         int check (draws >= 0),
  points_for    int check (points_for >= 0),
  points_against int check (points_against >= 0),
  table_points  int check (table_points >= 0),
  reason        text not null check (char_length(btrim(reason)) between 5 and 500),
  set_by        uuid not null default auth.uid(),
  set_at        timestamptz not null default now()
);
alter table public.standings_overrides enable row level security;
revoke all on public.standings_overrides from anon, authenticated;
grant select on public.standings_overrides to authenticated;
drop policy if exists overrides_read on public.standings_overrides;
create policy overrides_read on public.standings_overrides for select to authenticated
  using (public.rbt_has_perm('standings.manage') or public.rbt_has_perm('matches.view_all'));

drop function if exists public.get_standings();

create or replace function public.rbt_calc_standings(p_public boolean)
returns table(team_id uuid, team_name text, logo_path text, pool text, is_active boolean,
              played int, wins int, losses int, draws int, points_for int, points_against int,
              diff int, points int, is_override boolean, rank int)
language sql stable security definer set search_path = public as $$
  with g as (
    select home_team_id as t, home_score as pf, away_score as pa from public.matches
      where status = 'final' and is_published and archived_at is null
    union all
    select away_team_id, away_score, home_score from public.matches
      where status = 'final' and is_published and archived_at is null),
  agg as (
    select t.id, t.name, t.logo_path, t.pool, t.is_active,
           (count(*) filter (where g.t is not null and g.pf > g.pa))::int as w,
           (count(*) filter (where g.t is not null and g.pf < g.pa))::int as l,
           (count(*) filter (where g.t is not null and g.pf = g.pa))::int as d,
           coalesce(sum(g.pf), 0)::int as pf, coalesce(sum(g.pa), 0)::int as pa
    from public.teams t left join g on g.t = t.id
    where t.registration_status = 'approved'
      and (not p_public or (t.is_published and t.is_active))
    group by t.id),
  fin as (
    select a.id, a.name, a.logo_path, a.pool, a.is_active, (o.team_id is not null) as ov,
           coalesce(o.wins, a.w) as w, coalesce(o.losses, a.l) as l, coalesce(o.draws, a.d) as d,
           coalesce(o.points_for, a.pf) as pf, coalesce(o.points_against, a.pa) as pa,
           coalesce(o.table_points, 2 * coalesce(o.wins, a.w) + coalesce(o.draws, a.d) + coalesce(o.losses, a.l)) as pts
    from agg a left join public.standings_overrides o on o.team_id = a.id)
  select id, name, logo_path, pool, is_active, (w + l + d), w, l, d, pf, pa, (pf - pa), pts, ov,
         (row_number() over (order by pts desc, (pf - pa) desc, pf desc, name))::int
  from fin order by 15;
$$;

create or replace function public.get_standings()
returns table(team_id uuid, team_name text, logo_path text, pool text, is_active boolean,
              played int, wins int, losses int, draws int, points_for int, points_against int,
              diff int, points int, is_override boolean, rank int)
language sql stable security definer set search_path = public as $$
  select * from public.rbt_calc_standings(true);
$$;

create or replace function public.get_standings_admin()
returns table(team_id uuid, team_name text, logo_path text, pool text, is_active boolean,
              played int, wins int, losses int, draws int, points_for int, points_against int,
              diff int, points int, is_override boolean, rank int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.rbt_has_perm('standings.manage') or public.rbt_has_perm('matches.view_all') or public.rbt_has_perm('teams.review')) then
    raise exception 'You cannot view the full standings.' using errcode = 'RB403';
  end if;
  return query select * from public.rbt_calc_standings(false);
end $$;

create or replace function public.set_standings_override(
  p_team uuid, p_wins int, p_losses int, p_draws int, p_for int, p_against int, p_points int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_reason text := nullif(btrim(coalesce(p_reason,'')), ''); v_before jsonb;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('standings.manage') then raise exception 'You cannot edit standings.' using errcode = 'RB403'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason for the override.' using errcode = 'RB400'; end if;
  if p_wins is null and p_losses is null and p_draws is null and p_for is null and p_against is null and p_points is null then
    raise exception 'Enter at least one value to override.' using errcode = 'RB400';
  end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'Team not found.' using errcode = 'RB404'; end if;
  select to_jsonb(o) into v_before from public.standings_overrides o where team_id = p_team;
  begin
    insert into public.standings_overrides(team_id, wins, losses, draws, points_for, points_against, table_points, reason, set_by, set_at)
    values (p_team, p_wins, p_losses, p_draws, p_for, p_against, p_points, v_reason, auth.uid(), now())
    on conflict (team_id) do update set wins = excluded.wins, losses = excluded.losses, draws = excluded.draws,
      points_for = excluded.points_for, points_against = excluded.points_against, table_points = excluded.table_points,
      reason = excluded.reason, set_by = excluded.set_by, set_at = excluded.set_at;
  exception when check_violation then
    raise exception 'Values cannot be negative.' using errcode = 'RB400';
  end;
  perform public.rbt_audit('standings.override_set', 'standings_overrides', p_team::text,
    jsonb_build_object('before', v_before, 'wins', p_wins, 'losses', p_losses, 'draws', p_draws, 'points_for', p_for,
                       'points_against', p_against, 'table_points', p_points, 'reason', v_reason));
end $$;

create or replace function public.clear_standings_override(p_team uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_reason text := nullif(btrim(coalesce(p_reason,'')), ''); v_before jsonb;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('standings.manage') then raise exception 'You cannot edit standings.' using errcode = 'RB403'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason.' using errcode = 'RB400'; end if;
  select to_jsonb(o) into v_before from public.standings_overrides o where team_id = p_team;
  delete from public.standings_overrides where team_id = p_team;
  perform public.rbt_audit('standings.override_cleared', 'standings_overrides', p_team::text,
                           jsonb_build_object('before', v_before, 'reason', v_reason));
end $$;

create or replace function public.record_past_result(p_match_id uuid, p_home int, p_away int, p_reason text)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches; v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
  perform public.rbt_require_official();
  if not (public.rbt_has_perm('results.record') or public.rbt_has_perm('matches.correct')) then
    raise exception 'You cannot record results.' using errcode = 'RB403';
  end if;
  if p_home is null or p_away is null or p_home < 0 or p_away < 0 then raise exception 'Enter valid scores.' using errcode = 'RB400'; end if;
  if p_home = p_away then raise exception 'A game cannot end level. Check the scores.' using errcode = 'RB400'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Say where the result comes from (for example, the signed score sheet).' using errcode = 'RB400'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
  if m.archived_at is not null then raise exception 'This game is archived. Restore it first.' using errcode = 'RB409'; end if;
  if m.status not in ('scheduled','ready','postponed') then
    raise exception 'Only a game that has not been scored can take a past result. This one is %.', m.status using errcode = 'RB409';
  end if;
  update public.matches
     set status = 'final', home_score = p_home, away_score = p_away, status_reason = null,
         clock_running = false, final_at = now(), version = version + 1
   where id = p_match_id returning * into m;
  insert into public.match_events(match_id, client_event_id, event_type, reason, period, clock_seconds,
                                  home_score_after, away_score_after, version_after, details, created_by)
  values (p_match_id, gen_random_uuid(), 'status', v_reason, m.period, m.clock_seconds, m.home_score, m.away_score, m.version,
          jsonb_build_object('action', 'past_result', 'to', 'final'), auth.uid());
  perform public.rbt_audit('match.result_recorded', 'matches', p_match_id::text,
                           jsonb_build_object('home', p_home, 'away', p_away, 'source', v_reason));
  return m;
end $$;

create or replace function public.correct_final_result(p_match_id uuid, p_home int, p_away int, p_reason text)
returns public.matches language plpgsql security definer set search_path = public as $$
declare m public.matches; v_reason text := nullif(btrim(coalesce(p_reason,'')), ''); v_oh int; v_oa int;
begin
  perform public.rbt_require_official();
  if not (public.rbt_has_perm('results.record') or public.rbt_has_perm('matches.correct')) then
    raise exception 'You cannot correct results.' using errcode = 'RB403';
  end if;
  if p_home is null or p_away is null or p_home < 0 or p_away < 0 then raise exception 'Enter valid scores.' using errcode = 'RB400'; end if;
  if p_home = p_away then raise exception 'A game cannot end level. Check the scores.' using errcode = 'RB400'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason for the correction.' using errcode = 'RB400'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
  if m.archived_at is not null then raise exception 'This game is archived. Restore it first.' using errcode = 'RB409'; end if;
  if m.status not in ('final','under_review') then
    raise exception 'Only a finished game can be corrected. This one is %.', m.status using errcode = 'RB409';
  end if;
  v_oh := m.home_score; v_oa := m.away_score;
  update public.matches set home_score = p_home, away_score = p_away, version = version + 1
   where id = p_match_id returning * into m;
  insert into public.match_events(match_id, client_event_id, event_type, reason, period, clock_seconds,
                                  home_score_after, away_score_after, version_after, details, created_by)
  values (p_match_id, gen_random_uuid(), 'correction', v_reason, m.period, m.clock_seconds, m.home_score, m.away_score, m.version,
          jsonb_build_object('home_before', v_oh, 'away_before', v_oa), auth.uid());
  perform public.rbt_audit('match.result_corrected', 'matches', p_match_id::text,
    jsonb_build_object('home_before', v_oh, 'away_before', v_oa, 'home_after', p_home, 'away_after', p_away, 'reason', v_reason));
  return m;
end $$;

create table if not exists public.merch_products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  description   text not null default '' check (char_length(description) <= 2000),
  category      text not null default 'General' check (char_length(category) <= 60),
  price_kes     numeric(10,2) not null default 0 check (price_kes >= 0),
  sizes         text[] not null default '{}',
  colours       text[] not null default '{}',
  stock         int not null default 0 check (stock >= 0),
  availability  text not null default 'available' check (availability in ('available','sold_out','coming_soon')),
  image_paths   text[] not null default '{}',
  is_featured   boolean not null default false,
  display_order int not null default 0,
  status        text not null default 'draft' check (status in ('draft','published','archived')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists merch_products_public_idx on public.merch_products (status, display_order);
drop trigger if exists merch_products_touch on public.merch_products;
create trigger merch_products_touch before update on public.merch_products for each row execute function public.rbt_touch_updated_at();
alter table public.merch_products enable row level security;
revoke all on public.merch_products from anon, authenticated;
grant select on public.merch_products to anon, authenticated;
grant insert, update, delete on public.merch_products to authenticated;
create policy merch_public_read on public.merch_products for select to anon, authenticated using (status = 'published');
create policy merch_staff_read on public.merch_products for select to authenticated using (public.rbt_has_perm('merch.manage'));
create policy merch_staff_write on public.merch_products for insert to authenticated with check (public.rbt_has_perm('merch.manage'));
create policy merch_staff_update on public.merch_products for update to authenticated
  using (public.rbt_has_perm('merch.manage')) with check (public.rbt_has_perm('merch.manage'));
create policy merch_staff_delete on public.merch_products for delete to authenticated using (public.rbt_has_perm('merch.manage'));

create or replace function public.rbt_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.rbt_audit(lower(tg_table_name) || '.' || lower(tg_op), tg_table_name,
    coalesce(case when tg_op = 'DELETE' then old.id::text else new.id::text end, ''),
    jsonb_build_object('name', coalesce(case when tg_op = 'DELETE' then to_jsonb(old)->>'name' else to_jsonb(new)->>'name' end,
                                        case when tg_op = 'DELETE' then to_jsonb(old)->>'full_name' else to_jsonb(new)->>'full_name' end)));
  return coalesce(new, old);
end $$;
revoke execute on function public.rbt_audit_row() from public, anon, authenticated;
drop trigger if exists merch_products_audit on public.merch_products;
create trigger merch_products_audit after insert or update or delete on public.merch_products for each row execute function public.rbt_audit_row();
drop trigger if exists teams_audit on public.teams;
create trigger teams_audit after update on public.teams for each row execute function public.rbt_audit_row();
drop trigger if exists players_audit on public.players;
create trigger players_audit after insert or update or delete on public.players for each row execute function public.rbt_audit_row();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('team-logos',   'team-logos',   true, 2097152, array['image/jpeg','image/png','image/webp']),
  ('merch-images', 'merch-images', true, 3145728, array['image/jpeg','image/png','image/webp']),
  ('player-photos','player-photos',true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$
declare b record;
begin
  for b in select * from (values
      ('team-logos',    'public.rbt_has_perm(''teams.review'')'),
      ('merch-images',  'public.rbt_has_perm(''merch.manage'')'),
      ('player-photos', '(public.rbt_has_perm(''teams.review'') or public.rbt_has_perm(''roster.manage''))')
    ) as v(bucket, perm)
  loop
    execute format('drop policy if exists %I on storage.objects', b.bucket || '_insert');
    execute format('drop policy if exists %I on storage.objects', b.bucket || '_update');
    execute format('drop policy if exists %I on storage.objects', b.bucket || '_delete');
    execute format('create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and %s)', b.bucket || '_insert', b.bucket, b.perm);
    execute format('create policy %I on storage.objects for update to authenticated using (bucket_id = %L and %s) with check (bucket_id = %L and %s)', b.bucket || '_update', b.bucket, b.perm, b.bucket, b.perm);
    execute format('create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and %s)', b.bucket || '_delete', b.bucket, b.perm);
  end loop;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('rbt_calc_standings','get_standings','get_standings_admin',
             'set_standings_override','clear_standings_override','record_past_result','correct_final_result')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function public.rbt_calc_standings(boolean) from authenticated;
grant execute on function public.get_standings() to anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.merch_products; exception when duplicate_object then null; end;
  end if;
end $$;
