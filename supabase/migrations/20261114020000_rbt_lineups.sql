-- Rongai Basketball League: Starting Five lineups.
--   * a team's DEFAULT lineup (match_id is null)
--   * a MATCH-SPECIFIC lineup per team per fixture, which may differ from the default
--   * five starters + substitutes + captain, with a playing position for each starter
--   * published lineups are public; drafts are visible to the administrator only
--   * at tip-off the lineup that applies is locked and preserved; later corrections need a reason and leave a revision
-- Players and teams are never duplicated: lineups point at the existing rows.

create table if not exists public.lineups (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams(id) on delete cascade,
  match_id          uuid references public.matches(id) on delete cascade,
  status            text not null default 'draft' check (status in ('draft','published')),
  captain_player_id uuid references public.players(id) on delete set null,
  locked_at         timestamptz,
  source            text not null default 'manual' check (source in ('manual','default_snapshot')),
  version           int  not null default 1,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_by        uuid,
  updated_at        timestamptz not null default now()
);
create unique index if not exists lineups_default_uq on public.lineups(team_id) where match_id is null;
create unique index if not exists lineups_match_uq   on public.lineups(team_id, match_id) where match_id is not null;

create table if not exists public.lineup_players (
  id          uuid primary key default gen_random_uuid(),
  lineup_id   uuid not null references public.lineups(id) on delete cascade,
  player_id   uuid references public.players(id) on delete set null,
  role        text not null check (role in ('starter','substitute')),
  slot        int  not null check (slot between 1 and 30),
  position    text check (position is null or position in ('PG','SG','SF','PF','C')),
  player_name text not null,           -- snapshot, so history survives roster changes
  jersey_no   int,
  photo_path  text,
  unique (lineup_id, role, slot),
  unique (lineup_id, player_id)
);
create index if not exists lineup_players_lineup_idx on public.lineup_players(lineup_id);

