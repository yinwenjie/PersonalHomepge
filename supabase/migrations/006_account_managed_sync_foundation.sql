begin;

-- Phase 1.6.0 foundation for account-managed home spaces.
-- This migration does not change current frontend behavior. Existing claimed
-- spaces remain sync-code spaces and still require a full sync code to activate.

alter table public.home_spaces
  add column if not exists access_mode text;

update public.home_spaces
set access_mode = 'sync-code'
where access_mode is null;

alter table public.home_spaces
  alter column access_mode set default 'sync-code',
  alter column access_mode set not null;

alter table public.home_spaces
  drop constraint if exists home_spaces_access_mode_valid;

alter table public.home_spaces
  add constraint home_spaces_access_mode_valid
  check (access_mode in ('sync-code', 'account-managed', 'password-protected'));

alter table public.home_spaces
  drop constraint if exists home_spaces_id_user_id_unique;

alter table public.home_spaces
  add constraint home_spaces_id_user_id_unique
  unique (id, user_id);

create index if not exists home_spaces_access_mode_idx
  on public.home_spaces(access_mode);

create table if not exists public.home_space_credentials (
  id uuid primary key default extensions.gen_random_uuid(),
  home_space_id uuid not null,
  user_id uuid not null,
  credential_type text not null default 'sync-space-v1',
  access_token text not null,
  encryption_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.home_space_credentials
  drop constraint if exists home_space_credentials_home_space_fk;

alter table public.home_space_credentials
  add constraint home_space_credentials_home_space_fk
  foreign key (home_space_id, user_id)
  references public.home_spaces(id, user_id)
  on delete cascade;

alter table public.home_space_credentials
  drop constraint if exists home_space_credentials_credential_type_valid;

alter table public.home_space_credentials
  add constraint home_space_credentials_credential_type_valid
  check (credential_type in ('sync-space-v1'));

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

create index if not exists home_space_credentials_user_id_idx
  on public.home_space_credentials(user_id);

create index if not exists home_space_credentials_home_space_id_idx
  on public.home_space_credentials(home_space_id);

create unique index if not exists home_space_credentials_one_active_sync_space_v1_idx
  on public.home_space_credentials(home_space_id)
  where revoked_at is null
    and credential_type = 'sync-space-v1';

drop trigger if exists home_space_credentials_set_updated_at on public.home_space_credentials;
create trigger home_space_credentials_set_updated_at
before update on public.home_space_credentials
for each row execute function public.set_updated_at();

alter table public.home_space_credentials enable row level security;

revoke all on table public.home_space_credentials from anon;
revoke all on table public.home_space_credentials from public;
grant select, insert, update on table public.home_space_credentials to authenticated;

drop policy if exists home_spaces_insert_own on public.home_spaces;
create policy home_spaces_insert_own
on public.home_spaces
for insert
to authenticated
with check (
  user_id = auth.uid()
  and access_mode in ('sync-code', 'account-managed')
);

drop policy if exists home_spaces_update_own on public.home_spaces;
create policy home_spaces_update_own
on public.home_spaces
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and access_mode in ('sync-code', 'account-managed')
);

drop policy if exists home_space_credentials_select_own on public.home_space_credentials;
create policy home_space_credentials_select_own
on public.home_space_credentials
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists home_space_credentials_insert_own on public.home_space_credentials;
create policy home_space_credentials_insert_own
on public.home_space_credentials
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.home_spaces hs
    where hs.id = home_space_id
      and hs.user_id = auth.uid()
      and hs.access_mode = 'account-managed'
  )
);

drop policy if exists home_space_credentials_update_own on public.home_space_credentials;
create policy home_space_credentials_update_own
on public.home_space_credentials
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.home_spaces hs
    where hs.id = home_space_id
      and hs.user_id = auth.uid()
      and hs.access_mode = 'account-managed'
  )
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
