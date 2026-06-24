import {
  createId,
  type HomeDocumentV2,
  normalizeHomeDocument
} from "@/domain/home-document";
import {
  createDocumentProtectionState,
  type HomeDocumentClass
} from "@/domain/home-document-protection";

export const LOCAL_HOME_SNAPSHOTS_STORAGE_KEY = "homepage:local-snapshots:v1";
export const LOCAL_HOME_SNAPSHOT_LIMIT = 30;
export const LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT = "homepage:local-snapshots-updated";

const LOCAL_HOME_SNAPSHOT_SCHEMA = "homepage-local-snapshots-v1";

export type LocalHomeSnapshotSource =
  | "before-bookmark-import"
  | "before-bookmark-import-undo"
  | "before-cloud-overwrite"
  | "before-cloud-pull"
  | "before-conflict-cloud-resolve"
  | "before-data-package-restore"
  | "before-home-space-activate"
  | "before-json-import"
  | "before-local-snapshot-restore"
  | "before-managed-home-space-restore"
  | "before-reset-backup-restore"
  | "before-reset-default"
  | "before-sync-code-bind"
  | "before-template-apply"
  | "before-template-home-space-switch";

export interface LocalHomeSnapshotSummary {
  groupCount: number;
  hasBackground: boolean;
  hasBanner: boolean;
  siteCount: number;
  syncStatus: HomeDocumentV2["syncMeta"]["status"];
  themePresetId: HomeDocumentV2["theme"]["presetId"];
  updatedAt: string;
  widgetCount: number;
}

export interface LocalHomeSnapshot {
  id: string;
  contentFingerprint: string;
  createdAt: string;
  document: HomeDocumentV2;
  documentClass: Extract<HomeDocumentClass, "user-data">;
  documentId: string;
  revision: number;
  source: LocalHomeSnapshotSource;
  summary: LocalHomeSnapshotSummary;
}

export type SaveLocalHomeSnapshotResult =
  | { status: "saved"; snapshot: LocalHomeSnapshot }
  | { status: "skipped"; reason: "duplicate" | "system-document"; documentClass: HomeDocumentClass };

interface LocalHomeSnapshotStorageValue {
  schema: typeof LOCAL_HOME_SNAPSHOT_SCHEMA;
  snapshots: LocalHomeSnapshot[];
}

export class LocalHomeSnapshotRepository {
  constructor(private readonly storage: Storage) {}

  load(): LocalHomeSnapshot[] {
    const value = this.read();
    return value?.snapshots ?? [];
  }

  hasSnapshots(): boolean {
    return this.load().length > 0;
  }

  getLatest(): LocalHomeSnapshot | null {
    return this.load()[0] ?? null;
  }

  saveSnapshot(documentValue: HomeDocumentV2, source: LocalHomeSnapshotSource): SaveLocalHomeSnapshotResult {
    const normalized = normalizeHomeDocument(documentValue);
    const protection = createDocumentProtectionState(normalized);

    if (!protection.isUserData) {
      return {
        status: "skipped",
        reason: "system-document",
        documentClass: protection.documentClass
      };
    }

    const existingSnapshots = this.load();
    const latestSnapshot = existingSnapshots[0];
    if (latestSnapshot?.contentFingerprint === protection.contentFingerprint) {
      return {
        status: "skipped",
        reason: "duplicate",
        documentClass: protection.documentClass
      };
    }

    const snapshot: LocalHomeSnapshot = {
      id: createId("snapshot"),
      contentFingerprint: protection.contentFingerprint,
      createdAt: new Date().toISOString(),
      document: normalized,
      documentClass: "user-data",
      documentId: normalized.documentId,
      revision: normalized.revision,
      source,
      summary: summarizeHomeDocument(normalized)
    };
    const nextSnapshots = [snapshot, ...existingSnapshots].slice(0, LOCAL_HOME_SNAPSHOT_LIMIT);

    this.storage.setItem(LOCAL_HOME_SNAPSHOTS_STORAGE_KEY, JSON.stringify({
      schema: LOCAL_HOME_SNAPSHOT_SCHEMA,
      snapshots: nextSnapshots
    } satisfies LocalHomeSnapshotStorageValue));
    notifyLocalHomeSnapshotsUpdated();

    return {
      status: "saved",
      snapshot
    };
  }

