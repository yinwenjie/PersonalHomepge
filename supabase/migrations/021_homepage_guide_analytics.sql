begin;

-- Set-as-homepage guide analytics: three new event names and the browserFamily property.
-- Both functions only widen their allowlists, so existing rows still satisfy the
-- check constraints that call them.

create or replace function public.product_analytics_event_allowed(p_event_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_event_name in (
    'home.viewed',
    'settings.opened',
    'search.submitted',
    'template.applied',
    'theme.changed',
    'theme_image.changed',
    'widget.added',
    'group.added',
    'site.added',
    'bookmark_import.opened',
    'bookmark_import.parsed',
    'bookmark_import.completed',
    'bookmark_import.failed',
    'data_package.exported',
    'data_package.restore_previewed',
    'data_package.restore_failed',
    'data_package.restored',
    'document.json_exported',
    'document.json_imported',
    'document.json_import_failed',
    'document.reset_default',
    'document.reset_backup_restored',
    'recovery.center_opened',
    'recovery.local_previewed',
    'recovery.local_restored',
    'recovery.cloud_previewed',
    'recovery.cloud_restored',
    'auth.magic_link_requested',
    'auth.magic_link_failed',
    'auth.signed_in',
    'auth.signed_out',
    'sync.code_created',
    'sync.code_bound',
    'sync.pull_applied',
    'sync.push_applied',
    'sync.conflict_detected',
    'sync.resolved_cloud',
    'sync.resolved_local',
    'sync.auto_push_skipped_system_document',
    'home_space.claimed',
    'home_space.sync_code_activated',
    'home_space.account_managed_created',
    'home_space.account_managed_template_created',
    'home_space.account_managed_restored',
    'home_space.sync_code_migrated',
    'home_space.removed',
    'account.preferences_updated',
    'analytics.preference_changed',
    'homepage_guide.opened',
    'homepage_guide.address_copied',
    'homepage_guide.tip_dismissed'
  );
$$;

revoke all on function public.product_analytics_event_allowed(text) from public, anon, authenticated;

create or replace function public.product_analytics_properties_allowed(p_properties jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
  v_child jsonb;
  v_type text;
begin
  if p_properties is null or jsonb_typeof(p_properties) <> 'object' then
    return false;
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_properties) loop
    if v_key not in (
      'accessMode',
      'assetSlot',
      'assetSource',
      'browserFamily',
      'cloudHistoryAvailable',
      'documentClass',
      'force',
      'groupCountBucket',
      'hasBanner',
      'hasBackground',
      'hasStoredDocument',
      'hasSyncBinding',
      'reasonCode',
      'result',
      'searchEngine',
      'signedIn',
      'siteCountBucket',
      'source',
      'sourceKind',
      'storageReady',
      'syncStatus',
      'templateId',
      'themePresetId',
      'widgetCountBucket',
      'widgetType'
    ) then
      return false;
    end if;

    v_type := jsonb_typeof(v_value);
    if v_type not in ('string', 'number', 'boolean', 'null', 'array') then
      return false;
    end if;

    if v_type = 'array' then
      if jsonb_array_length(v_value) > 24 then
        return false;
      end if;

      for v_child in select value from jsonb_array_elements(v_value) loop
        if jsonb_typeof(v_child) not in ('string', 'number', 'boolean', 'null') then
          return false;
        end if;
      end loop;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.product_analytics_properties_allowed(jsonb) from public, anon, authenticated;

commit;
