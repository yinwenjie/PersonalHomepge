begin;

-- Phase 1.6.3: migrate a claimed sync-code home space into account-managed mode.
-- This does not revoke the underlying sync_space. The existing sync code remains valid.

create or replace function public.migrate_sync_code_home_space_to_account_managed(
  p_home_space_id uuid,
  p_access_token text,
  p_encryption_key text
)
returns table (
  status text,
  home_space_id uuid,
  sync_space_id uuid,
  access_mode text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_home_space public.home_spaces%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_access_token is null
    or char_length(p_access_token) < 32
    or char_length(p_access_token) > 512
    or p_access_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid sync access token' using errcode = '22023';
  end if;

  if p_encryption_key is null
    or char_length(p_encryption_key) < 32
    or char_length(p_encryption_key) > 512
    or p_encryption_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid sync encryption key' using errcode = '22023';
  end if;

  select *
  into v_home_space
  from public.home_spaces hs
  where hs.id = p_home_space_id
    and hs.user_id = v_user_id
  for update;

  if v_home_space.id is null then
    raise exception 'Home space not found for current account' using errcode = '28000';
  end if;

  if v_home_space.access_mode not in ('sync-code', 'account-managed') then
    raise exception 'Home space cannot be migrated to account-managed mode' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.sync_spaces ss
    where ss.id = v_home_space.sync_space_id
      and ss.access_token_hash = public.hash_sync_access_token(p_access_token)
      and ss.revoked_at is null
      and (ss.expires_at is null or ss.expires_at > now())
  ) then
    raise exception 'Sync space not found or token invalid' using errcode = '28000';
  end if;

  if v_home_space.access_mode = 'sync-code' then
    update public.home_spaces
    set access_mode = 'account-managed'
    where id = v_home_space.id
      and user_id = v_user_id
    returning *
    into v_home_space;

    status := 'migrated';
  else
    status := 'already-managed';
  end if;

  update public.home_space_credentials hsc
  set
    access_token = p_access_token,
    encryption_key = p_encryption_key,
    revoked_at = null
  where hsc.home_space_id = v_home_space.id
    and hsc.user_id = v_user_id
    and hsc.credential_type = 'sync-space-v1'
    and hsc.revoked_at is null;

  if not found then
    insert into public.home_space_credentials (
      home_space_id,
      user_id,
      credential_type,
      access_token,
      encryption_key
    )
    values (
      v_home_space.id,
      v_user_id,
      'sync-space-v1',
      p_access_token,
      p_encryption_key
    );
  end if;

  home_space_id := v_home_space.id;
  sync_space_id := v_home_space.sync_space_id;
  access_mode := 'account-managed';
  updated_at := v_home_space.updated_at;
  return next;
end;
$$;

revoke all on function public.migrate_sync_code_home_space_to_account_managed(uuid, text, text) from public;
revoke all on function public.migrate_sync_code_home_space_to_account_managed(uuid, text, text) from anon;
grant execute on function public.migrate_sync_code_home_space_to_account_managed(uuid, text, text) to authenticated;

commit;
