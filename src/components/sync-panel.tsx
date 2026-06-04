"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HomeDocumentV2, HomeSyncMeta } from "@/domain/home-document";
import {
  createSyncSecrets,
  formatSyncCode,
  parseSyncCode,
  StoredSyncBinding
} from "@/domain/sync-code";
import { LocalSyncBindingRepository } from "@/infrastructure/sync-binding-repository";
import { SyncCodeRepository, PullSyncSpaceResult } from "@/infrastructure/sync-code-repository";

interface SyncPanelProps {
  documentValue: HomeDocumentV2;
  editorOpen: boolean;
  storageReady: boolean;
  visible: boolean;
  onReplaceDocument: (documentValue: HomeDocumentV2, message: string) => void;
  onSyncMetaChange: (syncMeta: HomeSyncMeta, message: string) => void;
}

const AUTO_PUSH_DEBOUNCE_MS = 1800;
const AUTO_PULL_COOLDOWN_MS = 10000;
const AUTO_PULL_INTERVAL_MS = 60000;

export function SyncPanel({
  documentValue,
  editorOpen,
  storageReady,
  visible,
  onReplaceDocument,
  onSyncMetaChange
}: SyncPanelProps) {
  const [binding, setBinding] = useState<StoredSyncBinding | null>(null);
  const [syncCode, setSyncCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bindingRepositoryRef = useRef<LocalSyncBindingRepository | null>(null);
  const syncRepositoryRef = useRef<SyncCodeRepository | null>(null);
  const bindingRef = useRef<StoredSyncBinding | null>(null);
  const documentRef = useRef(documentValue);
  const busyRef = useRef(false);
  const editorOpenRef = useRef(editorOpen);
  const autoPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoPullAtRef = useRef(0);

  useEffect(() => {
    bindingRef.current = binding;
  }, [binding]);

  useEffect(() => {
    documentRef.current = documentValue;
  }, [documentValue]);

  useEffect(() => {
    editorOpenRef.current = editorOpen;
  }, [editorOpen]);

  const persistBinding = useCallback((nextBinding: StoredSyncBinding): void => {
    bindingRepositoryRef.current?.save(nextBinding);
    bindingRef.current = nextBinding;
    setBinding(nextBinding);
  }, []);

  const setSyncMetaFromBinding = useCallback((nextBinding: StoredSyncBinding, status: HomeSyncMeta["status"], statusMessage: string) => {
    onSyncMetaChange(toSyncMeta(nextBinding, status), statusMessage);
  }, [onSyncMetaChange]);

  const getSyncRepository = useCallback((): SyncCodeRepository => {
    if (!syncRepositoryRef.current) {
      syncRepositoryRef.current = new SyncCodeRepository();
    }

    return syncRepositoryRef.current;
  }, []);

  const runSyncAction = useCallback(async (
    action: () => Promise<void>,
    options: { exposeBusy?: boolean } = {}
  ): Promise<void> => {
    if (busyRef.current) {
      return;
    }

    busyRef.current = true;
    if (options.exposeBusy ?? true) {
      setBusy(true);
    }
    setError("");
    setMessage("");

    try {
      await action();
    } catch (actionError) {
      console.error(actionError);
      const activeBinding = bindingRef.current;
      setError(actionError instanceof Error ? actionError.message : "同步操作失败。");
      if (activeBinding) {
        setSyncMetaFromBinding(activeBinding, isLikelyOfflineError(actionError) ? "offline" : "error", "同步失败");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [setSyncMetaFromBinding]);

  const applyCloudDocument = useCallback((
    pulled: PullSyncSpaceResult,
    activeBinding: StoredSyncBinding,
    statusMessage: string
  ) => {
    const nextBinding: StoredSyncBinding = {
      ...activeBinding,
      remoteRevision: pulled.revision,
      lastSyncedAt: pulled.updatedAt,
      lastSyncedDocumentRevision: pulled.document.revision,
      lastSyncedDocumentUpdatedAt: pulled.document.updatedAt
    };
    persistBinding(nextBinding);
    onReplaceDocument({
      ...pulled.document,
      syncMeta: toSyncMeta(nextBinding, "synced")
    }, statusMessage);
  }, [onReplaceDocument, persistBinding]);

  const performPull = useCallback(async (options: { forceApply: boolean; source: "auto" | "manual" | "resolve" | "startup" }) => {
    const activeBinding = bindingRef.current;
    if (!activeBinding) {
      setError("请先创建或输入同步码。");
      return;
    }

    if (documentRef.current.syncMeta.status === "conflict" && !options.forceApply) {
      setMessage("当前有冲突，请先选择云端版本或本地版本。");
      return;
    }

    await runSyncAction(async () => {
      setSyncMetaFromBinding(activeBinding, "syncing", "正在拉取云端");
      const pulled = await getSyncRepository().pull(activeBinding);
      const localDocument = documentRef.current;
      const hasRemoteChanges = hasRemoteSnapshotChanged(pulled.revision, pulled.updatedAt, activeBinding);
      const hasPendingLocalChanges = hasLocalDocumentChanges(localDocument, activeBinding);
      const shouldApplyConflictCloudVersion = options.forceApply && localDocument.syncMeta.status === "conflict";

      if (!hasRemoteChanges && !shouldApplyConflictCloudVersion) {
        const nextBinding: StoredSyncBinding = {
          ...activeBinding,
          remoteRevision: pulled.revision,
          lastSyncedAt: pulled.updatedAt,
          lastSyncedDocumentRevision: hasPendingLocalChanges
            ? activeBinding.lastSyncedDocumentRevision
            : localDocument.revision,
          lastSyncedDocumentUpdatedAt: hasPendingLocalChanges
            ? activeBinding.lastSyncedDocumentUpdatedAt
            : localDocument.updatedAt
        };
        persistBinding(nextBinding);
        setSyncMetaFromBinding(nextBinding, hasPendingLocalChanges ? "linked" : "synced", hasPendingLocalChanges ? "有本地修改待上传" : "已是最新");
        if (options.source !== "auto") {
          setMessage(hasPendingLocalChanges ? "云端无更新，本地修改待上传。" : "云端无更新。");
        }
        return;
      }

      if (hasPendingLocalChanges && !options.forceApply) {
        const conflictBinding: StoredSyncBinding = {
          ...activeBinding,
          remoteRevision: pulled.revision,
          lastSyncedAt: pulled.updatedAt
        };
        persistBinding(conflictBinding);
        setSyncMetaFromBinding(conflictBinding, "conflict", "云端和本地都有修改");
        setMessage("检测到冲突：云端和本地都有修改。");
        return;
      }

      applyCloudDocument(pulled, activeBinding, options.source === "auto" ? "已自动拉取云端首页" : "已拉取云端首页");
      setMessage(options.source === "auto" ? "已自动拉取云端首页。" : "已拉取云端首页。");
    }, { exposeBusy: options.source !== "auto" });
  }, [applyCloudDocument, getSyncRepository, persistBinding, runSyncAction, setSyncMetaFromBinding]);

  const performAutoRevisionCheck = useCallback(async () => {
    const activeBinding = bindingRef.current;
    if (!activeBinding || busyRef.current || documentRef.current.syncMeta.status === "conflict" || editorOpenRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastAutoPullAtRef.current < AUTO_PULL_COOLDOWN_MS) {
      return;
    }
    lastAutoPullAtRef.current = now;

    let shouldPull = false;
    await runSyncAction(async () => {
      const checked = await getSyncRepository().check(activeBinding);
      shouldPull = hasRemoteSnapshotChanged(checked.revision, checked.updatedAt, activeBinding);
      if (!shouldPull) {
        const nextBinding: StoredSyncBinding = {
          ...activeBinding,
          remoteRevision: checked.revision,
          lastSyncedAt: checked.updatedAt
        };
        const hasPendingLocalChanges = hasLocalDocumentChanges(documentRef.current, nextBinding);
        persistBinding(nextBinding);
        setSyncMetaFromBinding(nextBinding, hasPendingLocalChanges ? "linked" : "synced", hasPendingLocalChanges ? "有本地修改待上传" : "云端无更新");
      }
    }, { exposeBusy: false });

    if (shouldPull && bindingRef.current) {
      await performPull({ forceApply: false, source: "auto" });
    }
  }, [getSyncRepository, performPull, persistBinding, runSyncAction, setSyncMetaFromBinding]);

  const performPush = useCallback(async (options: { force: boolean; source: "auto" | "manual" | "resolve" }) => {
    const activeBinding = bindingRef.current;
    if (!activeBinding) {
      setError("请先创建或输入同步码。");
      return;
    }

    const localDocument = documentRef.current;
    if (localDocument.syncMeta.status === "conflict" && !options.force) {
      setMessage("当前有冲突，请先选择云端版本或本地版本。");
      return;
    }

    if (!options.force && !hasLocalDocumentChanges(localDocument, activeBinding)) {
      setMessage("没有待上传的本地修改。");
      return;
    }

    await runSyncAction(async () => {
      setSyncMetaFromBinding(activeBinding, "syncing", "正在上传本地首页");
      const documentToPush = {
        ...localDocument,
        syncMeta: toSyncMeta(activeBinding, "syncing")
      };

      if (options.force) {
        const result = await getSyncRepository().forcePush(activeBinding, documentToPush);
        const nextBinding: StoredSyncBinding = {
          ...activeBinding,
          remoteRevision: result.revision,
          lastSyncedAt: result.updatedAt,
          lastSyncedDocumentRevision: localDocument.revision,
          lastSyncedDocumentUpdatedAt: localDocument.updatedAt
        };
        persistBinding(nextBinding);
        setSyncMetaFromBinding(nextBinding, "synced", "本地版本已覆盖云端");
        setMessage("本地版本已覆盖云端。");
        return;
      }

      const result = await getSyncRepository().push(activeBinding, documentToPush);
      if (result.status === "conflict") {
        const conflictBinding: StoredSyncBinding = {
          ...activeBinding,
          remoteRevision: result.remoteRevision,
          lastSyncedAt: result.updatedAt
        };
        persistBinding(conflictBinding);
        setSyncMetaFromBinding(conflictBinding, "conflict", "云端已有更新");
        setMessage("检测到冲突：云端已有更新。");
        return;
      }

      const nextBinding: StoredSyncBinding = {
        ...activeBinding,
        remoteRevision: result.revision,
        lastSyncedAt: result.updatedAt,
        lastSyncedDocumentRevision: localDocument.revision,
        lastSyncedDocumentUpdatedAt: localDocument.updatedAt
      };
      persistBinding(nextBinding);
      setSyncMetaFromBinding(nextBinding, "synced", options.source === "auto" ? "已自动上传本地首页" : "已上传本地首页");
      setMessage(options.source === "auto" ? "已自动上传本地首页。" : "已上传本地首页。");
    }, { exposeBusy: options.source !== "auto" });
  }, [getSyncRepository, persistBinding, runSyncAction, setSyncMetaFromBinding]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    bindingRepositoryRef.current = new LocalSyncBindingRepository(window.localStorage);
    syncRepositoryRef.current = new SyncCodeRepository();

    const storedBinding = bindingRepositoryRef.current.load();
    if (!storedBinding) {
      return;
    }

    persistBinding(storedBinding);
    setSyncCode(formatSyncCode(storedBinding));
    setSyncMetaFromBinding(storedBinding, "linked", "已读取本机同步码");
    window.setTimeout(() => {
      performPull({ forceApply: false, source: "startup" });
    }, 0);
  }, [performPull, persistBinding, setSyncMetaFromBinding, storageReady]);

  useEffect(() => {
    function requestAutoPull() {
      if (
        document.visibilityState !== "hidden"
        && bindingRef.current
        && !busyRef.current
        && documentRef.current.syncMeta.status !== "conflict"
      ) {
        performAutoRevisionCheck();
      }
    }

    window.addEventListener("focus", requestAutoPull);
    document.addEventListener("visibilitychange", requestAutoPull);

    const intervalId = window.setInterval(requestAutoPull, AUTO_PULL_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", requestAutoPull);
      document.removeEventListener("visibilitychange", requestAutoPull);
      window.clearInterval(intervalId);
    };
  }, [performAutoRevisionCheck]);

  useEffect(() => {
    const activeBinding = binding;
    if (!activeBinding || documentValue.syncMeta.status === "conflict" || busyRef.current) {
      return;
    }

    if (!hasLocalDocumentChanges(documentValue, activeBinding)) {
      return;
    }

    if (autoPushTimerRef.current) {
      clearTimeout(autoPushTimerRef.current);
    }

    autoPushTimerRef.current = setTimeout(() => {
      performPush({ force: false, source: "auto" });
    }, AUTO_PUSH_DEBOUNCE_MS);

    return () => {
      if (autoPushTimerRef.current) {
        clearTimeout(autoPushTimerRef.current);
      }
    };
  }, [binding, documentValue, performPush]);

  const statusText = useMemo(() => {
    if (!binding) {
      return "未绑定";
    }

    const syncedAt = binding.lastSyncedAt ? formatShortDateTime(binding.lastSyncedAt) : "未同步";
    return `已绑定 rev ${binding.remoteRevision}，最后同步 ${syncedAt}`;
  }, [binding]);

  async function createCode() {
    await runSyncAction(async () => {
      const secrets = createSyncSecrets();
      const result = await getSyncRepository().create(documentRef.current, secrets);
      const nextBinding: StoredSyncBinding = {
        version: 1,
        spaceId: result.spaceId,
        accessToken: secrets.accessToken,
        encryptionKey: secrets.encryptionKey,
        remoteRevision: result.revision,
        lastSyncedAt: result.updatedAt,
        lastSyncedDocumentRevision: documentRef.current.revision,
        lastSyncedDocumentUpdatedAt: documentRef.current.updatedAt
      };

      persistBinding(nextBinding);
      setSyncCode(formatSyncCode(nextBinding));
      setSyncMetaFromBinding(nextBinding, "synced", "同步码已创建");
      setMessage("同步码已创建，请保存到安全位置。");
    });
  }

  async function bindCode() {
    await runSyncAction(async () => {
      const parsed = parseSyncCode(inputCode);
      const pulled = await getSyncRepository().pull(parsed);

      if (!window.confirm("输入同步码会用云端首页覆盖当前本地首页，继续？")) {
        return;
      }

      const nextBinding: StoredSyncBinding = {
        ...parsed,
        remoteRevision: pulled.revision,
        lastSyncedAt: pulled.updatedAt,
        lastSyncedDocumentRevision: pulled.document.revision,
        lastSyncedDocumentUpdatedAt: pulled.document.updatedAt
      };
      persistBinding(nextBinding);
      setSyncCode(formatSyncCode(nextBinding));
      setInputCode("");
      onReplaceDocument({
        ...pulled.document,
        syncMeta: toSyncMeta(nextBinding, "synced")
      }, "已绑定同步码并拉取云端首页");
      setMessage("已绑定同步码。");
    });
  }

  async function copyCode() {
    if (!syncCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(syncCode);
      setMessage("同步码已复制。");
      setError("");
    } catch {
      setError("复制失败，请手动选择同步码。");
    }
  }

  function unbindLocal() {
    if (!window.confirm("解除后，本机不再同步，但云端同步空间不会删除。继续？")) {
      return;
    }

    bindingRepositoryRef.current?.clear();
    bindingRef.current = null;
    setBinding(null);
    setSyncCode("");
    onSyncMetaChange(localSyncMeta(), "已解除本机同步码");
    setMessage("已解除本机绑定。");
    setError("");
  }

  async function revokeCode() {
    const activeBinding = bindingRef.current;
    if (!activeBinding) {
      return;
    }

    if (!window.confirm("废弃后，所有设备都无法继续使用这个同步码。继续？")) {
      return;
    }

    await runSyncAction(async () => {
      await getSyncRepository().revoke(activeBinding);
      bindingRepositoryRef.current?.clear();
      bindingRef.current = null;
      setBinding(null);
      setSyncCode("");
      onSyncMetaChange(localSyncMeta(), "同步码已废弃");
      setMessage("同步码已废弃。");
    });
  }

  if (!visible) {
    return null;
  }

  return (
    <section className="sync-panel" aria-label="同步码">
      <div className="sync-panel-head">
        <div>
          <h2>同步码</h2>
          <p>{statusText}</p>
        </div>
        <div className="sync-panel-actions">
          <button className="utility-button" type="button" onClick={createCode} disabled={busy}>创建</button>
          <button className="utility-button" type="button" onClick={() => performPull({ forceApply: false, source: "manual" })} disabled={busy || !binding}>拉取</button>
          <button className="utility-button" type="button" onClick={() => performPush({ force: false, source: "manual" })} disabled={busy || !binding || documentValue.syncMeta.status === "conflict"}>上传</button>
        </div>
      </div>

      {documentValue.syncMeta.status === "conflict" ? (
        <div className="sync-conflict" role="status">
          <div>
            <strong>云端和本地都有修改</strong>
            <p>自动同步已暂停。请选择保留哪一份数据。</p>
          </div>
          <div className="sync-panel-actions">
            <button className="utility-button" type="button" onClick={() => performPull({ forceApply: true, source: "resolve" })} disabled={busy}>使用云端版本</button>
            <button className="danger-button" type="button" onClick={() => performPush({ force: true, source: "resolve" })} disabled={busy}>本地覆盖云端</button>
            <button className="utility-button" type="button" onClick={() => setMessage("已暂停自动同步，冲突状态会保留。")} disabled={busy}>暂不处理</button>
          </div>
        </div>
      ) : null}

      <div className="sync-code-grid">
        <label className="field">
          <span>当前同步码</span>
          <input value={syncCode} readOnly placeholder="创建后显示，用于其他设备绑定" />
        </label>
        <button className="utility-button" type="button" onClick={copyCode} disabled={!syncCode}>复制</button>
      </div>

      <div className="sync-code-grid">
        <label className="field">
          <span>输入同步码</span>
          <input value={inputCode} onChange={(event) => setInputCode(event.target.value)} placeholder="hp1_..." />
        </label>
        <button className="utility-button" type="button" onClick={bindCode} disabled={busy || !inputCode.trim()}>绑定</button>
      </div>

      <div className="sync-panel-footer">
        <div className="sync-panel-actions">
          <button className="utility-button" type="button" onClick={unbindLocal} disabled={!binding}>解除本机</button>
          <button className="danger-button" type="button" onClick={revokeCode} disabled={busy || !binding}>废弃同步码</button>
        </div>
        <p className={error ? "form-error" : "save-status"}>{error || message}</p>
      </div>
    </section>
  );
}

function toSyncMeta(binding: StoredSyncBinding, status: HomeSyncMeta["status"]): HomeSyncMeta {
  return {
    mode: "sync-code",
    status,
    provider: "supabase",
    spaceId: binding.spaceId,
    remoteRevision: binding.remoteRevision,
    lastSyncedAt: binding.lastSyncedAt
  };
}

function localSyncMeta(): HomeSyncMeta {
  return {
    mode: "local",
    status: "local-only",
    provider: null,
    spaceId: null,
    remoteRevision: null,
    lastSyncedAt: null
  };
}

function formatShortDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function hasRemoteSnapshotChanged(revision: number, updatedAt: string, binding: StoredSyncBinding): boolean {
  return revision !== binding.remoteRevision || updatedAt !== binding.lastSyncedAt;
}

function hasLocalDocumentChanges(documentValue: HomeDocumentV2, binding: StoredSyncBinding): boolean {
  if (!binding.lastSyncedDocumentUpdatedAt) {
    return documentValue.revision !== binding.lastSyncedDocumentRevision;
  }

  return documentValue.revision !== binding.lastSyncedDocumentRevision
    || documentValue.updatedAt !== binding.lastSyncedDocumentUpdatedAt;
}

function isLikelyOfflineError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /fetch|network|offline|failed/i.test(error.message);
}
