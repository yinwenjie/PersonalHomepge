import type { HomeDocumentV2, HomeWidgetType } from "@/domain/home-document";

export const PRODUCT_ANALYTICS_SCHEMA_VERSION = 1;

export const PRODUCT_ANALYTICS_EVENTS = [
  "home.viewed",
  "settings.opened",
  "search.submitted",
  "template.applied",
  "theme.changed",
  "theme_image.changed",
  "widget.added",
  "group.added",
  "site.added",
  "bookmark_import.opened",
  "bookmark_import.parsed",
  "bookmark_import.completed",
  "bookmark_import.failed",
  "data_package.exported",
  "data_package.restore_previewed",
  "data_package.restore_failed",
  "data_package.restored",
  "document.json_exported",
  "document.json_imported",
  "document.json_import_failed",
  "document.reset_default",
  "document.reset_backup_restored",
  "recovery.center_opened",
  "recovery.local_previewed",
  "recovery.local_restored",
  "recovery.cloud_previewed",
  "recovery.cloud_restored",
  "auth.magic_link_requested",
  "auth.magic_link_failed",
  "auth.signed_in",
  "auth.signed_out",
  "sync.code_created",
  "sync.code_bound",
  "sync.pull_applied",
  "sync.push_applied",
  "sync.conflict_detected",
  "sync.resolved_cloud",
  "sync.resolved_local",
  "sync.auto_push_skipped_system_document",
  "home_space.claimed",
  "home_space.sync_code_activated",
  "home_space.account_managed_created",
  "home_space.account_managed_template_created",
  "home_space.account_managed_restored",
  "home_space.sync_code_migrated",
  "home_space.removed",
  "account.preferences_updated",
  "analytics.preference_changed"
] as const;

export type ProductAnalyticsEventName = typeof PRODUCT_ANALYTICS_EVENTS[number];

export type ProductAnalyticsPropertyValue =
  | boolean
  | number
  | string
  | null
  | Array<boolean | number | string | null>;

export type ProductAnalyticsProperties = Partial<Record<ProductAnalyticsPropertyKey, ProductAnalyticsPropertyValue>>;

export const PRODUCT_ANALYTICS_PROPERTY_KEYS = [
  "accessMode",
  "assetSlot",
  "assetSource",
  "cloudHistoryAvailable",
  "documentClass",
  "force",
  "groupCountBucket",
  "hasBanner",
  "hasBackground",
  "hasStoredDocument",
  "hasSyncBinding",
  "reasonCode",
  "result",
  "searchEngine",
  "signedIn",
  "siteCountBucket",
  "source",
  "sourceKind",
  "storageReady",
  "syncStatus",
  "templateId",
  "themePresetId",
  "widgetCountBucket",
  "widgetType"
] as const;

export type ProductAnalyticsPropertyKey = typeof PRODUCT_ANALYTICS_PROPERTY_KEYS[number];

export const PRODUCT_ANALYTICS_FORBIDDEN_KEYS = [
  "accessToken",
  "access_token",
  "authorization",
  "document",
  "documentJson",
  "document_json",
  "email",
  "encryptionKey",
  "encryption_key",
  "groupName",
  "groupTitle",
  "homepage",
  "homeDocument",
  "imageUrl",
  "password",
  "query",
  "refreshToken",
  "refresh_token",
  "searchTerm",
  "secret",
  "session",
  "siteName",
  "syncCode",
  "sync_code",
  "todo",
  "token",
  "url",
  "userEmail",
  "userId"
] as const;

const EVENT_NAME_SET = new Set<string>(PRODUCT_ANALYTICS_EVENTS);
const PROPERTY_KEY_SET = new Set<string>(PRODUCT_ANALYTICS_PROPERTY_KEYS);
const FORBIDDEN_KEY_SET = new Set<string>(PRODUCT_ANALYTICS_FORBIDDEN_KEYS.map((key) => key.toLowerCase()));
const MAX_STRING_LENGTH = 120;
const MAX_ARRAY_LENGTH = 24;

export interface ProductAnalyticsDocumentSummary {
  groupCountBucket: string;
  hasBanner: boolean;
  hasBackground: boolean;
  siteCountBucket: string;
  syncStatus: HomeDocumentV2["syncMeta"]["status"];
  themePresetId: string;
  widgetCountBucket: string;
}

export function isProductAnalyticsEventName(value: string): value is ProductAnalyticsEventName {
  return EVENT_NAME_SET.has(value);
}

export function sanitizeProductAnalyticsProperties(input: Record<string, unknown> = {}): ProductAnalyticsProperties {
  const entries: [ProductAnalyticsPropertyKey, ProductAnalyticsPropertyValue][] = [];

  for (const [key, rawValue] of Object.entries(input).slice(0, 32)) {
    if (!PROPERTY_KEY_SET.has(key) || FORBIDDEN_KEY_SET.has(key.toLowerCase())) {
      continue;
    }

    const sanitized = sanitizePropertyValue(rawValue);
    if (sanitized !== undefined) {
      entries.push([key as ProductAnalyticsPropertyKey, sanitized]);
    }
  }

  return Object.fromEntries(entries) as ProductAnalyticsProperties;
}

export function summarizeDocumentForAnalytics(documentValue: HomeDocumentV2): ProductAnalyticsDocumentSummary {
  const siteCount = documentValue.groups.reduce((sum, group) => sum + group.sites.length, 0);

  return {
    groupCountBucket: bucketCount(documentValue.groups.length),
    hasBanner: Boolean(documentValue.theme.bannerAsset),
    hasBackground: Boolean(documentValue.theme.backgroundAsset),
    siteCountBucket: bucketCount(siteCount),
    syncStatus: documentValue.syncMeta.status,
    themePresetId: documentValue.theme.presetId,
    widgetCountBucket: bucketCount(documentValue.widgets.length)
  };
}

export function bucketCount(value: number): string {
  const count = Math.max(0, Math.trunc(value));

  if (count === 0) {
    return "0";
  }

  if (count === 1) {
    return "1";
  }

  if (count <= 5) {
    return "2-5";
  }

  if (count <= 20) {
    return "6-20";
  }

  if (count <= 100) {
    return "21-100";
  }

  if (count <= 500) {
    return "101-500";
  }

  return "501+";
}

export function isSafeWidgetType(value: unknown): value is HomeWidgetType {
  return value === "calendar.month" || value === "todo.list";
}

function sanitizePropertyValue(value: unknown): ProductAnalyticsPropertyValue | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    return value.slice(0, MAX_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    const values: Array<boolean | number | string | null> = [];

    for (const item of value.slice(0, MAX_ARRAY_LENGTH)) {
      const sanitized = sanitizePropertyValue(item);
      if (sanitized !== undefined && !Array.isArray(sanitized)) {
        values.push(sanitized);
      }
    }

    return values;
  }

  return undefined;
}
