import {
  DATA_EXPORT_SCHEMA,
  type HomepageDataExportV1
} from "@/domain/data-export";
import {
  type HomeDocumentV2,
  migrateV1ToV2,
  normalizeHomeDocument
} from "@/domain/home-document";

export type HomepageDataRestoreSource = "data-package-v1" | "home-document-v2" | "legacy-home-document-v1";

export interface HomepageDataRestorePreview {
  exportedAt: string | null;
  groupCount: number;
  hasBackground: boolean;
  hasBanner: boolean;
  source: HomepageDataRestoreSource;
  siteCount: number;
  syncMode: HomeDocumentV2["syncMeta"]["mode"];
  syncStatus: HomeDocumentV2["syncMeta"]["status"];
  themePresetId: HomeDocumentV2["theme"]["presetId"];
  updatedAt: string;
  widgetCount: number;
}

export interface ParsedHomepageDataRestore {
  documentValue: HomeDocumentV2;
  ignoredSections: string[];
  preview: HomepageDataRestorePreview;
}

const FORBIDDEN_RESTORE_KEYS = new Set([
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

export function parseHomepageDataRestore(input: unknown): ParsedHomepageDataRestore {
  assertNoForbiddenRestoreKeys(input);

  const dataPackageDocument = parseDataPackage(input);
  if (dataPackageDocument) {
    return dataPackageDocument;
  }

  const v2Document = parseHomeDocumentV2(input);
  if (v2Document) {
    return v2Document;
  }

  const legacyDocument = parseLegacyHomeDocument(input);
  if (legacyDocument) {
    return legacyDocument;
  }

  throw new Error("无法识别的数据包格式。请选择首页数据包、HomeDocumentV2 JSON 或旧版首页 JSON。");
}

function parseDataPackage(input: unknown): ParsedHomepageDataRestore | null {
  if (!isRecord(input) || input.schema !== DATA_EXPORT_SCHEMA) {
    return null;
  }

  const packageValue = input as Partial<HomepageDataExportV1>;
  if (!isRecord(packageValue.local) || !("homeDocument" in packageValue.local)) {
    throw new Error("数据包缺少 local.homeDocument，无法恢复首页内容。");
  }

  const documentValue = normalizeHomeDocument(packageValue.local.homeDocument);
  const ignoredSections = [
    packageValue.account ? "account" : "",
    packageValue.local.currentBinding ? "local.currentBinding" : "",
    packageValue.diagnostics ? "diagnostics" : ""
  ].filter(Boolean);

  return {
    documentValue,
    ignoredSections,
    preview: buildRestorePreview(documentValue, "data-package-v1", normalizeOptionalDate(packageValue.exportedAt))
  };
}

function parseHomeDocumentV2(input: unknown): ParsedHomepageDataRestore | null {
  try {
    const documentValue = normalizeHomeDocument(input);
    return {
      documentValue,
      ignoredSections: [],
      preview: buildRestorePreview(documentValue, "home-document-v2", null)
    };
  } catch {
    return null;
  }
}

function parseLegacyHomeDocument(input: unknown): ParsedHomepageDataRestore | null {
  try {
    const documentValue = migrateV1ToV2(input);
    return {
      documentValue,
      ignoredSections: [],
      preview: buildRestorePreview(documentValue, "legacy-home-document-v1", null)
    };
  } catch {
    return null;
  }
}

function buildRestorePreview(
  documentValue: HomeDocumentV2,
  source: HomepageDataRestoreSource,
  exportedAt: string | null
): HomepageDataRestorePreview {
  return {
    exportedAt,
    groupCount: documentValue.groups.length,
    hasBackground: Boolean(documentValue.theme.backgroundAsset || documentValue.theme.backgroundUrl),
    hasBanner: Boolean(documentValue.theme.bannerAsset || documentValue.theme.bannerUrl),
    source,
    siteCount: documentValue.groups.reduce((total, group) => total + group.sites.length, 0),
    syncMode: documentValue.syncMeta.mode,
    syncStatus: documentValue.syncMeta.status,
    themePresetId: documentValue.theme.presetId,
    updatedAt: documentValue.updatedAt,
    widgetCount: documentValue.widgets.length
  };
}

function assertNoForbiddenRestoreKeys(input: unknown): void {
  const stack: unknown[] = [input];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (FORBIDDEN_RESTORE_KEYS.has(key)) {
        throw new Error(`数据包包含不能恢复的敏感字段：${key}`);
      }

      stack.push(value);
    }
  }
}

function normalizeOptionalDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
