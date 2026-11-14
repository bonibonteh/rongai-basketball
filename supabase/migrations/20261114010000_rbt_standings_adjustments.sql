-- Rongai Basketball League: standings points adjustments (positive and negative).
-- FINAL POINTS = MATCH POINTS + POINTS ADJUSTMENTS. Match points stay separate from administrative adjustments.
-- Adjustments are append-only: a mistake is corrected by reversing the entry, never by editing or deleting it.

create table if not exists public.standings_adjustments (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  points          int  not null check (points <> 0),   -- negative values are allowed on purpose
  reason          text not null check (char_length(btrim(reason)) between 5 and 500),
  adjusted_on     date not null default ((now() at time zone 'Africa/Nairobi')::date),
  created_by      uuid not null default auth.uid() references public.profiles(id),
  created_at      timestamptz not null default now(),
  corrects_id     uuid references public.standings_adjustments(id),
  reversed_at     timestamptz,
  reversed_by     uuid references public.profiles(id),
  reversal_reason text
);
create index if not exists standings_adjustments_team_idx on public.standings_adjustments(team_id) where reversed_at is null;
alter table public.standings_adjustments enable row level security;
revoke all on public.standings_adjustments from anon, authenticated;
grant select on public.standings_adjustments to authenticated;
create policy adjustments_read on public.standings_adjustments for select to authenticated
  using (public.rbt_has_perm('standings.manage') or public.rbt_has_perm('matches.view_all'));

-- the Director can delegate adjusting points; nobody else has it by default
create or replace function public.set_role_permissions(p_role text, p_permissions text[])
returns public.official_roles language plpgsql security definer set search_path = public as $$
declare r public.official_roles; v_allowed text[] := array[
  'matches.view_all','matches.manage','matches.lifecycle','matches.score','matches.finalize','matches.correct',
  'matches.cancel_live','matches.archive','matches.restore','reports.submit','reports.review','teams.review',
  'stats.verify','content.manage','content.publish','tasks.manage','audit.read','access.manage','config.manage',
  'standings.manage','results.record','merch.manage','roster.manage','standings.adjust'];
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

-- standings now carry match_points, adjustment and the final points
drop function if exists public.get_standings();
drop function if exists public.get_standings_admin();
drop function if exists public.rbt_calc_standings(boolean);

create function public.rbt_calc_standings(p_public boolean)
returns table(team_id uuid, team_name text, logo_path text, pool text, is_active boolean,
              played int, wins int, losses int, draws int, points_for int, points_against int,
              diff int, match_points int, adjustment int, points int, is_override boolean, rank int)
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
  adj as (select team_id, sum(points)::int as a from public.standings_adjustments where reversed_at is null group by team_id),
  fin as (
    select a.id, a.name, a.logo_path, a.pool, a.is_active, (o.team_id is not null) as ov,
           coalesce(o.wins, a.w) as w, coalesce(o.losses, a.l) as l, coalesce(o.draws, a.d) as d,
           coalesce(o.points_for, a.pf) as pf, coalesce(o.points_against, a.pa) as pa,
           coalesce(o.table_points, 2 * coalesce(o.wins, a.w) + coalesce(o.draws, a.d) + coalesce(o.losses, a.l)) as mp,
           coalesce(j.a, 0) as adj
    from agg a left join public.standings_overrides o on o.team_id = a.id left join adj j on j.team_id = a.id)
  select id, name, logo_path, pool, is_active, (w + l + d), w, l, d, pf, pa, (pf - pa), mp, adj, (mp + adj), ov,
         (row_number() over (order by (mp + adj) desc, (pf - pa) desc, pf desc, name))::int
  from fin order by 17;
$$;

create function public.get_standings()
returns table(team_id uuid, team_name text, logo_path text, pool text, is_active boolean,
              played int, wins int, losses int, draws int, points_for int, points_against int,
              diff int, match_points int, adjustment int, points int, is_override boolean, rank int)
language sql stable security definer set search_path = public as $$
  select * from public.rbt_calc_standings(true);
$$;

create function public.get_standings_admin()
returns table(team_id uuid, team_name text, logo_path text, pool text, is_active boolean,
              played int, wins int, losses int, draws int, points_for int, points_against int,
              diff int, match_points int, adjustment int, points int, is_override boolean, rank int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.rbt_has_perm('standings.manage') or public.rbt_has_perm('matches.view_all') or public.rbt_has_perm('teams.review')) then
    raise exception 'You cannot view the full standings.' using errcode = 'RB403';
  end if;
  return query select * from public.rbt_calc_standings(false);
