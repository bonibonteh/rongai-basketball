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
