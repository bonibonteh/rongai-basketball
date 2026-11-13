-- Team profile editing: fix logo and photo upload/replace for the Tournament Administrator.
-- Storage uploads use "insert ... on conflict do update" (upsert), which Postgres only allows when the user can also
-- SELECT the object. The media buckets had insert/update/delete policies but no select policy, so uploading or
-- replacing a team logo failed. Same permissions as the existing write policies.
do $$
declare b record;
begin
  for b in select * from (values
      ('team-logos',    'public.rbt_has_perm(''teams.review'')'),
      ('player-photos', '(public.rbt_has_perm(''teams.review'') or public.rbt_has_perm(''roster.manage''))'),
      ('merch-images',  'public.rbt_has_perm(''merch.manage'')')
    ) as v(bucket, perm)
  loop
    execute format('drop policy if exists %I on storage.objects', b.bucket || '_select');
    execute format('create policy %I on storage.objects for select to authenticated using (bucket_id = %L and %s)', b.bucket || '_select', b.bucket, b.perm);
  end loop;
end $$;

-- Optional team photograph shown on the team profile.
alter table public.teams add column if not exists photo_path text check (photo_path is null or char_length(photo_path) <= 200);
grant select (photo_path) on public.teams to anon;
grant insert (photo_path), update (photo_path) on public.teams to authenticated;
