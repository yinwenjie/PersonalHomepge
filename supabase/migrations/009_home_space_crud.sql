begin;

-- Phase 1.6.4: account home-space CRUD helpers.
-- These RPCs manage only account-side home space metadata. They do not delete,
-- revoke, or mutate the underlying sync_spaces rows.

create or replace function public.rename_home_space(
  p_home_space_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'Invalid home space name' using errcode = '22023';
  end if;

  update public.home_spaces
  set name = v_name
  where id = p_home_space_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Home space not found for current account' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.set_default_home_space(p_home_space_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_home_space_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select hs.id
  into v_home_space_id
  from public.home_spaces hs
  where hs.id = p_home_space_id
    and hs.user_id = v_user_id;

  if v_home_space_id is null then
    raise exception 'Home space not found for current account' using errcode = '28000';
  end if;

  update public.home_spaces
  set is_default = false
  where user_id = v_user_id
    and is_default;

  update public.home_spaces
  set is_default = true
  where id = v_home_space_id
    and user_id = v_user_id;

  insert into public.account_preferences (user_id, default_space_id)
  values (v_user_id, v_home_space_id)
  on conflict (user_id) do update
  set default_space_id = excluded.default_space_id;
end;
$$;

create or replace function public.remove_home_space_from_account(p_home_space_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  delete from public.home_spaces
  where id = p_home_space_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Home space not found for current account' using errcode = '28000';
  end if;
end;
$$;

revoke all on function public.rename_home_space(uuid, text) from public;
revoke all on function public.rename_home_space(uuid, text) from anon;
grant execute on function public.rename_home_space(uuid, text) to authenticated;

revoke all on function public.set_default_home_space(uuid) from public;
revoke all on function public.set_default_home_space(uuid) from anon;
grant execute on function public.set_default_home_space(uuid) to authenticated;

revoke all on function public.remove_home_space_from_account(uuid) from public;
revoke all on function public.remove_home_space_from_account(uuid) from anon;
grant execute on function public.remove_home_space_from_account(uuid) to authenticated;

commit;
