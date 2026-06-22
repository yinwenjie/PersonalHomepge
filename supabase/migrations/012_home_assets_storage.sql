begin;

-- Phase 1.8.1: private Storage bucket policies for homepage images.
-- The bucket may already be created from the Supabase Dashboard. This script
-- keeps the bucket configuration reproducible and constrains browser uploads
-- to image assets under the authenticated user's own top-level folder.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'home-assets',
  'home-assets',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "home assets insert own folder" on storage.objects;
drop policy if exists "home assets read own folder" on storage.objects;
drop policy if exists "home assets update own folder" on storage.objects;
drop policy if exists "home assets delete own folder" on storage.objects;

create policy "home assets insert own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'home-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('banner', 'background')
);

create policy "home assets read own folder"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'home-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('banner', 'background')
);

create policy "home assets update own folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'home-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('banner', 'background')
)
with check (
  bucket_id = 'home-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('banner', 'background')
);

create policy "home assets delete own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'home-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] in ('banner', 'background')
);

commit;
