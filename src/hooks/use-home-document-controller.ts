"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultHomeDocument,
  HomeDocumentV2,
  HomeSyncMeta,
  migrateV1ToV2,
  nextRevision,
  normalizeHomeDocument
} from "@/domain/home-document";
import {
  classifyHomeDocument,
  createDocumentProtectionState,
  type HomeDocumentClass
} from "@/domain/home-document-protection";
import { summarizeDocumentForAnalytics } from "@/domain/product-analytics";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";
import { LocalHomeRepository } from "@/infrastructure/home-repository";
import type { CloudHomeSnapshot } from "@/infrastructure/cloud-home-snapshot-repository";
import { recordLocalAuditEvent } from "@/infrastructure/local-audit-log-repository";
import {
  LocalHomeSnapshotRepository,
  notifyLocalHomeSnapshotsUpdated,
  type LocalHomeSnapshot,
  type LocalHomeSnapshotSource
} from "@/infrastructure/local-home-snapshot-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

interface ResetDefaultOptions {
  confirmMessage?: string;
  syncMeta?: HomeSyncMeta;
  successMessage?: string;
}

interface RestoreLocalSnapshotOptions {
  successMessage?: string;
  syncMeta: HomeSyncMeta;
}

interface RestoreCloudSnapshotOptions {
  successMessage?: string;
  syncMeta: HomeSyncMeta;
}

export type DangerousOverwriteProtectionResult =
  | { canContinue: true; status: "saved"; snapshot: LocalHomeSnapshot }
  | { canContinue: true; status: "skipped"; reason: "duplicate" | "system-document"; documentClass: HomeDocumentClass }
  | { canContinue: false; status: "failed"; error: unknown };

