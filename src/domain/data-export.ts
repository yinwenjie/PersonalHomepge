import type { AccountPreferences, AccountProfile, HomeSpace } from "@/domain/account";
import type { HomeDocumentV2 } from "@/domain/home-document";
import type { StoredSyncBinding } from "@/domain/sync-code";
import type { LocalAuditEvent } from "@/infrastructure/local-audit-log-repository";
import type { LocalDeviceRecord } from "@/infrastructure/local-device-repository";

export const DATA_EXPORT_SCHEMA = "homepage-data-export-v1";

const FORBIDDEN_EXPORT_KEYS = new Set([
  "accessToken",
  "access_token",
  "encryptionKey",
  "encryption_key",
  "syncCode",
  "sync_code",
  "session",
  "refreshToken",
  "refresh_token"
]);

export interface DataExportAccountInput {
  error: string;
  homeSpaces: HomeSpace[];
  loading: boolean;
  profile: AccountProfile | null;
  preferences: AccountPreferences | null;
  signedIn: boolean;
  userEmail: string | null;
  userId: string | null;
}

export interface DataExportLocalInput {
  auditEvents?: LocalAuditEvent[];
  currentBinding: StoredSyncBinding | null;
  device?: LocalDeviceRecord | null;
  hasResetBackup: boolean;
  hasStoredDocument: boolean;
  homeDocument: HomeDocumentV2;
  storageReady: boolean;
}

export interface BuildHomepageDataExportInput {
  account: DataExportAccountInput;
  local: DataExportLocalInput;
}

export interface HomepageDataExportV1 {
  account: {
    error: string | null;
    homeSpaces: HomeSpace[];
    loading: boolean;
    preferences: AccountPreferences | null;
    profile: Pick<AccountProfile, "id" | "email" | "displayName" | "createdAt" | "updatedAt"> | null;
    signedIn: boolean;
    userEmail: string | null;
    userId: string | null;
  };
  app: {
    documentVersion: HomeDocumentV2["version"];
    phase: "1.11.6";
  };
  diagnostics: {
    browserLanguage: string | null;
    excludedServerData: string[];
    generatedFrom: "browser";
    redactedFields: string[];
    storageReady: boolean;
    syncStatus: HomeDocumentV2["syncMeta"]["status"];
    timeZone: string | null;
  };
  exportedAt: string;
  local: {
    auditEvents: LocalAuditEvent[];
    currentBinding: SafeSyncBindingSummary | null;
    device: LocalDeviceRecord | null;
    hasResetBackup: boolean;
    hasStoredDocument: boolean;
    homeDocument: HomeDocumentV2;
  };
  schema: typeof DATA_EXPORT_SCHEMA;
}

export interface SafeSyncBindingSummary {
  accessMode: StoredSyncBinding["accessMode"];
  lastSyncedAt: string | null;
  lastSyncedDocumentRevision: number;
  lastSyncedDocumentUpdatedAt: string | null;
  remoteRevision: number;
  spaceId: string;
  version: StoredSyncBinding["version"];
}

export function buildHomepageDataExportV1(input: BuildHomepageDataExportInput): HomepageDataExportV1 {
  const exportValue: HomepageDataExportV1 = {
    schema: DATA_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    app: {
      phase: "1.11.6",
      documentVersion: input.local.homeDocument.version
    },
    account: {
      signedIn: input.account.signedIn,
      loading: input.account.loading,
      error: input.account.error || null,
      userId: input.account.signedIn ? input.account.userId : null,
      userEmail: input.account.signedIn ? input.account.userEmail : null,
      profile: input.account.profile ? sanitizeProfile(input.account.profile) : null,
      preferences: input.account.preferences,
      homeSpaces: input.account.homeSpaces
    },
    local: {
      auditEvents: input.local.auditEvents ?? [],
      homeDocument: input.local.homeDocument,
      hasStoredDocument: input.local.hasStoredDocument,
      hasResetBackup: input.local.hasResetBackup,
      currentBinding: sanitizeSyncBinding(input.local.currentBinding),
      device: input.local.device ?? null
    },
    diagnostics: {
      generatedFrom: "browser",
      storageReady: input.local.storageReady,
      syncStatus: input.local.homeDocument.syncMeta.status,
      browserLanguage: getBrowserLanguage(),
      timeZone: getTimeZone(),
      excludedServerData: [
        "home_space_snapshots.document_json",
        "home_space_audit_events",
        "Supabase auth session"
      ],
      redactedFields: [
        "StoredSyncBinding.accessToken",
        "StoredSyncBinding.encryptionKey",
        "home_space_credentials.access_token",
        "home_space_credentials.encryption_key",
        "home_space_snapshots.document_json",
        "Supabase session"
      ]
    }
  };

  assertSystemExportHasNoForbiddenKeys(exportValue);
  return exportValue;
}

export function downloadJsonFile(value: unknown, filenamePrefix: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sanitizeProfile(profile: AccountProfile): HomepageDataExportV1["account"]["profile"] {
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

function sanitizeSyncBinding(binding: StoredSyncBinding | null): SafeSyncBindingSummary | null {
  if (!binding) {
    return null;
  }

  return {
    version: binding.version,
    accessMode: binding.accessMode,
    spaceId: binding.spaceId,
    remoteRevision: binding.remoteRevision,
    lastSyncedAt: binding.lastSyncedAt,
    lastSyncedDocumentRevision: binding.lastSyncedDocumentRevision,
    lastSyncedDocumentUpdatedAt: binding.lastSyncedDocumentUpdatedAt
  };
}

function assertSystemExportHasNoForbiddenKeys(value: HomepageDataExportV1): void {
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    for (const [key, childValue] of Object.entries(current)) {
      if (FORBIDDEN_EXPORT_KEYS.has(key)) {
        throw new Error(`数据导出包含禁止字段：${key}`);
      }

      if (key === "homeDocument") {
        continue;
      }

      stack.push(childValue);
    }
  }
}

function getBrowserLanguage(): string | null {
  return typeof navigator === "undefined" ? null : navigator.language || null;
}

function getTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