create table if not exists public.lineup_revisions (
  id         uuid primary key default gen_random_uuid(),
  lineup_id  uuid not null references public.lineups(id) on delete cascade,
  snapshot   jsonb not null,
  reason     text,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

alter table public.lineups enable row level security;
alter table public.lineup_players enable row level security;
alter table public.lineup_revisions enable row level security;
revoke all on public.lineups, public.lineup_players, public.lineup_revisions from anon, authenticated;
grant select (id, team_id, match_id, status, captain_player_id, locked_at, source, version, updated_at) on public.lineups to anon;
grant select on public.lineups to authenticated;
grant select (id, lineup_id, player_id, role, slot, position, player_name, jersey_no, photo_path) on public.lineup_players to anon;
grant select on public.lineup_players to authenticated;
grant select on public.lineup_revisions to authenticated;

-- the Director can delegate lineup management through the role editor
create or replace function public.set_role_permissions(p_role text, p_permissions text[])
returns public.official_roles language plpgsql security definer set search_path = public as $$
declare r public.official_roles; v_allowed text[] := array[
  'matches.view_all','matches.manage','matches.lifecycle','matches.score','matches.finalize','matches.correct',
  'matches.cancel_live','matches.archive','matches.restore','reports.submit','reports.review','teams.review',
  'stats.verify','content.manage','content.publish','tasks.manage','audit.read','access.manage','config.manage',
  'standings.manage','results.record','merch.manage','roster.manage','standings.adjust','lineups.manage'];
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

-- who may see which lineup
create policy lineups_public_read on public.lineups for select to anon, authenticated
  using (status = 'published'
         and exists (select 1 from public.teams t where t.id = team_id and t.is_published and t.is_active and t.registration_status = 'approved')
         and (match_id is null or exists (select 1 from public.matches m where m.id = match_id and m.is_published and m.archived_at is null)));
create policy lineups_staff_read on public.lineups for select to authenticated
  using (public.rbt_has_perm('lineups.manage') or public.rbt_has_perm('matches.view_all')
         or (match_id is not null and status = 'published' and public.rbt_is_assigned(match_id)));
create policy lineup_players_read on public.lineup_players for select to anon, authenticated
  using (exists (select 1 from public.lineups l where l.id = lineup_id));
create policy lineup_revisions_read on public.lineup_revisions for select to authenticated
  using (public.rbt_has_perm('lineups.manage') or public.rbt_has_perm('audit.read'));

-- save (and optionally publish) a lineup: exactly five starters, no duplicates, only this team's players
create or replace function public.save_lineup(
  p_team uuid, p_match uuid, p_starters jsonb, p_subs jsonb, p_captain uuid, p_publish boolean, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
  m public.matches; l public.lineups; v_id uuid; v_ids uuid[] := '{}'; v_sub_ids uuid[] := '{}';
  s jsonb; v_pid uuid; v_pos text; i int; v_before jsonb; p public.players; v_locked boolean := false;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('lineups.manage') then raise exception 'Only the Tournament Administrator can set lineups.' using errcode = 'RB403'; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'Team not found.' using errcode = 'RB404'; end if;
  if p_match is not null then
    select * into m from public.matches where id = p_match;
    if not found then raise exception 'Match not found.' using errcode = 'RB404'; end if;
    if p_team not in (m.home_team_id, m.away_team_id) then raise exception 'That team is not playing in this match.' using errcode = 'RB400'; end if;
    select * into l from public.lineups where team_id = p_team and match_id = p_match;
    v_locked := (l.id is not null and l.locked_at is not null) or m.status in ('live','under_review','final');
    if v_locked then
      if not public.rbt_has_perm('matches.correct') then raise exception 'The lineup is locked since tip-off. Only the Tournament Administrator can record a correction.' using errcode = 'RB403'; end if;
      if v_reason is null or char_length(v_reason) < 5 then raise exception 'Give a reason for correcting the lineup after tip-off.' using errcode = 'RB400'; end if;
    end if;
  else
    select * into l from public.lineups where team_id = p_team and match_id is null;
  end if;

  if jsonb_typeof(coalesce(p_starters,'null'::jsonb)) <> 'array' or jsonb_array_length(p_starters) <> 5 then
    raise exception 'Select exactly five starting players.' using errcode = 'RB400';
  end if;
  for s in select * from jsonb_array_elements(p_starters) loop
    v_pid := nullif(s->>'player_id','')::uuid; v_pos := nullif(btrim(coalesce(s->>'position','')), '');
    if v_pid is null then raise exception 'Every starter needs a player.' using errcode = 'RB400'; end if;
    if v_pid = any(v_ids) then raise exception 'A player cannot be selected twice.' using errcode = 'RB400'; end if;
    if v_pos is null or v_pos not in ('PG','SG','SF','PF','C') then raise exception 'Give every starter a position (PG, SG, SF, PF or C).' using errcode = 'RB400'; end if;
    v_ids := v_ids || v_pid;
  end loop;
  if jsonb_typeof(coalesce(p_subs,'[]'::jsonb)) <> 'array' then raise exception 'Substitutes must be a list.' using errcode = 'RB400'; end if;
  for s in select * from jsonb_array_elements(coalesce(p_subs,'[]'::jsonb)) loop
    v_pid := nullif(s->>'player_id','')::uuid;
    if v_pid is null then raise exception 'Every substitute needs a player.' using errcode = 'RB400'; end if;
    if v_pid = any(v_ids) or v_pid = any(v_sub_ids) then raise exception 'A player cannot be selected twice.' using errcode = 'RB400'; end if;
    v_sub_ids := v_sub_ids || v_pid;
  end loop;
  if (select count(*) from public.players where id = any(v_ids || v_sub_ids) and team_id = p_team and status <> 'archived')
       <> cardinality(v_ids || v_sub_ids) then
    raise exception 'Only registered players of this team can be selected.' using errcode = 'RB400';
  end if;
  if p_captain is not null and not (p_captain = any(v_ids || v_sub_ids)) then
    raise exception 'The captain must be one of the selected players.' using errcode = 'RB400';
  end if;

  if l.id is null then
    insert into public.lineups(team_id, match_id, status, captain_player_id, updated_by)
    values (p_team, p_match, case when coalesce(p_publish,false) then 'published' else 'draft' end, p_captain, auth.uid()) returning id into v_id;
  else
    v_id := l.id;
    select jsonb_build_object('status', l.status, 'captain', l.captain_player_id, 'locked_at', l.locked_at, 'version', l.version,
      'players', coalesce((select jsonb_agg(to_jsonb(lp) order by lp.role, lp.slot) from public.lineup_players lp where lp.lineup_id = l.id), '[]'::jsonb)) into v_before;
    insert into public.lineup_revisions(lineup_id, snapshot, reason) values (l.id, v_before, v_reason);
    delete from public.lineup_players where lineup_id = l.id;
    update public.lineups set status = case when coalesce(p_publish,false) then 'published' else 'draft' end,
           captain_player_id = p_captain, version = version + 1, updated_by = auth.uid(), updated_at = now(), source = 'manual' where id = l.id;
  end if;

  i := 0;
  for s in select * from jsonb_array_elements(p_starters) loop
    i := i + 1; select * into p from public.players where id = (s->>'player_id')::uuid;
    insert into public.lineup_players(lineup_id, player_id, role, slot, position, player_name, jersey_no, photo_path)
    values (v_id, p.id, 'starter', i, s->>'position', p.full_name, p.jersey_no, p.photo_path);
  end loop;
  i := 0;
  for s in select * from jsonb_array_elements(coalesce(p_subs,'[]'::jsonb)) loop
    i := i + 1; select * into p from public.players where id = (s->>'player_id')::uuid;
    insert into public.lineup_players(lineup_id, player_id, role, slot, position, player_name, jersey_no, photo_path)
    values (v_id, p.id, 'substitute', i, nullif(s->>'position',''), p.full_name, p.jersey_no, p.photo_path);
  end loop;

  perform public.rbt_audit(case when v_locked then 'lineup.corrected' else 'lineup.saved' end, 'lineups', v_id::text,
    jsonb_build_object('team_id', p_team, 'match_id', p_match, 'published', coalesce(p_publish,false), 'starters', to_jsonb(v_ids), 'substitutes', to_jsonb(v_sub_ids),
                       'captain', p_captain, 'reason', v_reason, 'before', v_before));
  return v_id;
end $$;

-- start a match lineup from the team's default lineup (a copy: later changes to one never touch the other)
create or replace function public.copy_default_lineup(p_team uuid, p_match uuid, p_publish boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.lineups; v_st jsonb; v_sub jsonb;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('lineups.manage') then raise exception 'Only the Tournament Administrator can set lineups.' using errcode = 'RB403'; end if;
  select * into d from public.lineups where team_id = p_team and match_id is null;
  if not found then raise exception 'This team has no default lineup yet.' using errcode = 'RB404'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('player_id', player_id, 'position', position) order by slot), '[]') into v_st
    from public.lineup_players where lineup_id = d.id and role = 'starter' and player_id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('player_id', player_id) order by slot), '[]') into v_sub
    from public.lineup_players where lineup_id = d.id and role = 'substitute' and player_id is not null;
  return public.save_lineup(p_team, p_match, v_st, v_sub, d.captain_player_id, p_publish, null);
