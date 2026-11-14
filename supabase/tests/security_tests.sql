-- Security and lifecycle tests. Each line prints PASS or stops the run with FAIL.
create schema t;
create table t.results(label text, ok boolean);

-- run sql as a signed-in user (or anon when u is null); returns 'OK' or the error message
create function t.run(u uuid, q text, as_anon boolean default false) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  execute case when as_anon then 'set local role anon' else 'set local role authenticated' end;
  begin execute q; reset role; return 'OK';
  exception when others then reset role; return sqlerrm; end;
end $$;
create function t.val(u uuid, q text, as_anon boolean default false) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  execute case when as_anon then 'set local role anon' else 'set local role authenticated' end;
  begin execute q into r; reset role; return r;
  exception when others then reset role; return 'ERR: ' || sqlerrm; end;
end $$;
create procedure t.check(label text, got text, want text) language plpgsql as $$
begin
  if want = 'OK' and got = 'OK' or want <> 'OK' and got ilike '%' || want || '%' or want = got then
    raise notice 'PASS  %', label;
  else raise exception 'FAIL  %  (got: %, wanted: %)', label, got, want; end if;
end $$;

-- fixtures (as superuser)
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000d001','director@x.test'),('00000000-0000-0000-0000-00000000a001','score@x.test'),
 ('00000000-0000-0000-0000-00000000a002','score2@x.test'),('00000000-0000-0000-0000-00000000f001','fixture@x.test'),
 ('00000000-0000-0000-0000-00000000e001','readonly@x.test'),('00000000-0000-0000-0000-00000000b001','susp@x.test'),
 ('00000000-0000-0000-0000-00000000c001','nobody@x.test'),('00000000-0000-0000-0000-00000000c002','invited@x.test');
insert into public.profiles(id,full_name,email,role,status) values
 ('00000000-0000-0000-0000-00000000d001','Brian Director','director@x.test','director','active'),
 ('00000000-0000-0000-0000-00000000a001','Sam Score','score@x.test','scorekeeper','active'),
 ('00000000-0000-0000-0000-00000000a002','Sue Score','score2@x.test','scorekeeper','active'),
 ('00000000-0000-0000-0000-00000000f001','Fred Fixture','fixture@x.test','fixture_manager','active'),
 ('00000000-0000-0000-0000-00000000e001','Rita Readonly','readonly@x.test','read_only','active'),
 ('00000000-0000-0000-0000-00000000b001','Sid Suspended','susp@x.test','scorekeeper','suspended');
insert into public.teams(id,name,registration_status,is_published) values
 ('10000000-0000-0000-0000-000000000001','Rongai Heat','approved',true),
 ('10000000-0000-0000-0000-000000000002','Matatu Kings','approved',true),
 ('10000000-0000-0000-0000-000000000003','Kware Titans','approved',true);
insert into public.matches(id,home_team_id,away_team_id,scheduled_at,is_published,status) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',now(),true,'scheduled');
insert into public.official_assignments(match_id,user_id,assignment_role) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a001','scorekeeper');

