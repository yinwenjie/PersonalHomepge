begin;

-- Phase 1.18.5: read one account-managed snapshot document for admin-read preview-snapshot.
-- The snapshot must belong to the given user and space, and the space must be
-- account-managed; anything else returns no row. A document larger than p_max_bytes
-- (capped at 2 MiB) is not returned, only its size, so the Edge Function never loads it.
-- admin-read projects the document into AdminSnapshotPreviewDocument; the raw JSON never
-- reaches a browser. Only the service role may call this.

create or replace function public.admin_read_snapshot_document(
  p_user_id uuid,
  p_home_space_id uuid,
  p_snapshot_id uuid,
  p_max_bytes integer
)
returns table (
  id uuid,
  revision integer,
  snapshot_source text,
  created_at timestamptz,
  document_bytes integer,
  document_json jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.revision,
    s.snapshot_source,
    s.created_at,
    size.bytes,
    case
      when size.bytes <= least(greatest(coalesce(p_max_bytes, 0), 0), 2097152)
        then s.document_json
    end
  from public.home_space_snapshots as s
  join public.home_spaces as h
    on h.id = s.home_space_id
    and h.user_id = s.user_id
  cross join lateral (select octet_length(s.document_json::text) as bytes) as size
  where s.id = p_snapshot_id
    and s.user_id = p_user_id
    and s.home_space_id = p_home_space_id
    and h.access_mode = 'account-managed';
$$;

revoke all on function public.admin_read_snapshot_document(uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_read_snapshot_document(uuid, uuid, uuid, integer)
  to service_role;

commit;
