create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locale text not null default 'zh-CN',
  theme_preference text not null default 'system',
  default_space_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_preferences_locale_not_empty check (char_length(trim(locale)) between 2 and 32),
  constraint account_preferences_theme_preference_not_empty check (char_length(trim(theme_preference)) between 1 and 64)
);

create table if not exists public.home_spaces (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sync_space_id uuid not null references public.sync_spaces(id) on delete restrict,
  name text not null,
  is_default boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_spaces_name_not_empty check (char_length(trim(name)) between 1 and 80),
  constraint home_spaces_user_sync_space_unique unique (user_id, sync_space_id)
);

alter table public.account_preferences
  drop constraint if exists account_preferences_default_space_fk;

alter table public.account_preferences
  add constraint account_preferences_default_space_fk
  foreign key (default_space_id)
  references public.home_spaces(id)
  on delete set null;

create index if not exists home_spaces_user_id_idx on public.home_spaces(user_id);
create index if not exists home_spaces_sync_space_id_idx on public.home_spaces(sync_space_id);
create index if not exists home_spaces_last_used_at_idx on public.home_spaces(last_used_at desc);
create unique index if not exists home_spaces_one_default_per_user_idx
  on public.home_spaces(user_id)
  where is_default;
create index if not exists account_preferences_default_space_id_idx on public.account_preferences(default_space_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists account_preferences_set_updated_at on public.account_preferences;
create trigger account_preferences_set_updated_at
before update on public.account_preferences
for each row execute function public.set_updated_at();

drop trigger if exists home_spaces_set_updated_at on public.home_spaces;
create trigger home_spaces_set_updated_at
before update on public.home_spaces
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.account_preferences enable row level security;
alter table public.home_spaces enable row level security;

revoke all on table public.profiles from anon;
revoke all on table public.account_preferences from anon;
revoke all on table public.home_spaces from anon;
revoke all on table public.profiles from public;
revoke all on table public.account_preferences from public;
revoke all on table public.home_spaces from public;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update on table public.account_preferences to authenticated;
grant select, insert, update, delete on table public.home_spaces to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists account_preferences_select_own on public.account_preferences;
create policy account_preferences_select_own
on public.account_preferences
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists account_preferences_insert_own on public.account_preferences;
create policy account_preferences_insert_own
on public.account_preferences
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists account_preferences_update_own on public.account_preferences;
create policy account_preferences_update_own
on public.account_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists home_spaces_select_own on public.home_spaces;
create policy home_spaces_select_own
on public.home_spaces
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists home_spaces_insert_own on public.home_spaces;
create policy home_spaces_insert_own
on public.home_spaces
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists home_spaces_update_own on public.home_spaces;
create policy home_spaces_update_own
on public.home_spaces
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists home_spaces_delete_own on public.home_spaces;
create policy home_spaces_delete_own
on public.home_spaces
for delete
to authenticated
using (user_id = auth.uid());