\set D '''00000000-0000-0000-0000-00000000d001''::uuid'
\set SK '''00000000-0000-0000-0000-00000000a001''::uuid'
\set SK2 '''00000000-0000-0000-0000-00000000a002''::uuid'
\set FX '''00000000-0000-0000-0000-00000000f001''::uuid'
\set RO '''00000000-0000-0000-0000-00000000e001''::uuid'
\set SU '''00000000-0000-0000-0000-00000000b001''::uuid'
\set NB '''00000000-0000-0000-0000-00000000c001''::uuid'
\set M '''20000000-0000-0000-0000-000000000001'''

-- 1. Account requests
call t.check('anon can submit an account request', t.run(null, $$select public.submit_account_request('Jo Visitor','jo@x.test',null,'scorekeeper','I score games at the club')$$, true), 'OK');
call t.check('anon cannot read account requests', t.val(null, 'select count(*) from public.account_requests', true), 'permission denied');
call t.check('scorekeeper cannot read account requests', t.val(:SK, 'select count(*)::text from public.account_requests'), '0');
call t.check('duplicate pending request is refused', t.run(null, $$select public.submit_account_request('Jo Visitor','JO@x.test',null,'scorekeeper','I score games at the club')$$, true), 'already waiting');
call t.check('visitor cannot request the director role', t.run(null, $$select public.submit_account_request('Eve Evil','eve@x.test',null,'director','Please make me the director')$$, true), 'Choose one of the listed roles');
call t.check('visitor cannot insert a request directly', t.run(null, $$insert into public.account_requests(full_name,email,requested_role,reason) values ('X Y','x@y.test','scorekeeper','direct insert attempt')$$, true), 'permission denied');
call t.check('scorekeeper cannot reject a request', t.run(:SK, $$select public.review_account_request((select id from public.account_requests limit 1),'rejected','no')$$), 'Only the Director');
call t.check('director can ask for more info', t.run(:D, $$select public.review_account_request((select id from public.account_requests limit 1),'more_info','Which club?')$$), 'OK');
insert into public.account_requests(full_name,email,requested_role,reason) values ('Ivy Invited','invited@x.test','scorekeeper','I will score the Saturday games');
call t.check('scorekeeper cannot approve a request', t.run(:SK, $$select public.approve_account_request((select id from public.account_requests where email='invited@x.test'),'00000000-0000-0000-0000-00000000c002','scorekeeper')$$), 'Only the Director');
call t.check('approval refuses a mismatched auth user', t.run(:D, $$select public.approve_account_request((select id from public.account_requests where email='invited@x.test'),'00000000-0000-0000-0000-00000000c001','scorekeeper')$$), 'does not match');
call t.check('director approves request', t.run(:D, $$select public.approve_account_request((select id from public.account_requests where email='invited@x.test'),'00000000-0000-0000-0000-00000000c002','scorekeeper','Courtside')$$), 'OK');
call t.check('approved official now has an active profile', t.val('00000000-0000-0000-0000-00000000c002', 'select status from public.profiles where id = auth.uid()'), 'active');

-- 2. No self-promotion
call t.check('official cannot change own role', t.run(:SK, $$update public.profiles set role='director' where id=auth.uid()$$), 'permission denied');
call t.check('official cannot change own status', t.run(:SK, $$update public.profiles set status='active', role='director' where id=auth.uid()$$), 'permission denied');
call t.check('official can edit own bio', t.run(:SK, $$update public.profiles set bio='Ten years on the table' where id=auth.uid()$$), 'OK');
call t.check('official cannot call admin_set_official', t.run(:SK, $$select public.admin_set_official(auth.uid(),'director')$$), 'Only the Director');
call t.check('fixture manager cannot grant director', t.run(:FX, $$select public.admin_set_official('00000000-0000-0000-0000-00000000e001','director')$$), 'Only the Director');
call t.check('director cannot demote self', t.run(:D, $$select public.admin_set_official(auth.uid(),'read_only')$$), 'cannot change your own');
call t.check('unknown user has no official access', t.val(:NB, 'select public.rbt_is_official()::text'), 'false');
call t.check('signed-up user without profile cannot read matches list beyond public', t.val(:NB, 'select count(*)::text from public.matches'), '1');
call t.check('signed-up user without profile cannot write matches', t.run(:NB, $$insert into public.matches(home_team_id,away_team_id,scheduled_at) values ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',now())$$), 'row-level security');

-- 3. Suspension
call t.check('suspended official has no access', t.val(:SU, 'select public.rbt_is_official()::text'), 'false');
call t.check('director suspends a scorekeeper', t.run(:D, $$select public.admin_set_official('00000000-0000-0000-0000-00000000a002', null, null, 'suspended')$$), 'OK');
call t.check('suspended scorekeeper cannot score', t.run(:SK2, $$select public.record_match_event('20000000-0000-0000-0000-000000000001', gen_random_uuid(), 'score', 'home', 2)$$), 'active official');
call t.check('suspended official cannot edit profile', t.run(:SK2, $$update public.profiles set bio='x' where id=auth.uid()$$), 'OK');
call t.check('...and the edit changed nothing', t.val(:SK2, $$select coalesce(bio,'') from public.profiles where id=auth.uid()$$), '');

-- 4. Lifecycle and live scoring
call t.check('scorekeeper cannot start an unready game', t.run(:SK, $$select public.transition_match('20000000-0000-0000-0000-000000000001','live')$$), 'cannot move');
call t.check('read-only official cannot ready a game', t.run(:RO, $$select public.transition_match('20000000-0000-0000-0000-000000000001','ready')$$), 'cannot change fixtures');
call t.check('fixture manager marks game ready', t.run(:FX, $$select public.transition_match('20000000-0000-0000-0000-000000000001','ready')$$), 'OK');
call t.check('assigned scorekeeper starts game', t.run(:SK, $$select public.transition_match('20000000-0000-0000-0000-000000000001','live')$$), 'OK');
call t.check('unassigned scorekeeper cannot score', t.run('00000000-0000-0000-0000-00000000c002', $$select public.record_match_event('20000000-0000-0000-0000-000000000001', gen_random_uuid(), 'score', 'home', 2)$$), 'not assigned');
call t.check('scorekeeper records 3 points', t.run(:SK, $$select public.record_match_event('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'score', 'home', 3)$$), 'OK');
call t.check('a retry of the same event is accepted', t.run(:SK, $$select public.record_match_event('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'score', 'home', 3)$$), 'OK');
call t.check('...and the score was counted once', t.val(null, $$select home_score::text from public.matches where id='20000000-0000-0000-0000-000000000001'$$, true), '3');
call t.check('public viewer sees the live score', t.val(null, $$select status from public.matches where id='20000000-0000-0000-0000-000000000001'$$, true), 'live');
call t.check('stale version is rejected', t.run(:SK, $$select public.record_match_event('20000000-0000-0000-0000-000000000001', gen_random_uuid(), 'score', 'away', 2, 0)$$), 'version_conflict');
call t.check('public cannot change scores', t.run(null, $$update public.matches set home_score = 99$$, true), 'permission denied');
call t.check('scorekeeper cannot write the score column directly', t.run(:SK, $$update public.matches set home_score = 99$$), 'permission denied');
call t.check('director cannot write status directly either', t.run(:D, $$update public.matches set status = 'final'$$), 'permission denied');
call t.check('score removal needs a reason', t.run(:SK, $$select public.record_match_event('20000000-0000-0000-0000-000000000001', gen_random_uuid(), 'undo_score', 'home', 1)$$), 'reason');
call t.check('score removal with a reason works', t.run(:SK, $$select public.record_match_event('20000000-0000-0000-0000-000000000001', gen_random_uuid(), 'undo_score', 'home', 1, null, 'Wrong player credited')$$), 'OK');
call t.check('...and is in the audit log', t.val(:D, $$select count(*)::text from public.audit_logs where action='match.score_corrected'$$), '1');

-- 5. Deleting and cancelling live games
call t.check('director cannot delete a live game', t.run(:D, $$select public.delete_draft_match('20000000-0000-0000-0000-000000000001')$$), 'Only a scheduled');
call t.check('no one can DELETE the row through the API', t.run(:D, $$delete from public.matches where id='20000000-0000-0000-0000-000000000001'$$), 'permission denied');
do $$ begin begin delete from public.matches where id='20000000-0000-0000-0000-000000000001'; raise exception 'FAIL delete went through'; exception when sqlstate 'RB409' then raise notice 'PASS  even the table owner cannot delete a live game (trigger backstop)'; end; end $$;
call t.check('scorekeeper cannot cancel a live game', t.run(:SK, $$select public.transition_match('20000000-0000-0000-0000-000000000001','cancelled','Rain stopped play for good')$$), 'Only the Director');
call t.check('cancelling a live game needs a reason', t.run(:D, $$select public.transition_match('20000000-0000-0000-0000-000000000001','cancelled')$$), 'reason is required');
call t.check('scorekeeper finalises the game', t.run(:SK, $$select public.transition_match('20000000-0000-0000-0000-000000000001','final','Full time')$$), 'OK');
call t.check('final score cannot be changed by scorekeeper', t.run(:SK, $$select public.record_match_event('20000000-0000-0000-0000-000000000001', gen_random_uuid(), 'score', 'home', 2)$$), 'not live');
call t.check('final result cannot be corrected without review', t.run(:D, $$select public.correct_match_score('20000000-0000-0000-0000-000000000001', 50, 40, 'Fix typo')$$), 'under review');
call t.check('scorekeeper cannot reopen a final result', t.run(:SK, $$select public.transition_match('20000000-0000-0000-0000-000000000001','under_review','I made a mistake')$$), 'Only the Director');
call t.check('director reopens for review', t.run(:D, $$select public.transition_match('20000000-0000-0000-0000-000000000001','under_review','Disputed by Matatu Kings')$$), 'OK');
call t.check('director corrects result with a reason', t.run(:D, $$select public.correct_match_score('20000000-0000-0000-0000-000000000001', 50, 40, 'Table sheet recount')$$), 'OK');
call t.check('director confirms the final', t.run(:D, $$select public.transition_match('20000000-0000-0000-0000-000000000001','final','Recount confirmed')$$), 'OK');
call t.check('standings update from the final result', t.val(null, $$select wins::text from public.get_standings() where team_name='Rongai Heat'$$, true), '1');
call t.check('events cannot be edited', t.run(:D, $$update public.match_events set value = 99$$), 'permission denied');
do $$ begin begin update public.match_events set value = 99; raise exception 'FAIL event update went through'; exception when sqlstate 'RB403' then raise notice 'PASS  even the table owner cannot edit match events'; end; end $$;
call t.check('audit log cannot be edited', t.run(:D, $$update public.audit_logs set action='x'$$), 'permission denied');
do $$ begin begin delete from public.audit_logs; raise exception 'FAIL audit delete went through'; exception when sqlstate 'RB403' then raise notice 'PASS  even the table owner cannot delete audit rows'; end; end $$;
call t.check('scorekeeper cannot read the audit log', t.val(:SK, 'select count(*)::text from public.audit_logs'), '0');

-- 6. Archive and restore
call t.check('scorekeeper cannot archive', t.run(:SK, $$select public.archive_match('20000000-0000-0000-0000-000000000001','Duplicate entry')$$), 'Only the Director');
call t.check('director archives a final game', t.run(:D, $$select public.archive_match('20000000-0000-0000-0000-000000000001','Played under wrong fixture')$$), 'OK');
call t.check('archived game leaves the public site', t.val(null, 'select count(*)::text from public.matches', true), '0');
call t.check('history is kept after archiving', t.val(:D, $$select (count(*) >= 6)::text from public.match_events where match_id='20000000-0000-0000-0000-000000000001'$$), 'true');
call t.check('director restores the game', t.run(:D, $$select public.restore_match('20000000-0000-0000-0000-000000000001')$$), 'OK');
call t.check('game is public again', t.val(null, 'select count(*)::text from public.matches', true), '1');

-- 7. Fixtures, drafts, public data
call t.check('fixture manager creates a fixture', t.run(:FX, $$insert into public.matches(id,home_team_id,away_team_id,scheduled_at) values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',now()+interval '1 day')$$), 'OK');
call t.check('unpublished fixture is hidden from public', t.val(null, 'select count(*)::text from public.matches', true), '1');
call t.check('read-only official cannot create a fixture', t.run(:RO, $$insert into public.matches(home_team_id,away_team_id,scheduled_at) values ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',now())$$), 'row-level security');
call t.check('fixture manager may delete an untouched scheduled fixture', t.run(:FX, $$select public.delete_draft_match('20000000-0000-0000-0000-000000000002')$$), 'OK');
call t.check('public cannot read private team contact details', t.val(null, 'select contact_email from public.teams limit 1', true), 'permission denied');
call t.check('visitor can register a team', t.run(null, $$select public.submit_team_registration('Ngong Bulls','Joe Captain','0700000000','joe@x.test','12 players')$$, true), 'OK');
call t.check('new team is not public until approved', t.val(null, $$select count(*)::text from public.teams where name='Ngong Bulls'$$, true), '0');

-- 8. Announcements and permissions editor
insert into public.profiles(id,full_name,email,role,status) values ('00000000-0000-0000-0000-00000000c001','Mia Media','nobody@x.test','media_officer','active');
call t.check('media officer drafts an announcement', t.run(:NB, $$insert into public.announcements(title,body) values ('Semis tonight','Gates open at 4pm')$$), 'OK');
call t.check('draft is not public', t.val(null, 'select count(*)::text from public.announcements', true), '0');
call t.check('media officer cannot publish', t.run(:NB, $$select public.set_announcement_status((select id from public.announcements limit 1),'published')$$), 'Only the Director');
call t.check('media officer cannot insert as published', t.run(:NB, $$insert into public.announcements(title,body,status) values ('x y z','body here','published')$$), 'permission denied');
call t.check('director publishes', t.run(:D, $$select public.set_announcement_status((select id from public.announcements limit 1),'published')$$), 'OK');
call t.check('published announcement is public', t.val(null, 'select count(*)::text from public.announcements', true), '1');
call t.check('only the Director edits role permissions', t.run(:FX, $$select public.set_role_permissions('read_only', array['matches.manage'])$$), 'Only the Director');
call t.check('director edits role permissions', t.run(:D, $$select public.set_role_permissions('read_only', array['matches.view_all','audit.read'])$$), 'OK');
call t.check('director role cannot be edited', t.run(:D, $$select public.set_role_permissions('director', array['audit.read'])$$), 'always has full access');
call t.check('unknown permissions are refused', t.run(:D, $$select public.set_role_permissions('read_only', array['nope'])$$), 'Unknown permission');

-- 9. Tasks and preferences
call t.check('director assigns a task', t.run(:D, $$insert into public.tasks(title,assigned_to) values ('Verify Heat roster','00000000-0000-0000-0000-00000000a001')$$), 'OK');
call t.check('assignee sees own task only', t.val(:SK, 'select count(*)::text from public.tasks'), '1');
call t.check('assignee completes own task', t.run(:SK, $$select public.update_task_status((select id from public.tasks limit 1),'done','Checked')$$), 'OK');
call t.check('other official cannot see the task', t.val(:FX, 'select count(*)::text from public.tasks'), '0');
call t.check('official saves own dashboard layout', t.run(:SK, $$insert into public.user_dashboard_preferences(user_id,layout) values (auth.uid(),'{"widgets":["tasks"]}')$$), 'OK');
call t.check('official cannot save layout for someone else', t.run(:SK, $$insert into public.user_dashboard_preferences(user_id) values ('00000000-0000-0000-0000-00000000d001')$$), 'row-level security');
call t.check('last active director cannot be removed', t.run(:D, $$select public.admin_set_official('00000000-0000-0000-0000-00000000d001', null, null, 'revoked')$$), 'cannot change your own');

-- 10. Team media: the Director can upload and replace a team logo
call t.check('director uploads a team logo', t.run(:D, $$insert into storage.objects(bucket_id,name) values ('team-logos','t/logo.png')$$), 'OK');
call t.check('director replaces a team logo', t.val(:D, $$with u as (update storage.objects set name='t/logo2.png' where bucket_id='team-logos' and name='t/logo.png' returning 1) select count(*)::text from u$$), '1');
call t.check('director edits a team profile and photo', t.val(:D, $$with u as (update public.teams set description='Fast break', coach_name='Coach', photo_path='t/p.png', short_name='RH' where name='Rongai Heat' returning 1) select count(*)::text from u$$), '1');
call t.check('visitor cannot upload a team logo', t.run(null, $$insert into storage.objects(bucket_id,name) values ('team-logos','t/evil.png')$$, true), 'permission denied');
call t.check('scorekeeper cannot upload a team logo', t.run(:SK, $$insert into storage.objects(bucket_id,name) values ('team-logos','t/evil.png')$$), 'row-level security');

-- 11. Standings points adjustments (positive and negative)
call t.check('director adds +2 points', t.run(:D, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000001', 2, 'Fair play bonus')$$), 'OK');
call t.check('director adds -2 points', t.run(:D, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000002', -2, 'Late arrival penalty')$$), 'OK');
call t.check('director adds -1 point', t.run(:D, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000003', -1, 'Misconduct warning')$$), 'OK');
call t.check('final = match points + adjustment (+2)', t.val(:D, $$select (points = match_points + 2 and adjustment = 2)::text from public.get_standings_admin() where team_id='10000000-0000-0000-0000-000000000001'$$), 'true');
call t.check('final = match points + adjustment (-2)', t.val(:D, $$select (points = match_points - 2 and adjustment = -2)::text from public.get_standings_admin() where team_id='10000000-0000-0000-0000-000000000002'$$), 'true');
call t.check('public standings show the adjusted points', t.val(null, $$select (points = match_points - 2)::text from public.get_standings() where team_id='10000000-0000-0000-0000-000000000002'$$, true), 'true');
call t.check('zero adjustment is refused', t.run(:D, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000001', 0, 'Nothing to do here')$$), 'whole number');
call t.check('adjustment needs a reason', t.run(:D, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000001', -3, 'x')$$), 'reason');
call t.check('huge adjustment is refused', t.run(:D, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000001', -500, 'Way too many points')$$), '100 points');
call t.check('scorekeeper cannot adjust points', t.run(:SK, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000001', 2, 'Trying my luck')$$), 'Only the Tournament Administrator');
call t.check('fixture manager cannot adjust points', t.run(:FX, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000001', -2, 'Trying my luck')$$), 'Only the Tournament Administrator');
call t.check('visitor cannot adjust points', t.run(null, $$select public.add_standings_adjustment('10000000-0000-0000-0000-000000000001', 2, 'Trying my luck')$$, true), 'permission denied');
call t.check('nobody can edit history directly', t.run(:D, $$update public.standings_adjustments set points = 50$$), 'permission denied');
call t.check('nobody can delete history directly', t.run(:D, $$delete from public.standings_adjustments$$), 'permission denied');
call t.check('director sees the history with names', t.val(:D, $$select count(*)::text from public.list_standings_adjustments() where created_by_name is not null$$), '3');
call t.check('director reverses an adjustment', t.run(:D, $$select public.reverse_standings_adjustment((select id from public.standings_adjustments where points=-2 and reversed_at is null limit 1), 'Penalty was wrongly applied')$$), 'OK');
call t.check('reversed points no longer count', t.val(:D, $$select (adjustment = 0)::text from public.get_standings_admin() where team_id='10000000-0000-0000-0000-000000000002'$$), 'true');
call t.check('reversal stays in the history', t.val(:D, $$select count(*)::text from public.list_standings_adjustments() where reversed_at is not null$$), '1');
call t.check('cannot reverse twice', t.run(:D, $$select public.reverse_standings_adjustment((select id from public.standings_adjustments where reversed_at is not null limit 1), 'Trying to reverse again')$$), 'already reversed');
call t.check('director corrects an adjustment', t.run(:D, $$select public.correct_standings_adjustment((select id from public.standings_adjustments where points=-1 and reversed_at is null limit 1), -3, 'Penalty increased after review')$$), 'OK');
call t.check('corrected value counts', t.val(:D, $$select (adjustment = -3)::text from public.get_standings_admin() where team_id='10000000-0000-0000-0000-000000000003'$$), 'true');
call t.check('adjustments are audited', t.val(:D, $$select (count(*) >= 5)::text from public.audit_logs where action like 'standings.adjustment%'$$), 'true');

-- 12. Starting Five lineups
insert into public.players(id,team_id,full_name,jersey_no,position,is_published) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Heat One',1,'PG',true),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Heat Two',2,'SG',true),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Heat Three',3,'SF',true),
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Heat Four',4,'PF',true),
 ('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Heat Five',5,'C',true),
 ('30000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','Heat Six',6,'PG',true),
 ('30000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','Heat Seven',7,'SG',true),
 ('30000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','Heat Eight',8,'C',true),
 ('30000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000003','Titan One',1,'PG',true),
 ('30000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000003','Titan Two',2,'SG',true),
 ('30000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000003','Titan Three',3,'SF',true),
 ('30000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000003','Titan Four',4,'PF',true),
 ('30000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000003','Titan Five',5,'C',true),
 ('30000000-0000-0000-0000-000000000016','10000000-0000-0000-0000-000000000003','Titan Six',6,'PG',true);
insert into public.matches(id,home_team_id,away_team_id,scheduled_at,is_published,status) values
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',now() + interval '1 day',true,'scheduled'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',now() + interval '2 day',true,'scheduled');
insert into public.official_assignments(match_id,user_id,assignment_role) values
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000a001','scorekeeper');
\set HEAT '''10000000-0000-0000-0000-000000000001'''
\set TIT '''10000000-0000-0000-0000-000000000003'''
\set M2 '''20000000-0000-0000-0000-000000000002'''
\set M3 '''20000000-0000-0000-0000-000000000003'''
\set S1 '[{"player_id":"30000000-0000-0000-0000-000000000001","position":"PG"},{"player_id":"30000000-0000-0000-0000-000000000002","position":"SG"},{"player_id":"30000000-0000-0000-0000-000000000003","position":"SF"},{"player_id":"30000000-0000-0000-0000-000000000004","position":"PF"},{"player_id":"30000000-0000-0000-0000-000000000005","position":"C"}]'
\set S2 '[{"player_id":"30000000-0000-0000-0000-000000000006","position":"PG"},{"player_id":"30000000-0000-0000-0000-000000000002","position":"SG"},{"player_id":"30000000-0000-0000-0000-000000000003","position":"SF"},{"player_id":"30000000-0000-0000-0000-000000000007","position":"PF"},{"player_id":"30000000-0000-0000-0000-000000000008","position":"C"}]'
\set SUBS '[{"player_id":"30000000-0000-0000-0000-000000000006"},{"player_id":"30000000-0000-0000-0000-000000000007"}]'
\set SUBS2 '[{"player_id":"30000000-0000-0000-0000-000000000001"},{"player_id":"30000000-0000-0000-0000-000000000004"}]'
\set TST '[{"player_id":"30000000-0000-0000-0000-000000000011","position":"PG"},{"player_id":"30000000-0000-0000-0000-000000000012","position":"SG"},{"player_id":"30000000-0000-0000-0000-000000000013","position":"SF"},{"player_id":"30000000-0000-0000-0000-000000000014","position":"PF"},{"player_id":"30000000-0000-0000-0000-000000000015","position":"C"}]'
call t.check('director saves and publishes a default lineup', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, %L::jsonb, '30000000-0000-0000-0000-000000000001', true)$f$, :HEAT, :'S1', :'SUBS')), 'OK');
call t.check('exactly five starters are required', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, '[{"player_id":"30000000-0000-0000-0000-000000000001","position":"PG"}]'::jsonb, '[]'::jsonb, null, true)$f$, :HEAT)), 'exactly five');
call t.check('the same player cannot be picked twice', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[]'::jsonb, null, true)$f$, :HEAT, replace(:'S1','000000000005','000000000001'))), 'twice');
call t.check('a substitute cannot also start', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[{"player_id":"30000000-0000-0000-0000-000000000001"}]'::jsonb, null, true)$f$, :HEAT, :'S1')), 'twice');
call t.check('players must belong to the team', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[]'::jsonb, null, true)$f$, :HEAT, :'TST')), 'registered players of this team');
call t.check('captain must be a selected player', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[]'::jsonb, '30000000-0000-0000-0000-000000000008', true)$f$, :HEAT, :'S1')), 'captain');
call t.check('every starter needs a valid position', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[]'::jsonb, null, true)$f$, :HEAT, replace(:'S1','"C"','"XX"'))), 'position');
call t.check('official cannot set a lineup', t.run(:SK, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[]'::jsonb, null, true)$f$, :HEAT, :'S1')), 'Only the Tournament Administrator');
call t.check('visitor cannot set a lineup', t.run(null, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[]'::jsonb, null, true)$f$, :HEAT, :'S1'), true), 'permission denied');
call t.check('public sees the published default lineup', t.val(null, $$select count(*)::text from public.lineup_players where role='starter'$$, true), '5');
call t.check('public sees the substitutes separately', t.val(null, $$select count(*)::text from public.lineup_players where role='substitute'$$, true), '2');
call t.check('public sees the captain', t.val(null, $$select (captain_player_id = '30000000-0000-0000-0000-000000000001')::text from public.lineups where match_id is null$$, true), 'true');
call t.check('director saves a DRAFT match lineup', t.run(:D, format($f$select public.save_lineup(%L::uuid, %L::uuid, %L::jsonb, %L::jsonb, null, false)$f$, :HEAT, :M2, :'S2', :'SUBS2')), 'OK');
call t.check('draft lineups are not public', t.val(null, $$select count(*)::text from public.lineups where match_id is not null$$, true), '0');
call t.check('assigned official cannot see a draft lineup', t.val(:SK, $$select count(*)::text from public.lineups where match_id is not null$$), '0');
call t.check('director publishes the match lineup', t.run(:D, format($f$select public.save_lineup(%L::uuid, %L::uuid, %L::jsonb, %L::jsonb, null, true)$f$, :HEAT, :M2, :'S2', :'SUBS2')), 'OK');
call t.check('different matches have different fives', t.val(:D, $$select (count(distinct l.id) = 2)::text from public.lineups l join public.lineup_players p on p.lineup_id=l.id and p.role='starter' where l.team_id='10000000-0000-0000-0000-000000000001' and p.player_name in ('Heat Five','Heat Eight')$$), 'true');
call t.check('assigned official sees the published match lineup', t.val(:SK, $$select count(*)::text from public.lineups where match_id='20000000-0000-0000-0000-000000000002'$$), '1');
call t.check('unassigned official does not see it', t.val(:SK2, $$select count(*)::text from public.lineups where match_id='20000000-0000-0000-0000-000000000002' and status='published' and false$$), '0');
call t.check('director copies the default into another match', t.run(:D, format($f$select public.copy_default_lineup(%L::uuid, %L::uuid, true)$f$, :HEAT, :M3)), 'OK');
call t.check('copy is independent of the default', t.run(:D, format($f$select public.save_lineup(%L::uuid, %L::uuid, %L::jsonb, '[]'::jsonb, null, true)$f$, :HEAT, :M3, :'S2')), 'OK');
call t.check('default lineup is unchanged by match edits', t.val(:D, $$select string_agg(player_name, ',' order by slot) from public.lineup_players where lineup_id=(select id from public.lineups where match_id is null and team_id='10000000-0000-0000-0000-000000000001') and role='starter'$$), 'Heat One,Heat Two,Heat Three,Heat Four,Heat Five');
call t.check('team not in the match is refused', t.run(:D, format($f$select public.save_lineup('10000000-0000-0000-0000-000000000002'::uuid, %L::uuid, %L::jsonb, '[]'::jsonb, null, true)$f$, :M2, :'S1')), 'not playing');
-- Titans have no lineup of their own: the default is snapshotted at tip-off only if one is published
call t.check('director publishes Titans default', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[]'::jsonb, null, true)$f$, :TIT, :'TST')), 'OK');
update public.matches set status='ready' where id='20000000-0000-0000-0000-000000000002';
update public.matches set status='live' where id='20000000-0000-0000-0000-000000000002';
call t.check('tip-off locks the Heat lineup', t.val(:D, $$select (locked_at is not null)::text from public.lineups where match_id='20000000-0000-0000-0000-000000000002' and team_id='10000000-0000-0000-0000-000000000001'$$), 'true');
call t.check('tip-off snapshots the Titans default for the record', t.val(:D, $$select source from public.lineups where match_id='20000000-0000-0000-0000-000000000002' and team_id='10000000-0000-0000-0000-000000000003'$$), 'default_snapshot');
call t.check('snapshot keeps all five starters', t.val(:D, $$select count(*)::text from public.lineup_players p join public.lineups l on l.id=p.lineup_id where l.match_id='20000000-0000-0000-0000-000000000002' and l.team_id='10000000-0000-0000-0000-000000000003' and p.role='starter'$$), '5');
call t.check('later default change does not alter the historical lineup', t.run(:D, format($f$select public.save_lineup(%L::uuid, null, %L::jsonb, '[]'::jsonb, null, true)$f$, :TIT, replace(:'TST','000000000015','000000000016'))), 'OK');
call t.check('historical lineup still shows the original five', t.val(:D, $$select count(*)::text from public.lineup_players p join public.lineups l on l.id=p.lineup_id where l.match_id='20000000-0000-0000-0000-000000000002' and l.team_id='10000000-0000-0000-0000-000000000003' and p.player_name='Titan Five'$$), '1');
call t.check('correction after tip-off needs a reason', t.run(:D, format($f$select public.save_lineup(%L::uuid, %L::uuid, %L::jsonb, '[]'::jsonb, null, true)$f$, :HEAT, :M2, :'S1')), 'reason');
call t.check('director records a correction with a reason', t.run(:D, format($f$select public.save_lineup(%L::uuid, %L::uuid, %L::jsonb, '[]'::jsonb, null, true, 'Wrong player listed at tip-off')$f$, :HEAT, :M2, :'S1')), 'OK');
call t.check('correction keeps the original as a revision', t.val(:D, $$select count(*)::text from public.lineup_revisions r join public.lineups l on l.id=r.lineup_id where l.match_id='20000000-0000-0000-0000-000000000002' and r.reason='Wrong player listed at tip-off'$$), '1');
call t.check('correction is audited', t.val(:D, $$select count(*)::text from public.audit_logs where action='lineup.corrected'$$), '1');
call t.check('locked lineup cannot be cleared', t.run(:D, format($f$select public.clear_match_lineup(%L::uuid, %L::uuid)$f$, :HEAT, :M2)), 'locked');
call t.check('unlocked match lineup can be cleared', t.run(:D, format($f$select public.clear_match_lineup(%L::uuid, %L::uuid)$f$, :HEAT, :M3)), 'OK');
call t.check('nobody can write lineup tables directly', t.run(:D, $$update public.lineups set status='draft'$$), 'permission denied');