  clear(): void {
    this.storage.removeItem(LOCAL_HOME_SNAPSHOTS_STORAGE_KEY);
    notifyLocalHomeSnapshotsUpdated();
  }

  private read(): LocalHomeSnapshotStorageValue | null {
    try {
      const raw = this.storage.getItem(LOCAL_HOME_SNAPSHOTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) as LocalHomeSnapshotStorageValue : null;
      if (!parsed || parsed.schema !== LOCAL_HOME_SNAPSHOT_SCHEMA || !Array.isArray(parsed.snapshots)) {
        return null;
      }

      return {
        schema: LOCAL_HOME_SNAPSHOT_SCHEMA,
        snapshots: parsed.snapshots
          .map(normalizeSnapshot)
          .filter((snapshot): snapshot is LocalHomeSnapshot => Boolean(snapshot))
          .slice(0, LOCAL_HOME_SNAPSHOT_LIMIT)
      };
    } catch {
      return null;
    }
  }
}

function normalizeSnapshot(value: unknown): LocalHomeSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  try {
    const documentValue = normalizeHomeDocument(value.document);
    const protection = createDocumentProtectionState(documentValue);
    if (!protection.isUserData) {
      return null;
    }

    const contentFingerprint = typeof value.contentFingerprint === "string"
      ? value.contentFingerprint
      : protection.contentFingerprint;
    const source = isLocalHomeSnapshotSource(value.source) ? value.source : "before-reset-default";

    return {
      id: typeof value.id === "string" ? value.id : createId("snapshot"),
      contentFingerprint,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      document: documentValue,
      documentClass: "user-data",
      documentId: typeof value.documentId === "string" ? value.documentId : documentValue.documentId,
      revision: typeof value.revision === "number" ? value.revision : documentValue.revision,
      source,
      summary: isSnapshotSummary(value.summary) ? value.summary : summarizeHomeDocument(documentValue)
    };
  } catch {
    return null;
  }
}

function summarizeHomeDocument(documentValue: HomeDocumentV2): LocalHomeSnapshotSummary {
  return {
    groupCount: documentValue.groups.length,
    hasBackground: Boolean(documentValue.theme.backgroundAsset || documentValue.theme.backgroundUrl),
    hasBanner: Boolean(documentValue.theme.bannerAsset || documentValue.theme.bannerUrl),
    siteCount: documentValue.groups.reduce((total, group) => total + group.sites.length, 0),
    syncStatus: documentValue.syncMeta.status,
    themePresetId: documentValue.theme.presetId,
    updatedAt: documentValue.updatedAt,
    widgetCount: documentValue.widgets.length
  };
}

function isLocalHomeSnapshotSource(value: unknown): value is LocalHomeSnapshotSource {
  return value === "before-bookmark-import"
    || value === "before-bookmark-import-undo"
    || value === "before-cloud-overwrite"
    || value === "before-cloud-pull"
    || value === "before-conflict-cloud-resolve"
    || value === "before-data-package-restore"
    || value === "before-home-space-activate"
    || value === "before-json-import"
    || value === "before-local-snapshot-restore"
    || value === "before-managed-home-space-restore"
    || value === "before-reset-backup-restore"
    || value === "before-reset-default"
    || value === "before-sync-code-bind"
    || value === "before-template-apply"
    || value === "before-template-home-space-switch";
}

export function notifyLocalHomeSnapshotsUpdated(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT));
}

function isSnapshotSummary(value: unknown): value is LocalHomeSnapshotSummary {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.groupCount === "number"
    && typeof value.siteCount === "number"
    && typeof value.widgetCount === "number"
    && typeof value.themePresetId === "string"
    && typeof value.hasBanner === "boolean"
    && typeof value.hasBackground === "boolean"
    && typeof value.updatedAt === "string"
    && typeof value.syncStatus === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
