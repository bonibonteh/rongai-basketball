-- Private avatar bucket: each official can manage only files under their own user id folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create policy avatars_own_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.rbt_is_official()
         and ((storage.foldername(name))[1] = auth.uid()::text or public.rbt_has_perm('access.manage')));
create policy avatars_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.rbt_is_official() and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_own_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
