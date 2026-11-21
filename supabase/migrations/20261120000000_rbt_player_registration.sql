-- Team registration with individual player profiles.
-- Keeps the old 5-argument submit_team_registration working for existing callers.

alter table public.players add column if not exists date_of_birth date;       -- private: not granted to anon
alter table public.teams   add column if not exists mpesa_code text;          -- private: not granted to anon
alter table public.players drop constraint if exists players_dob_check;
alter table public.players add constraint players_dob_check check (date_of_birth is null or (date_of_birth > date '1950-01-01' and date_of_birth < current_date));
alter table public.teams   drop constraint if exists teams_mpesa_check;
alter table public.teams   add constraint teams_mpesa_check check (mpesa_code is null or char_length(mpesa_code) between 6 and 30);

-- Visitors upload player photos to a quarantine folder only: insert only, no overwrite, no delete.
-- The bucket already limits files to 2 MB and JPEG/PNG/WebP.
drop policy if exists player_photos_pending_upload on storage.objects;
create policy player_photos_pending_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'player-photos' and name ~ '^pending/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,2}-[0-9a-z]{6,12}\.(jpg|png|webp)$');

create or replace function public.submit_team_registration(
  p_team_name text, p_captain text, p_phone text, p_mpesa text, p_players jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_n int; v_p jsonb; v_jerseys int[] := '{}'; v_names text[] := '{}'; v_j int; v_name text; v_pos text; v_photo text; v_h int; v_dob date;
  v_min constant int := 5; v_max constant int := 20;
  v_positions constant text[] := array['Point Guard','Shooting Guard','Small Forward','Power Forward','Centre'];
begin
  if length(btrim(coalesce(p_team_name,''))) < 2 then raise exception 'Enter the team name.' using errcode = 'RB400'; end if;
  if length(btrim(coalesce(p_captain,''))) < 2 then raise exception 'Enter the captain''s name.' using errcode = 'RB400'; end if;
  if length(regexp_replace(coalesce(p_phone,''), '\D', '', 'g')) < 9 then raise exception 'Enter a valid captain phone number.' using errcode = 'RB400'; end if;
  if length(btrim(coalesce(p_mpesa,''))) < 6 then raise exception 'Enter the M-Pesa transaction ID.' using errcode = 'RB400'; end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' then raise exception 'Add the players.' using errcode = 'RB400'; end if;
  v_n := jsonb_array_length(p_players);
  if v_n < v_min then raise exception 'A team needs at least % players. You have added %.', v_min, v_n using errcode = 'RB400'; end if;
  if v_n > v_max then raise exception 'A team can have at most % players.', v_max using errcode = 'RB400'; end if;
  if (select count(*) from public.teams where created_at > now() - interval '1 hour' and registration_status = 'pending') >= 30 then
    raise exception 'Too many registrations right now. Try again later.' using errcode = 'RB429';
  end if;
  -- validate every player first so nothing is half-saved
  for v_p in select * from jsonb_array_elements(p_players) loop
    v_name := btrim(coalesce(v_p->>'full_name',''));
    if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'Every player needs a full name.' using errcode = 'RB400'; end if;
    if (v_p->>'jersey_no') is null or (v_p->>'jersey_no') !~ '^\d{1,2}$' then raise exception 'Player "%" needs a jersey number from 0 to 99.', v_name using errcode = 'RB400'; end if;
    v_j := (v_p->>'jersey_no')::int;
    if v_j = any(v_jerseys) then raise exception 'Jersey number % is used twice.', v_j using errcode = 'RB409'; end if;
    if lower(v_name) = any(v_names) then raise exception 'Player "%" is listed twice.', v_name using errcode = 'RB409'; end if;
    v_jerseys := v_jerseys || v_j; v_names := v_names || lower(v_name);
    v_pos := v_p->>'position';
    if v_pos is null or not (v_pos = any(v_positions)) then raise exception 'Choose a playing position for "%".', v_name using errcode = 'RB400'; end if;
    v_photo := v_p->>'photo_path';
    if v_photo is null or v_photo !~ '^pending/[0-9a-f-]{36}/[0-9]{1,2}-[0-9a-z]{6,12}\.(jpg|png|webp)$' then raise exception 'Upload a photo for "%".', v_name using errcode = 'RB400'; end if;
    if nullif(v_p->>'height_cm','') is not null and ((v_p->>'height_cm') !~ '^\d{3}$' or (v_p->>'height_cm')::int not between 120 and 250) then raise exception 'Height for "%" must be 120 to 250 cm.', v_name using errcode = 'RB400'; end if;
    if char_length(coalesce(v_p->>'bio','')) > 1000 then raise exception 'The bio for "%" is too long.', v_name using errcode = 'RB400'; end if;
  end loop;
  begin
    insert into public.teams(name, captain_name, contact_phone, mpesa_code, roster_notes, registration_status, is_published)
    values (btrim(p_team_name), btrim(p_captain), btrim(p_phone), upper(btrim(p_mpesa)), v_n || ' players with profiles', 'pending', false)
    returning id into v_id;
    for v_p in select * from jsonb_array_elements(p_players) loop
      v_h := nullif(v_p->>'height_cm','')::int;
      v_dob := nullif(v_p->>'date_of_birth','')::date;
      insert into public.players(team_id, full_name, jersey_no, position, photo_path, height_cm, bio, date_of_birth, is_published, status)
      values (v_id, btrim(v_p->>'full_name'), (v_p->>'jersey_no')::int, v_p->>'position', v_p->>'photo_path', v_h, nullif(btrim(coalesce(v_p->>'bio','')),''), v_dob, false, 'active');
    end loop;
  exception
    when unique_violation then raise exception 'A team with this name is already registered.' using errcode = 'RB409';
    when check_violation or invalid_datetime_format or datetime_field_overflow then raise exception 'Some details are missing or not valid. Check the form and try again.' using errcode = 'RB400';
  end;
  return v_id;
end $$;
grant execute on function public.submit_team_registration(text,text,text,text,jsonb) to anon;

-- Approving a team publishes its roster; rejecting hides it again.
create or replace function public.review_team(p_team uuid, p_decision text, p_notes text default null)
returns public.teams language plpgsql security definer set search_path = public as $$
declare t public.teams;
begin
  if not public.rbt_has_perm('teams.review') then raise exception 'You cannot review team registrations.' using errcode = 'RB403'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Unknown decision.' using errcode = 'RB400'; end if;
  update public.teams
     set registration_status = p_decision, is_published = (p_decision = 'approved'),
         review_notes = nullif(btrim(coalesce(p_notes,'')), ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_team returning * into t;
  if not found then raise exception 'Team not found.' using errcode = 'RB404'; end if;
  update public.players set is_published = (p_decision = 'approved') where team_id = p_team and archived_at is null and status <> 'archived';
  perform public.rbt_audit('team.' || p_decision, 'teams', p_team::text, jsonb_build_object('name', t.name));
  return t;
end $$;
