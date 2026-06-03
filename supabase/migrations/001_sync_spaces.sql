create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.sync_spaces (
  id uuid primary key default extensions.gen_random_uuid(),
  access_token_hash text not null,
  document_ciphertext text not null,
  document_iv text not null,
  document_salt text not null,
  document_schema_version integer not null default 2,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_pulled_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint sync_spaces_revision_positive check (revision >= 1),
  constraint sync_spaces_document_schema_version_positive check (document_schema_version >= 1),
  constraint sync_spaces_ciphertext_size check (char_length(document_ciphertext) between 1 and 350000),
  constraint sync_spaces_iv_size check (char_length(document_iv) between 8 and 256),
  constraint sync_spaces_salt_size check (char_length(document_salt) between 8 and 256)
);

create index if not exists sync_spaces_updated_at_idx on public.sync_spaces(updated_at);
create index if not exists sync_spaces_expires_at_idx on public.sync_spaces(expires_at) where expires_at is not null;

alter table public.sync_spaces enable row level security;

revoke all on table public.sync_spaces from anon;
revoke all on table public.sync_spaces from authenticated;
revoke all on table public.sync_spaces from public;

create or replace function public.hash_sync_access_token(p_access_token text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select encode(extensions.digest(('homepage-sync-v1:' || coalesce(p_access_token, ''))::text, 'sha256'::text), 'hex');
$$;

revoke all on function public.hash_sync_access_token(text) from public;

create or replace function public.assert_sync_payload(
  p_access_token text,
  p_document_ciphertext text,
  p_document_iv text,
  p_document_salt text,
  p_document_schema_version integer
)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_access_token is null or char_length(p_access_token) < 32 or char_length(p_access_token) > 512 then
    raise exception 'Invalid sync token' using errcode = '22023';
  end if;

  if p_document_ciphertext is null or char_length(p_document_ciphertext) < 1 or char_length(p_document_ciphertext) > 350000 then
    raise exception 'Invalid sync document size' using errcode = '22023';
  end if;

  if p_document_iv is null or char_length(p_document_iv) < 8 or char_length(p_document_iv) > 256 then
    raise exception 'Invalid sync iv' using errcode = '22023';
  end if;

  if p_document_salt is null or char_length(p_document_salt) < 8 or char_length(p_document_salt) > 256 then
    raise exception 'Invalid sync salt' using errcode = '22023';
  end if;

  if p_document_schema_version is null or p_document_schema_version < 1 then
    raise exception 'Invalid document schema version' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.assert_sync_payload(text, text, text, text, integer) from public;

create or replace function public.create_sync_space(
  p_access_token text,
  p_document_ciphertext text,
  p_document_iv text,
  p_document_salt text,
  p_document_schema_version integer default 2
)
returns table (
  space_id uuid,
  revision integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_sync_payload(
    p_access_token,
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  );

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
  into space_id, revision, updated_at;

  return next;
end;
$$;

create or replace function public.pull_sync_space(
  p_space_id uuid,
  p_access_token text
)
returns table (
  document_ciphertext text,
  document_iv text,
  document_salt text,
  document_schema_version integer,
  revision integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.sync_spaces
  set last_pulled_at = now()
  where id = p_space_id
    and access_token_hash = public.hash_sync_access_token(p_access_token)
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  returning
    sync_spaces.document_ciphertext,
    sync_spaces.document_iv,
    sync_spaces.document_salt,
    sync_spaces.document_schema_version,
    sync_spaces.revision,
    sync_spaces.updated_at;

  if not found then
    raise exception 'Sync space not found or token invalid' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.push_sync_space(
  p_space_id uuid,
  p_access_token text,
  p_base_revision integer,
  p_document_ciphertext text,
  p_document_iv text,
  p_document_salt text,
  p_document_schema_version integer default 2
)
returns table (
  status text,
  revision integer,
  remote_revision integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_revision integer;
begin
  perform public.assert_sync_payload(
    p_access_token,
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  );

  select sync_spaces.revision
  into v_current_revision
  from public.sync_spaces
  where id = p_space_id
    and access_token_hash = public.hash_sync_access_token(p_access_token)
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    raise exception 'Sync space not found or token invalid' using errcode = '28000';
  end if;

  if p_base_revision is null or p_base_revision <> v_current_revision then
    status := 'conflict';
    revision := v_current_revision;
    remote_revision := v_current_revision;
    updated_at := (
      select sync_spaces.updated_at
      from public.sync_spaces
      where id = p_space_id
    );
    return next;
    return;
  end if;

  update public.sync_spaces
  set
    document_ciphertext = p_document_ciphertext,
    document_iv = p_document_iv,
    document_salt = p_document_salt,
    document_schema_version = p_document_schema_version,
    revision = sync_spaces.revision + 1,
    updated_at = now()
  where id = p_space_id
  returning 'ok', sync_spaces.revision, sync_spaces.revision, sync_spaces.updated_at
  into status, revision, remote_revision, updated_at;

  return next;
end;
$$;

create or replace function public.force_push_sync_space(
  p_space_id uuid,
  p_access_token text,
  p_document_ciphertext text,
  p_document_iv text,
  p_document_salt text,
  p_document_schema_version integer default 2
)
returns table (
  status text,
  revision integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_sync_payload(
    p_access_token,
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  );

  update public.sync_spaces
  set
    document_ciphertext = p_document_ciphertext,
    document_iv = p_document_iv,
    document_salt = p_document_salt,
    document_schema_version = p_document_schema_version,
    revision = sync_spaces.revision + 1,
    updated_at = now()
  where id = p_space_id
    and access_token_hash = public.hash_sync_access_token(p_access_token)
    and revoked_at is null
    and (expires_at is null or expires_at > now())
  returning 'ok', sync_spaces.revision, sync_spaces.updated_at
  into status, revision, updated_at;

  if not found then
    raise exception 'Sync space not found or token invalid' using errcode = '28000';
  end if;

  return next;
end;
$$;

create or replace function public.revoke_sync_space(
  p_space_id uuid,
  p_access_token text
)
returns table (
  status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sync_spaces
  set revoked_at = coalesce(revoked_at, now())
  where id = p_space_id
    and access_token_hash = public.hash_sync_access_token(p_access_token)
    and revoked_at is null
  returning 'revoked'
  into status;

  if not found then
    raise exception 'Sync space not found or token invalid' using errcode = '28000';
  end if;

  return next;
end;
$$;

grant execute on function public.create_sync_space(text, text, text, text, integer) to anon, authenticated;
grant execute on function public.pull_sync_space(uuid, text) to anon, authenticated;
grant execute on function public.push_sync_space(uuid, text, integer, text, text, text, integer) to anon, authenticated;
grant execute on function public.force_push_sync_space(uuid, text, text, text, text, integer) to anon, authenticated;
grant execute on function public.revoke_sync_space(uuid, text) to anon, authenticated;
