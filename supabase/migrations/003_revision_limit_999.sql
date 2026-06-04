create or replace function public.next_sync_revision(p_current integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when p_current is null or p_current < 0 then 0
    when p_current >= 999 then 0
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
where revision < 0 or revision > 999;

alter table public.sync_spaces
  add constraint sync_spaces_revision_range check (revision between 0 and 999);
