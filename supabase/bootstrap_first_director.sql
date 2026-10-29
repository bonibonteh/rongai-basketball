-- Run ONCE in the Supabase SQL Editor (it runs as the project owner), after you create your own login.
-- 1. Dashboard > Authentication > Users > Add user > "Create new user" with your email and a strong password.
-- 2. Put that same email below and run this script.
-- It refuses to run if an active Director already exists, so it cannot be used to add a second one.
do $$
declare v_email text := 'bonibonteh@gmail.com';   -- change if you used another email
        v_user auth.users;
begin
  if exists (select 1 from public.profiles where role = 'director' and status = 'active') then
    raise exception 'An active Director already exists. Nothing was changed.';
  end if;
  select * into v_user from auth.users where lower(email) = lower(v_email);
  if not found then raise exception 'Create the Auth user for % first (Authentication > Users).', v_email; end if;
  insert into public.profiles(id, full_name, email, role, status, approved_at)
  values (v_user.id, 'Tournament Director', lower(v_email), 'director', 'active', now());
  insert into public.audit_logs(actor_role, action, target_table, target_id, details)
  values ('bootstrap', 'director.bootstrapped', 'profiles', v_user.id::text, jsonb_build_object('email', v_email));
end $$;
