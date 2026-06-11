begin;

-- Remove invalid historical defaults before tightening RLS checks.
update public.account_preferences ap
set default_space_id = null
where ap.default_space_id is not null
  and not exists (
    select 1
    from public.home_spaces hs
    where hs.id = ap.default_space_id
      and hs.user_id = ap.user_id
  );

-- Keep home_spaces.is_default aligned with account_preferences.default_space_id.
update public.home_spaces
set is_default = false
where is_default;

update public.home_spaces hs
set is_default = true
from public.account_preferences ap
where ap.default_space_id = hs.id
  and ap.user_id = hs.user_id;

drop policy if exists account_preferences_insert_own on public.account_preferences;
create policy account_preferences_insert_own
on public.account_preferences
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    default_space_id is null
    or exists (
      select 1
      from public.home_spaces hs
      where hs.id = default_space_id
        and hs.user_id = auth.uid()
    )
  )
);

drop policy if exists account_preferences_update_own on public.account_preferences;
create policy account_preferences_update_own
on public.account_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (
    default_space_id is null
    or exists (
      select 1
      from public.home_spaces hs
      where hs.id = default_space_id
        and hs.user_id = auth.uid()
    )
  )
);

create or replace function public.activate_home_space(p_home_space_id uuid)
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
  set
    is_default = true,
    last_used_at = now()
  where id = v_home_space_id
    and user_id = v_user_id;

  insert into public.account_preferences (user_id, default_space_id)
  values (v_user_id, v_home_space_id)
  on conflict (user_id) do update
  set default_space_id = excluded.default_space_id;
end;
$$;

revoke all on function public.activate_home_space(uuid) from public;
revoke all on function public.activate_home_space(uuid) from anon;
grant execute on function public.activate_home_space(uuid) to authenticated;

commit;