end $$;

-- go back to the default for this match (only before tip-off)
create or replace function public.clear_match_lineup(p_team uuid, p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.lineups;
begin
  perform public.rbt_require_official();
  if not public.rbt_has_perm('lineups.manage') then raise exception 'Only the Tournament Administrator can set lineups.' using errcode = 'RB403'; end if;
  select * into l from public.lineups where team_id = p_team and match_id = p_match;
  if not found then return; end if;
  if l.locked_at is not null then raise exception 'This lineup is locked since tip-off and is kept as a record.' using errcode = 'RB409'; end if;
  delete from public.lineups where id = l.id;
  perform public.rbt_audit('lineup.cleared', 'lineups', l.id::text, jsonb_build_object('team_id', p_team, 'match_id', p_match));
end $$;

-- tip-off: lock what applies to this match and keep it as the historical record
create or replace function public.rbt_lock_match_lineups() returns trigger
language plpgsql security definer set search_path = public as $$
declare tid uuid; ml public.lineups; dl public.lineups; v_new uuid;
begin
  foreach tid in array array[new.home_team_id, new.away_team_id] loop
    select * into ml from public.lineups where team_id = tid and match_id = new.id;
    if found then
      update public.lineups set locked_at = coalesce(locked_at, now()) where id = ml.id;
    else
      select * into dl from public.lineups where team_id = tid and match_id is null and status = 'published';
      if found then
        insert into public.lineups(team_id, match_id, status, captain_player_id, locked_at, source, updated_by)
        values (tid, new.id, 'published', dl.captain_player_id, now(), 'default_snapshot', auth.uid()) returning id into v_new;
        insert into public.lineup_players(lineup_id, player_id, role, slot, position, player_name, jersey_no, photo_path)
        select v_new, player_id, role, slot, position, player_name, jersey_no, photo_path from public.lineup_players where lineup_id = dl.id;
      end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.rbt_lock_match_lineups() from public, anon, authenticated;
drop trigger if exists matches_lock_lineups on public.matches;
create trigger matches_lock_lineups after update of status on public.matches
  for each row when (new.status = 'live' and old.status is distinct from 'live') execute function public.rbt_lock_match_lineups();

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('save_lineup','copy_default_lineup','clear_match_lineup')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- live updates for public lineups
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.lineups; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.lineup_players; exception when duplicate_object then null; end;
  end if;
end $$;