export function useHomeDocumentController() {
  const [homeDocument, setHomeDocument] = useState<HomeDocumentV2>(() => createDefaultHomeDocument());
  const [storageReady, setStorageReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [hasStoredDocument, setHasStoredDocument] = useState(false);
  const [hasResetBackup, setHasResetBackup] = useState(false);
  const repositoryRef = useRef<LocalHomeRepository | null>(null);
  const snapshotRepositoryRef = useRef<LocalHomeSnapshotRepository | null>(null);
  const homeDocumentRef = useRef(homeDocument);

  useEffect(() => {
    repositoryRef.current = new LocalHomeRepository(window.localStorage);
    snapshotRepositoryRef.current = new LocalHomeSnapshotRepository(window.localStorage);
    const storedDocumentExists = repositoryRef.current.hasStoredDocument();
    const loadedDocument = repositoryRef.current.load();

    homeDocumentRef.current = loadedDocument;
    setHomeDocument(loadedDocument);
    setHasStoredDocument(storedDocumentExists);
    setHasResetBackup(repositoryRef.current.hasResetBackup());
    setStorageReady(true);
  }, []);

  const documentProtection = useMemo(() => {
    return createDocumentProtectionState(homeDocument);
  }, [homeDocument]);
  const isDefaultDocument = documentProtection.documentClass === "system-default";

  const protectDocumentBeforeDangerousOverwrite = useCallback((
    documentValue: HomeDocumentV2,
    source: LocalHomeSnapshotSource
  ): DangerousOverwriteProtectionResult => {
    const protectedDocument = normalizeHomeDocument(documentValue);
    const protection = createDocumentProtectionState(protectedDocument);

    if (!protection.isUserData) {
      recordLocalAuditEvent({
        documentId: protectedDocument.documentId,
        message: "目标首页属于系统态，未生成本地历史版本。",
        metadata: {
          documentClass: protection.documentClass,
          source
        },
        spaceId: protectedDocument.syncMeta.spaceId,
        type: "local_snapshot.skipped_system_document"
      });
      return {
        canContinue: true,
        status: "skipped",
        reason: "system-document",
        documentClass: protection.documentClass
      };
    }

    const snapshotRepository = snapshotRepositoryRef.current;
    if (!snapshotRepository) {
      const error = new Error("Local snapshot repository is not ready.");
      recordSnapshotFailure(protectedDocument, source, error);
      setSaveStatus("未能保存当前首页，已取消覆盖操作");
      return {
        canContinue: false,
        status: "failed",
        error
      };
    }

    try {
      const result = snapshotRepository.saveSnapshot(protectedDocument, source);
      if (result.status === "saved") {
        recordLocalAuditEvent({
          documentId: protectedDocument.documentId,
          message: "已保存本地历史版本。",
          metadata: {
            groupCount: result.snapshot.summary.groupCount,
            revision: result.snapshot.revision,
            siteCount: result.snapshot.summary.siteCount,
            snapshotId: result.snapshot.id,
            source,
            widgetCount: result.snapshot.summary.widgetCount
          },
          spaceId: protectedDocument.syncMeta.spaceId,
          type: "local_snapshot.created"
        });
        return {
          canContinue: true,
          status: "saved",
          snapshot: result.snapshot
        };
      }

      return {
        canContinue: true,
        status: "skipped",
        reason: result.reason,
        documentClass: result.documentClass
      };
    } catch (error) {
      console.warn("Failed to save local home snapshot:", error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "snapshot.local_save",
        properties: {
          documentClass: protection.documentClass,
          source
        },
        severity: "error"
      });
      recordSnapshotFailure(protectedDocument, source, error);
      setSaveStatus("未能保存当前首页，已取消覆盖操作");
      return {
        canContinue: false,
        status: "failed",
        error
      };
    }
  }, []);

  const protectBeforeDangerousOverwrite = useCallback((source: LocalHomeSnapshotSource): DangerousOverwriteProtectionResult => {
    return protectDocumentBeforeDangerousOverwrite(homeDocumentRef.current, source);
  }, [protectDocumentBeforeDangerousOverwrite]);

  const commitHomeDocument = useCallback((nextDocument: HomeDocumentV2, message = "已保存") => {
    const normalized = normalizeHomeDocument({
      ...nextDocument,
      revision: nextRevision(nextDocument.revision),
      updatedAt: new Date().toISOString()
    });

    repositoryRef.current?.save(normalized);
    homeDocumentRef.current = normalized;
    setHomeDocument(normalized);
    setHasStoredDocument(true);
    setSaveStatus(message);
  }, []);

  const replaceHomeDocument = useCallback((nextDocument: HomeDocumentV2, message: string) => {
    const normalized = normalizeHomeDocument(nextDocument);

    repositoryRef.current?.save(normalized);
    homeDocumentRef.current = normalized;
    setHomeDocument(normalized);
    setHasStoredDocument(true);
    setSaveStatus(message);
  }, []);

  const restoreHomeDocumentWithBackup = useCallback((nextDocument: HomeDocumentV2, message: string): boolean => {
    const repository = repositoryRef.current;
    if (!repository) {
      window.alert("本地存储尚未就绪，请稍后重试。");
      return false;
    }

    const currentDocument = homeDocumentRef.current;
    if (!protectBeforeDangerousOverwrite("before-data-package-restore").canContinue) {
      window.alert("未能保存当前首页，已取消覆盖操作。");
      return false;
    }

    try {
      repository.saveResetBackup(currentDocument);
    } catch (error) {
      console.error(error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "data_package.restore_backup",
        properties: {
          documentClass: classifyHomeDocument(currentDocument).documentClass,
          source: "home-document-controller"
        },
        severity: "error"
      });
      window.alert("恢复前备份失败，已取消导入。");
      recordLocalAuditEvent({
        documentId: currentDocument.documentId,
        level: "danger",
        message: "数据恢复前备份失败，恢复已取消。",
        type: "data_package.restore_backup_failed"
      });
      return false;
    }

    const normalized = normalizeHomeDocument({
      ...nextDocument,
      revision: nextRevision(currentDocument.revision),
      updatedAt: new Date().toISOString()
    });

    repository.save(normalized);
    homeDocumentRef.current = normalized;
    setHomeDocument(normalized);
    setHasStoredDocument(true);
    setHasResetBackup(true);
    setSaveStatus(message);
    return true;
  }, [protectBeforeDangerousOverwrite]);

  const updateSyncMeta = useCallback((syncMeta: HomeSyncMeta, message: string) => {
    setHomeDocument((currentDocument) => {
      const normalized = normalizeHomeDocument({
        ...currentDocument,
        syncMeta
      });

      repositoryRef.current?.save(normalized);
      homeDocumentRef.current = normalized;
      setHasStoredDocument(true);
      return normalized;
    });
    setSaveStatus(message);
  }, []);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(homeDocument, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `homepage-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    trackProductEvent("document.json_exported", summarizeDocumentForAnalytics(homeDocument));
  }, [homeDocument]);

  const importJson = useCallback(async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const imported = parseImportedDocument(parsed);

      if (!window.confirm("导入会覆盖当前本地首页，继续？")) {
        return;
      }

      if (!protectBeforeDangerousOverwrite("before-json-import").canContinue) {
        window.alert("未能保存当前首页，已取消覆盖操作。");
        return;
      }

      commitHomeDocument(imported, "已导入");
      trackProductEvent("document.json_imported", summarizeDocumentForAnalytics(imported));
      recordLocalAuditEvent({
        documentId: imported.documentId,
        message: "已通过 JSON 导入覆盖本地首页。",
        metadata: {
          groupCount: imported.groups.length,
          siteCount: imported.groups.reduce((total, group) => total + group.sites.length, 0),
          widgetCount: imported.widgets.length
        },
        type: "document.json_import"
      });
    } catch (error) {
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "document.json_import",
        properties: {
          reasonCode: "invalid-json",
          source: "home-document-controller"
        },
        severity: "warning"
      });
      trackProductEvent("document.json_import_failed", {
        reasonCode: "invalid-json"
      });
      window.alert("导入失败：JSON 格式不正确。");
    }
  }, [commitHomeDocument, protectBeforeDangerousOverwrite]);

  const resetDefault = useCallback((options: ResetDefaultOptions = {}) => {
    if (!window.confirm(options.confirmMessage ?? "清空内容并恢复默认会覆盖当前浏览器中的首页。重置前会自动保存一份本地备份，继续？")) {
      return;
    }

    const repository = repositoryRef.current;
    if (!repository) {
      window.alert("本地存储尚未就绪，请稍后重试。");
      return;
    }

    const currentDocument = homeDocumentRef.current;
    if (classifyHomeDocument(currentDocument).documentClass === "system-default") {
      setSaveStatus("当前已经是默认首页，未覆盖重置前备份");
      return;
    }

    if (!protectBeforeDangerousOverwrite("before-reset-default").canContinue) {
      window.alert("未能保存当前首页，已取消覆盖操作。");
      return;
    }

    try {
      repository.saveResetBackup(currentDocument);
      recordLocalAuditEvent({
        documentId: currentDocument.documentId,
        message: "恢复默认前已保存本地备份。",
        type: "document.reset_backup_saved"
      });
    } catch (error) {
      console.error(error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "document.reset_backup_save",
        properties: {
          documentClass: classifyHomeDocument(currentDocument).documentClass,
          source: "home-document-controller"
        },
        severity: "error"
      });
      window.alert("重置前备份失败，已取消恢复默认。");
      recordLocalAuditEvent({
        documentId: currentDocument.documentId,
        level: "danger",
        message: "恢复默认前备份失败，恢复默认已取消。",
        type: "document.reset_backup_failed"
      });
      return;
    }

    const defaultDocument = normalizeHomeDocument({
      ...createDefaultHomeDocument(),
      revision: nextRevision(currentDocument.revision),
      updatedAt: new Date().toISOString(),
      syncMeta: options.syncMeta ?? createDefaultHomeDocument().syncMeta
    });

    if (options.syncMeta) {
      repository.save(defaultDocument);
    } else {
      repository.reset();
    }

    homeDocumentRef.current = defaultDocument;
    setHasResetBackup(true);
    setHomeDocument(defaultDocument);
    setHasStoredDocument(Boolean(options.syncMeta));
    setSaveStatus(options.successMessage ?? "已清空内容并恢复默认，重置前页面已备份");
    trackProductEvent("document.reset_default", {
      hasSyncBinding: Boolean(options.syncMeta)
    });
    recordLocalAuditEvent({
      documentId: currentDocument.documentId,
      level: "warning",
      message: "已清空本地首页并恢复默认。",
      metadata: {
        syncPaused: Boolean(options.syncMeta)
      },
      type: "document.reset_default"
    });
  }, [protectBeforeDangerousOverwrite]);

  const restoreResetBackup = useCallback(() => {
    if (!window.confirm("恢复备份会覆盖当前本地首页，继续？")) {
      return;
    }

    const repository = repositoryRef.current;
    const backup = repository?.loadResetBackup();
    if (!backup) {
      repository?.clearResetBackup();
      setHasResetBackup(false);
      window.alert("没有可恢复的重置前备份。");
      return;
    }

    if (!protectBeforeDangerousOverwrite("before-reset-backup-restore").canContinue) {
      window.alert("未能保存当前首页，已取消覆盖操作。");
      return;
    }

    commitHomeDocument(backup, "已恢复上一次重置前页面");
    trackProductEvent("document.reset_backup_restored", summarizeDocumentForAnalytics(backup));
    recordLocalAuditEvent({
      documentId: backup.documentId,
      message: "已恢复上一次重置前页面。",
      type: "document.reset_backup_restored"
    });
  }, [commitHomeDocument, protectBeforeDangerousOverwrite]);

  const restoreLocalSnapshot = useCallback((
    snapshot: LocalHomeSnapshot,
    options: RestoreLocalSnapshotOptions
  ): boolean => {
    const repository = repositoryRef.current;
    if (!repository) {
      window.alert("本地存储尚未就绪，请稍后重试。");
      return false;
    }

    const currentDocument = homeDocumentRef.current;
    try {
      if (!protectBeforeDangerousOverwrite("before-local-snapshot-restore").canContinue) {
        return false;
      }

      const normalized = normalizeHomeDocument({
        ...snapshot.document,
        revision: nextRevision(currentDocument.revision),
        updatedAt: new Date().toISOString(),
        syncMeta: options.syncMeta
      });

      repository.save(normalized);
      homeDocumentRef.current = normalized;
      setHomeDocument(normalized);
      setHasStoredDocument(true);
      setSaveStatus(options.successMessage ?? "已恢复本地历史版本");
      notifyLocalHomeSnapshotsUpdated();
      recordLocalAuditEvent({
        documentId: normalized.documentId,
        message: "已恢复本地历史版本。",
        metadata: {
          groupCount: snapshot.summary.groupCount,
          originalRevision: snapshot.revision,
          nextRevision: normalized.revision,
          siteCount: snapshot.summary.siteCount,
          snapshotId: snapshot.id,
          snapshotSource: snapshot.source,
          syncPaused: options.syncMeta.status === "paused",
          widgetCount: snapshot.summary.widgetCount
        },
        spaceId: options.syncMeta.spaceId,
        type: "local_snapshot.restored"
      });
      return true;
    } catch (error) {
      console.error(error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "snapshot.local_restore",
        properties: {
          source: "home-document-controller"
        },
        severity: "error"
      });
      setSaveStatus("本地历史版本恢复失败");
      recordLocalAuditEvent({
        documentId: currentDocument.documentId,
        level: "danger",
        message: "本地历史版本恢复失败。",
        metadata: {
          reason: error instanceof Error ? error.message : "unknown",
          snapshotId: snapshot.id,
          snapshotSource: snapshot.source
        },
        spaceId: currentDocument.syncMeta.spaceId,
        type: "local_snapshot.restore_failed"
      });
      window.alert("本地历史版本恢复失败，请稍后重试。");
      return false;
    }
  }, [protectBeforeDangerousOverwrite]);

  const restoreCloudSnapshot = useCallback((
    snapshot: CloudHomeSnapshot,
    options: RestoreCloudSnapshotOptions
  ): boolean => {
    const repository = repositoryRef.current;
    if (!repository) {
      window.alert("本地存储尚未就绪，请稍后重试。");
      return false;
    }

    const currentDocument = homeDocumentRef.current;
    try {
      if (!protectBeforeDangerousOverwrite("before-cloud-snapshot-restore").canContinue) {
        return false;
      }

      const normalized = normalizeHomeDocument({
        ...snapshot.document,
        revision: nextRevision(currentDocument.revision),
        updatedAt: new Date().toISOString(),
        syncMeta: options.syncMeta
      });

      repository.save(normalized);
      homeDocumentRef.current = normalized;
      setHomeDocument(normalized);
      setHasStoredDocument(true);
      setSaveStatus(options.successMessage ?? "已恢复云端历史版本");
      notifyLocalHomeSnapshotsUpdated();
      recordLocalAuditEvent({
        documentId: normalized.documentId,
        message: "已恢复云端历史版本到本机。",
        metadata: {
          cloudRevision: snapshot.revision,
          groupCount: snapshot.summary.groupCount,
          nextRevision: normalized.revision,
          siteCount: snapshot.summary.siteCount,
          snapshotId: snapshot.id,
          snapshotSource: snapshot.source,
          syncPaused: options.syncMeta.status === "paused",
          widgetCount: snapshot.summary.widgetCount
        },
        spaceId: options.syncMeta.spaceId,
        type: "cloud_snapshot.restored_to_local"
      });
      return true;
    } catch (error) {
      console.error(error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "snapshot.cloud_restore",
        properties: {
          source: "home-document-controller"
        },
        severity: "error"
      });
      setSaveStatus("云端历史版本恢复失败");
      recordLocalAuditEvent({
        documentId: currentDocument.documentId,
        level: "danger",
        message: "云端历史版本恢复失败。",
        metadata: {
          reason: error instanceof Error ? error.message : "unknown",
          snapshotId: snapshot.id,
          snapshotSource: snapshot.source
        },
        spaceId: currentDocument.syncMeta.spaceId,
        type: "cloud_snapshot.restore_failed"
      });
      window.alert("云端历史版本恢复失败，请稍后重试。");
      return false;
    }
  }, [protectBeforeDangerousOverwrite]);

  return {
    homeDocument,
    storageReady,
    saveStatus,
    hasStoredDocument,
    hasResetBackup,
    isDefaultDocument,
    documentProtection,
    commitHomeDocument,
    protectBeforeDangerousOverwrite,
    protectDocumentBeforeDangerousOverwrite,
    replaceHomeDocument,
    restoreHomeDocumentWithBackup,
    updateSyncMeta,
    importJson,
    exportJson,
    resetDefault,
    restoreResetBackup,
    restoreLocalSnapshot,
    restoreCloudSnapshot
  };
}

function parseImportedDocument(input: unknown): HomeDocumentV2 {
  try {
    return normalizeHomeDocument(input);
  } catch {
    return migrateV1ToV2(input);
  }
}

function recordSnapshotFailure(
  documentValue: HomeDocumentV2,
  source: LocalHomeSnapshotSource,
  error: unknown
): void {
  recordLocalAuditEvent({
    documentId: documentValue.documentId,
    level: "danger",
    message: "本地历史版本保存失败，覆盖操作已取消。",
    metadata: {
      reason: error instanceof Error ? error.message : "unknown",
      source
    },
    spaceId: documentValue.syncMeta.spaceId,
    type: "local_snapshot.failed"
  });
}