end $$;

revoke all on function public.rbt_calc_standings(boolean), public.get_standings(), public.get_standings_admin() from public, anon, authenticated;
grant execute on function public.get_standings() to anon, authenticated;
grant execute on function public.get_standings_admin() to authenticated;

-- add a +/- adjustment
create or replace function public.add_standings_adjustment(p_team uuid, p_points int, p_reason text, p_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_reason text := nullif(btrim(coalesce(p_reason,'')), ''); v_id uuid;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('standings.adjust') then raise exception 'Only the Tournament Administrator can adjust points.' using errcode = 'RB403'; end if;
  if p_points is null or p_points = 0 then raise exception 'Enter a whole number of points, for example 2 or -2.' using errcode = 'RB400'; end if;
  if abs(p_points) > 100 then raise exception 'An adjustment cannot be more than 100 points either way.' using errcode = 'RB400'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason for the adjustment (at least 5 characters).' using errcode = 'RB400'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'Team not found.' using errcode = 'RB404'; end if;
  insert into public.standings_adjustments(team_id, points, reason, adjusted_on, created_by)
  values (p_team, p_points, v_reason, coalesce(p_date, (now() at time zone 'Africa/Nairobi')::date), auth.uid()) returning id into v_id;
  perform public.rbt_audit('standings.adjustment_added', 'standings_adjustments', v_id::text,
    jsonb_build_object('team_id', p_team, 'points', p_points, 'reason', v_reason));
  return v_id;
end $$;

-- reverse an adjustment (kept in the history, no longer counted)
create or replace function public.reverse_standings_adjustment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_reason text := nullif(btrim(coalesce(p_reason,'')), ''); a public.standings_adjustments;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('standings.adjust') then raise exception 'Only the Tournament Administrator can adjust points.' using errcode = 'RB403'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason for reversing this adjustment.' using errcode = 'RB400'; end if;
  select * into a from public.standings_adjustments where id = p_id for update;
  if not found then raise exception 'Adjustment not found.' using errcode = 'RB404'; end if;
  if a.reversed_at is not null then raise exception 'This adjustment was already reversed.' using errcode = 'RB409'; end if;
  update public.standings_adjustments set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_reason where id = p_id;
  perform public.rbt_audit('standings.adjustment_reversed', 'standings_adjustments', p_id::text,
    jsonb_build_object('team_id', a.team_id, 'points', a.points, 'reason', v_reason));
end $$;

-- correct = reverse the old entry and record the new one in one step
create or replace function public.correct_standings_adjustment(p_id uuid, p_points int, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.standings_adjustments; v_new uuid;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('standings.adjust') then raise exception 'Only the Tournament Administrator can adjust points.' using errcode = 'RB403'; end if;
  select * into a from public.standings_adjustments where id = p_id;
  if not found then raise exception 'Adjustment not found.' using errcode = 'RB404'; end if;
  perform public.reverse_standings_adjustment(p_id, 'Corrected: ' || coalesce(p_reason, ''));
  v_new := public.add_standings_adjustment(a.team_id, p_points, p_reason, a.adjusted_on);
  update public.standings_adjustments set corrects_id = p_id where id = v_new;
  return v_new;
end $$;

-- the history, with the administrator's name
create or replace function public.list_standings_adjustments(p_team uuid default null)
returns table(id uuid, team_id uuid, team_name text, points int, reason text, adjusted_on date, created_at timestamptz,
              created_by_name text, reversed_at timestamptz, reversed_by_name text, reversal_reason text, corrects_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.rbt_has_perm('standings.manage') or public.rbt_has_perm('matches.view_all')) then
    raise exception 'You cannot view point adjustments.' using errcode = 'RB403';
  end if;
  return query
    select a.id, a.team_id, t.name, a.points, a.reason, a.adjusted_on, a.created_at,
           coalesce(c.display_name, c.full_name), a.reversed_at, coalesce(r.display_name, r.full_name), a.reversal_reason, a.corrects_id
    from public.standings_adjustments a
    join public.teams t on t.id = a.team_id
    left join public.profiles c on c.id = a.created_by
    left join public.profiles r on r.id = a.reversed_by
    where p_team is null or a.team_id = p_team
    order by a.created_at desc limit 500;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('add_standings_adjustment','reverse_standings_adjustment','correct_standings_adjustment','list_standings_adjustments')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
