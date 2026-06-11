begin;

-- PostgreSQL regular-expression repetition bounds are intentionally small.
-- Avoid patterns such as {32,512}; validate length and character set separately.

alter table public.home_space_credentials
  drop constraint if exists home_space_credentials_access_token_size;

alter table public.home_space_credentials
  add constraint home_space_credentials_access_token_size
  check (
    char_length(access_token) between 32 and 512
    and access_token ~ '^[A-Za-z0-9_-]+$'
  );

alter table public.home_space_credentials
  drop constraint if exists home_space_credentials_encryption_key_size;

alter table public.home_space_credentials
  add constraint home_space_credentials_encryption_key_size
  check (
    char_length(encryption_key) between 32 and 512
    and encryption_key ~ '^[A-Za-z0-9_-]+$'
  );

create or replace function public.create_account_managed_home_space(
  p_name text,
  p_access_token text,
  p_encryption_key text,
  p_document_ciphertext text,
  p_document_iv text,
  p_document_salt text,
  p_document_schema_version integer default 2
)
returns table (
  home_space_id uuid,
  sync_space_id uuid,
  revision integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_home_space_id uuid;
  v_sync_space_id uuid;
  v_revision integer;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'Invalid home space name' using errcode = '22023';
  end if;

  perform public.assert_sync_payload(
    p_access_token,
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  );

  if p_access_token is null
    or char_length(p_access_token) < 32
    or char_length(p_access_token) > 512
    or p_access_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid managed access token' using errcode = '22023';
  end if;

  if p_encryption_key is null
    or char_length(p_encryption_key) < 32
    or char_length(p_encryption_key) > 512
    or p_encryption_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid managed encryption key' using errcode = '22023';
  end if;

  insert into public.sync_spaces (
    access_token_hash,
    document_ciphertext,
    document_iv,
    document_salt,
    document_schema_version
  )
  values (
    public.hash_sync_access_token(p_access_token),
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  )
  returning id, sync_spaces.revision, sync_spaces.updated_at
  into v_sync_space_id, v_revision, v_updated_at;

  insert into public.home_spaces (
    user_id,
    sync_space_id,
    name,
    access_mode
  )
  values (
    v_user_id,
    v_sync_space_id,
    v_name,
    'account-managed'
  )
  returning id
  into v_home_space_id;

  insert into public.home_space_credentials (
    home_space_id,
    user_id,
    credential_type,
    access_token,
    encryption_key
  )
  values (
    v_home_space_id,
    v_user_id,
    'sync-space-v1',
    p_access_token,
    p_encryption_key
  );

  home_space_id := v_home_space_id;
  sync_space_id := v_sync_space_id;
  revision := v_revision;
  updated_at := v_updated_at;
  return next;
end;
$$;

revoke all on function public.create_account_managed_home_space(text, text, text, text, text, text, integer) from public;
revoke all on function public.create_account_managed_home_space(text, text, text, text, text, text, integer) from anon;
grant execute on function public.create_account_managed_home_space(text, text, text, text, text, text, integer) to authenticated;

commit;
