begin;

select plan(9);

select has_function(
  'public',
  'admin_find_auth_user_ids_by_email',
  array['text'],
  'Auth email lookup function should exist'
);

select ok(
  (
    select prosecdef
    from pg_proc
    where oid = 'public.admin_find_auth_user_ids_by_email(text)'::regprocedure
  ),
  'Auth email lookup should be security definer'
);

select ok(
  (
    select proconfig @> array['search_path=""']
    from pg_proc
    where oid = 'public.admin_find_auth_user_ids_by_email(text)'::regprocedure
  ),
  'Auth email lookup should pin an empty search_path'
);

select is(
  (
    select string_agg(grantee, ', ' order by grantee)
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name = 'admin_find_auth_user_ids_by_email'
      and privilege_type = 'EXECUTE'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ),
  'service_role',
  'only service_role should be able to execute the Auth email lookup'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000001191',
    'authenticated',
    'authenticated',
    'phase-1-18-lookup-a@example.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000001192',
    'authenticated',
    'authenticated',
    'phase-1-18-lookup-b@example.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

-- B claims A's address in its editable profile; the lookup must ignore it.
update public.profiles
set email = 'phase-1-18-lookup-a@example.invalid'
where id = '00000000-0000-0000-0000-000000001192';

set local role service_role;

select results_eq(
  $$select user_id from public.admin_find_auth_user_ids_by_email('phase-1-18-lookup-a@example.invalid')$$,
  $$values ('00000000-0000-0000-0000-000000001191'::uuid)$$,
  'lookup should return only the Auth owner of the email'
);

select is_empty(
  $$select user_id from public.admin_find_auth_user_ids_by_email('Phase-1-18-Lookup-A@example.invalid')$$,
  'lookup should require the caller to normalize the email first'
);

select is_empty(
  $$select user_id from public.admin_find_auth_user_ids_by_email('%@example.invalid')$$,
  'lookup should not treat the input as a pattern'
);

reset role;

set local role authenticated;

select throws_ok(
  $$select * from public.admin_find_auth_user_ids_by_email('phase-1-18-lookup-a@example.invalid')$$,
  '42501',
  null,
  'authenticated users should not be able to call the Auth email lookup'
);

reset role;

set local role anon;

select throws_ok(
  $$select * from public.admin_find_auth_user_ids_by_email('phase-1-18-lookup-a@example.invalid')$$,
  '42501',
  null,
  'anon should not be able to call the Auth email lookup'
);

reset role;

select * from finish();

rollback;
