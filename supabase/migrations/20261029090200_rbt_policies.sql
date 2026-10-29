-- Rongai Basketball League: grants, Row Level Security policies, realtime.
-- Start from zero access, then grant only what each audience needs.

revoke all on public.official_roles, public.profiles, public.account_requests, public.teams, public.players,
  public.matches, public.match_events, public.official_assignments, public.match_reports, public.tasks,
  public.announcements, public.user_dashboard_preferences, public.audit_logs from anon, authenticated;

-- official_roles: officials read the permission table; changes go through set_role_permissions().
grant select on public.official_roles to authenticated;
create policy roles_read on public.official_roles for select to authenticated using (public.rbt_is_official());

-- profiles: own row, or the Director. Self-edit is limited to display fields by column grants.
grant select on public.profiles to authenticated;
grant update (full_name, display_name, phone, bio, avatar_path) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.rbt_has_perm('access.manage'));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid() and public.rbt_is_official()) with check (id = auth.uid());

-- account_requests: only the Director reads them. Visitors use submit_account_request().
grant select on public.account_requests to authenticated;
create policy requests_director_read on public.account_requests for select to authenticated
  using (public.rbt_has_perm('access.manage'));

-- teams: the public sees approved, published teams and non-private columns.
grant select (id, name, short_name, pool, registration_status, is_published, created_at) on public.teams to anon;
grant select on public.teams to authenticated;
grant insert (name, short_name, pool, captain_name, contact_phone, contact_email, roster_notes, registration_status, is_published) on public.teams to authenticated;
grant update (name, short_name, pool, is_published, captain_name, contact_phone, contact_email, roster_notes) on public.teams to authenticated;
create policy teams_public_read on public.teams for select to anon, authenticated
  using (is_published and registration_status = 'approved');
create policy teams_staff_read on public.teams for select to authenticated
  using (public.rbt_has_perm('teams.review') or public.rbt_has_perm('matches.view_all'));
create policy teams_staff_insert on public.teams for insert to authenticated
  with check (public.rbt_has_perm('teams.review'));
create policy teams_staff_update on public.teams for update to authenticated
  using (public.rbt_has_perm('teams.review')) with check (public.rbt_has_perm('teams.review'));

-- players
grant select (id, team_id, full_name, jersey_no, position, is_published) on public.players to anon;
grant select, insert, update, delete on public.players to authenticated;
create policy players_public_read on public.players for select to anon, authenticated
  using (is_published and exists (select 1 from public.teams t where t.id = team_id));
create policy players_staff_all on public.players for all to authenticated
  using (public.rbt_has_perm('teams.review')) with check (public.rbt_has_perm('teams.review'));

-- matches: clients may edit fixture details only. Scores, clocks and status change through functions.
grant select on public.matches to anon, authenticated;
grant insert (id, home_team_id, away_team_id, round, court, scheduled_at, notes, is_published) on public.matches to authenticated;
grant update (home_team_id, away_team_id, round, court, scheduled_at, notes, is_published) on public.matches to authenticated;
create policy matches_public_read on public.matches for select to anon, authenticated
  using (is_published and archived_at is null);
create policy matches_staff_read on public.matches for select to authenticated
  using (public.rbt_has_perm('matches.view_all') or public.rbt_is_assigned(id));
create policy matches_manage_insert on public.matches for insert to authenticated
  with check (public.rbt_has_perm('matches.manage'));
create policy matches_manage_update on public.matches for update to authenticated
  using (public.rbt_has_perm('matches.manage')) with check (public.rbt_has_perm('matches.manage'));

-- match_events: read-only for everyone, visibility follows the match.
grant select (id, match_id, event_type, team, value, period, clock_seconds, reason, home_score_after, away_score_after, created_at)
  on public.match_events to anon;
grant select on public.match_events to authenticated;
create policy events_read on public.match_events for select to anon, authenticated
  using (exists (select 1 from public.matches m where m.id = match_id));

-- assignments
grant select, insert, delete on public.official_assignments to authenticated;
create policy assignments_read on public.official_assignments for select to authenticated
  using (user_id = auth.uid() or public.rbt_has_perm('matches.manage'));
create policy assignments_insert on public.official_assignments for insert to authenticated
  with check (public.rbt_has_perm('matches.manage'));
create policy assignments_delete on public.official_assignments for delete to authenticated
  using (public.rbt_has_perm('matches.manage'));

-- match reports: append-only
grant select, insert on public.match_reports to authenticated;
create policy reports_read on public.match_reports for select to authenticated
  using (author_id = auth.uid() or public.rbt_has_perm('reports.review'));
create policy reports_insert on public.match_reports for insert to authenticated
  with check (author_id = auth.uid() and public.rbt_has_perm('reports.submit')
              and (public.rbt_is_assigned(match_id) or public.rbt_has_perm('matches.manage')));

-- tasks
grant select, insert, update, delete on public.tasks to authenticated;
create policy tasks_read on public.tasks for select to authenticated
  using (assigned_to = auth.uid() or public.rbt_has_perm('tasks.manage'));
create policy tasks_manage on public.tasks for all to authenticated
  using (public.rbt_has_perm('tasks.manage')) with check (public.rbt_has_perm('tasks.manage'));

-- announcements: the public reads published ones. Status changes go through set_announcement_status().
grant select on public.announcements to anon, authenticated;
grant insert (title, body, is_banner) on public.announcements to authenticated;
grant update (title, body, is_banner) on public.announcements to authenticated;
grant delete on public.announcements to authenticated;
create policy announcements_public on public.announcements for select to anon, authenticated using (status = 'published');
create policy announcements_staff_read on public.announcements for select to authenticated
  using (author_id = auth.uid() or public.rbt_has_perm('content.manage') or public.rbt_has_perm('content.publish'));
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.rbt_has_perm('content.manage') and author_id = auth.uid() and status = 'draft');
create policy announcements_update on public.announcements for update to authenticated
  using (author_id = auth.uid() and status = 'draft' and public.rbt_has_perm('content.manage'))
  with check (author_id = auth.uid() and status = 'draft');
create policy announcements_delete on public.announcements for delete to authenticated
  using (author_id = auth.uid() and status = 'draft' and public.rbt_has_perm('content.manage'));

-- dashboard preferences: own row only
grant select, insert, update on public.user_dashboard_preferences to authenticated;
create policy prefs_own on public.user_dashboard_preferences for all to authenticated
  using (user_id = auth.uid() and public.rbt_is_official()) with check (user_id = auth.uid() and public.rbt_is_official());

-- audit log: only readers with audit.read (the Director). Nobody can edit or delete it.
grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated using (public.rbt_has_perm('audit.read'));

-- Realtime: public scoreboards, announcements, and the Director's request queue
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.matches; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.announcements; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.account_requests; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.tasks; exception when duplicate_object then null; end;
  end if;
end $$;
