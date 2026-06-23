"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultHomeDocument,
  HomeDocumentV2,
  HomeSyncMeta,
  isDefaultHomeDocumentContent,
  migrateV1ToV2,
  nextRevision,
  normalizeHomeDocument
} from "@/domain/home-document";
import { LocalHomeRepository } from "@/infrastructure/home-repository";
import { recordLocalAuditEvent } from "@/infrastructure/local-audit-log-repository";

interface ResetDefaultOptions {
  confirmMessage?: string;
  syncMeta?: HomeSyncMeta;
  successMessage?: string;
}

export function useHomeDocumentController() {
  const [homeDocument, setHomeDocument] = useState<HomeDocumentV2>(() => createDefaultHomeDocument());
  const [storageReady, setStorageReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [hasStoredDocument, setHasStoredDocument] = useState(false);
  const [hasResetBackup, setHasResetBackup] = useState(false);
  const repositoryRef = useRef<LocalHomeRepository | null>(null);
  const homeDocumentRef = useRef(homeDocument);

  useEffect(() => {
    repositoryRef.current = new LocalHomeRepository(window.localStorage);
    const storedDocumentExists = repositoryRef.current.hasStoredDocument();
    const loadedDocument = repositoryRef.current.load();

    homeDocumentRef.current = loadedDocument;
    setHomeDocument(loadedDocument);
    setHasStoredDocument(storedDocumentExists);
    setHasResetBackup(repositoryRef.current.hasResetBackup());
    setStorageReady(true);
  }, []);

  const isDefaultDocument = useMemo(() => {
    return isDefaultHomeDocumentContent(homeDocument);
  }, [homeDocument]);

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
    try {
      repository.saveResetBackup(currentDocument);
    } catch (error) {
      console.error(error);
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
  }, []);

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

      commitHomeDocument(imported, "已导入");
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
    } catch {
      window.alert("导入失败：JSON 格式不正确。");
    }
  }, [commitHomeDocument]);

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
    if (isDefaultHomeDocumentContent(currentDocument)) {
      setSaveStatus("当前已经是默认首页，未覆盖重置前备份");
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
    recordLocalAuditEvent({
      documentId: currentDocument.documentId,
      level: "warning",
      message: "已清空本地首页并恢复默认。",
      metadata: {
        syncPaused: Boolean(options.syncMeta)
      },
      type: "document.reset_default"
    });
  }, []);

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

    commitHomeDocument(backup, "已恢复上一次重置前页面");
    recordLocalAuditEvent({
      documentId: backup.documentId,
      message: "已恢复上一次重置前页面。",
      type: "document.reset_backup_restored"
    });
  }, [commitHomeDocument]);

  return {
    homeDocument,
    storageReady,
    saveStatus,
    hasStoredDocument,
    hasResetBackup,
    isDefaultDocument,
    commitHomeDocument,
    replaceHomeDocument,
    restoreHomeDocumentWithBackup,
    updateSyncMeta,
    importJson,
    exportJson,
    resetDefault,
    restoreResetBackup
  };
}

function parseImportedDocument(input: unknown): HomeDocumentV2 {
  try {
    return normalizeHomeDocument(input);
  } catch {
    return migrateV1ToV2(input);
  }
}
