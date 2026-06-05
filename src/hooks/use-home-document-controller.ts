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
import { LocalHomeRepository } from "@/infrastructure/home-repository";

export function useHomeDocumentController() {
  const [homeDocument, setHomeDocument] = useState<HomeDocumentV2>(() => createDefaultHomeDocument());
  const [storageReady, setStorageReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [hasStoredDocument, setHasStoredDocument] = useState(false);
  const repositoryRef = useRef<LocalHomeRepository | null>(null);

  useEffect(() => {
    repositoryRef.current = new LocalHomeRepository(window.localStorage);
    const storedDocumentExists = repositoryRef.current.hasStoredDocument();

    setHomeDocument(repositoryRef.current.load());
    setHasStoredDocument(storedDocumentExists);
    setStorageReady(true);
  }, []);

  const updatedLabel = useMemo(() => {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(homeDocument.updatedAt));
  }, [homeDocument.updatedAt]);

  const commitHomeDocument = useCallback((nextDocument: HomeDocumentV2, message = "已保存") => {
    const normalized = normalizeHomeDocument({
      ...nextDocument,
      revision: nextRevision(nextDocument.revision),
      updatedAt: new Date().toISOString()
    });

    repositoryRef.current?.save(normalized);
    setHomeDocument(normalized);
    setHasStoredDocument(true);
    setSaveStatus(message);
  }, []);

  const replaceHomeDocument = useCallback((nextDocument: HomeDocumentV2, message: string) => {
    const normalized = normalizeHomeDocument(nextDocument);

    repositoryRef.current?.save(normalized);
    setHomeDocument(normalized);
    setHasStoredDocument(true);
    setSaveStatus(message);
  }, []);

  const updateSyncMeta = useCallback((syncMeta: HomeSyncMeta, message: string) => {
    setHomeDocument((currentDocument) => {
      const normalized = normalizeHomeDocument({
        ...currentDocument,
        syncMeta
      });

      repositoryRef.current?.save(normalized);
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
    } catch {
      window.alert("导入失败：JSON 格式不正确。");
    }
  }, [commitHomeDocument]);

  const resetDefault = useCallback(() => {
    if (!window.confirm("恢复默认会清除当前浏览器中的本地编辑，继续？")) {
      return;
    }

    repositoryRef.current?.reset();
    setHomeDocument(createDefaultHomeDocument());
    setHasStoredDocument(false);
    setSaveStatus("已恢复默认");
  }, []);

  return {
    homeDocument,
    storageReady,
    saveStatus,
    updatedLabel,
    hasStoredDocument,
    commitHomeDocument,
    replaceHomeDocument,
    updateSyncMeta,
    importJson,
    exportJson,
    resetDefault
  };
}

function parseImportedDocument(input: unknown): HomeDocumentV2 {
  try {
    return normalizeHomeDocument(input);
  } catch {
    return migrateV1ToV2(input);
  }
}
