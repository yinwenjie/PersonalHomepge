create or replace function public.next_sync_revision(p_current integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when p_current is null or p_current < 0 then 0
    when p_current >= 140 then 0
    else p_current + 1
  end;
$$;

revoke all on function public.next_sync_revision(integer) from public;

alter table public.sync_spaces
  drop constraint if exists sync_spaces_revision_positive;

alter table public.sync_spaces
  drop constraint if exists sync_spaces_revision_range;

update public.sync_spaces
set revision = 0
where revision < 0 or revision > 140;

alter table public.sync_spaces
  add constraint sync_spaces_revision_range check (revision between 0 and 140);

create or replace function public.check_sync_space_revision(
  p_space_id uuid,
  p_access_token text
)
returns table (
  revision integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    sync_spaces.revision,
    sync_spaces.updated_at
  from public.sync_spaces
  where id = p_space_id
    and access_token_hash = public.hash_sync_access_token(p_access_token)
    and revoked_at is null
    and (expires_at is null or expires_at > now());

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
    revision = public.next_sync_revision(sync_spaces.revision),
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
    revision = public.next_sync_revision(sync_spaces.revision),
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

revoke all on function public.check_sync_space_revision(uuid, text) from public;
grant execute on function public.check_sync_space_revision(uuid, text) to anon, authenticated;
grant execute on function public.push_sync_space(uuid, text, integer, text, text, text, integer) to anon, authenticated;
grant execute on function public.force_push_sync_space(uuid, text, text, text, text, integer) to anon, authenticated;
