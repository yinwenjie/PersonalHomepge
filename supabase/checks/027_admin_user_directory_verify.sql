-- Verify the admin-read user directory and statistics readers.
-- Run after supabase/migrations/025_admin_user_directory.sql.
--
-- Writes only synthetic fixtures inside a transaction that always rolls back.
-- Any unexpected result raises, so the deploy runner fails. Prints no user data.

begin;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.admin_mask_email(text)',
    'public.admin_list_users(timestamptz, uuid, integer)',
    'public.admin_read_stats()'
  ] loop
    if to_regprocedure(v_function) is null then
      raise exception '% is missing; is migration 025 applied?', v_function;
    end if;
    if has_function_privilege('anon', v_function, 'execute')
      or has_function_privilege('authenticated', v_function, 'execute') then
      raise exception 'anon or authenticated can execute %', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception 'service_role cannot execute %', v_function;
    end if;
  end loop;

  if not (select bool_and(prosecdef) from pg_proc where oid in (
    'public.admin_list_users(timestamptz, uuid, integer)'::regprocedure,
    'public.admin_read_stats()'::regprocedure
  )) then
    raise exception 'the user directory readers must be security definer';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_audit_events'::regclass
      and conname = 'admin_audit_events_action_valid'
      and pg_get_constraintdef(oid) like '%admin.user.list%'
      and pg_get_constraintdef(oid) like '%admin.stats.read%'
  ) then
    raise exception 'admin_audit_events does not accept admin.user.list and admin.stats.read';
  end if;
end;
$$;

-- Created in the far future so they are the first rows of the first page.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous, deleted_at
)
values
  ('00000000-0000-0000-0000-000000002701', 'authenticated', 'authenticated',
   'phase-1-18-directory-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb,
   '2999-01-03T00:00:00Z', now(), false, null),
  ('00000000-0000-0000-0000-000000002702', 'authenticated', 'authenticated',
   'phase-1-18-directory-b@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb,
   '2999-01-02T00:00:00Z', now(), false, null),
  ('00000000-0000-0000-0000-000000002703', 'authenticated', 'authenticated',
   'phase-1-18-directory-deleted@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb,
   '2999-01-04T00:00:00Z', now(), false, now());

insert into public.sync_spaces (id, access_token_hash, document_ciphertext, document_iv, document_salt)
values ('00000000-0000-0000-0000-000000002711', repeat('h', 64), 'ciphertext', 'iv-iv-iv', 'salt-salt');

insert into public.home_spaces (id, user_id, sync_space_id, name, access_mode)
values ('00000000-0000-0000-0000-000000002721', '00000000-0000-0000-0000-000000002701',
  '00000000-0000-0000-0000-000000002711', 'Managed', 'account-managed');

set local role service_role;

do $$
declare
  v_ids text[];
  v_masked text;
  v_spaces integer;
  v_stats jsonb;
begin
  select array_agg(id::text order by created_at desc, id desc) into v_ids
  from public.admin_list_users(null, null, 2);
  if v_ids is distinct from array[
    '00000000-0000-0000-0000-000000002701', '00000000-0000-0000-0000-000000002702'
  ] then
    raise exception 'the first page does not start with the fixture users, or lists a soft-deleted user';
  end if;

  select masked_email, account_managed_space_count into v_masked, v_spaces
  from public.admin_list_users(null, null, 2)
  where id = '00000000-0000-0000-0000-000000002701';
  if v_masked is distinct from 'p***@example.invalid' or v_spaces is distinct from 1 then
    raise exception 'a listed user is not masked or its space count is wrong';
  end if;

  if (select count(*) from public.admin_list_users(null, null, 500)) > 51 then
    raise exception 'a user page is larger than 51 rows';
  end if;

  if exists (
    select 1 from public.admin_list_users('2999-01-03T00:00:00Z', '00000000-0000-0000-0000-000000002701', 51)
    where position('***@' in coalesce(masked_email, '***@')) <> 2
      and masked_email is not null
  ) then
    raise exception 'a listed email left the database unmasked';
  end if;

  v_stats := public.admin_read_stats();
  if jsonb_typeof(v_stats -> 'users' -> 'total') <> 'number'
    or (v_stats -> 'users' ->> 'total')::integer < 2
    or jsonb_array_length(v_stats -> 'daily') <> 30 then
    raise exception 'statistics are missing counts or the 30-day series';
  end if;
end;
$$;

reset role;

select 'admin user directory readers verified' as result;

rollback;
