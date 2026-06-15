"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomeSpace } from "@/domain/account";
import { getErrorMessage } from "@/domain/errors";
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
  presentation?: "primary" | "advanced";
  storageReady: boolean;
  visible: boolean;
  onReplaceDocument: (documentValue: HomeDocumentV2, message: string) => void;
  onSyncMetaChange: (syncMeta: HomeSyncMeta, message: string) => void;
  onBindingChange?: (binding: StoredSyncBinding | null) => void;
  hasResetBackup?: boolean;
  currentAccountHomeSpace?: HomeSpace | null;
  onRestoreResetBackup?: () => void;
}

const AUTO_PUSH_DEBOUNCE_MS = 1800;
const AUTO_PULL_COOLDOWN_MS = 10000;
const AUTO_PULL_INTERVAL_MS = 60000;

export function SyncPanel({
  documentValue,
  editorOpen,
  presentation = "primary",
  storageReady,
  visible,
  onReplaceDocument,
  onSyncMetaChange,
  onBindingChange,
  hasResetBackup = false,
  currentAccountHomeSpace = null,
  onRestoreResetBackup
}: SyncPanelProps) {
  const [binding, setBinding] = useState<StoredSyncBinding | null>(null);
  const [syncCode, setSyncCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
    onBindingChange?.(nextBinding);
  }, [onBindingChange]);

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

    const pausedBinding = bindingRef.current && isSyncPausedForBinding(documentRef.current, bindingRef.current)
      ? bindingRef.current
      : null;

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
      setError(getErrorMessage(actionError, "同步操作失败。"));
      if (pausedBinding) {
        setSyncMetaFromBinding(pausedBinding, "paused", "恢复默认后同步已暂停");
        setMessage("恢复默认后同步仍暂停，请重试或选择其他操作。");
        return;
      }

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
      const localDocument = documentRef.current;
      const shouldApplyCloudVersion = options.forceApply
        && (localDocument.syncMeta.status === "conflict" || isSyncPausedForBinding(localDocument, activeBinding));

      setSyncMetaFromBinding(activeBinding, "syncing", "正在拉取云端");
      const pulled = await getSyncRepository().pull(activeBinding);
      const hasRemoteChanges = hasRemoteSnapshotChanged(pulled.revision, pulled.updatedAt, activeBinding);
      const hasPendingLocalChanges = hasLocalDocumentChanges(localDocument, activeBinding);

      if (!hasRemoteChanges && !shouldApplyCloudVersion) {
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
    if (
      !activeBinding
      || busyRef.current
      || documentRef.current.syncMeta.status === "conflict"
      || isSyncPausedForBinding(documentRef.current, activeBinding)
      || editorOpenRef.current
    ) {
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
      onBindingChange?.(null);
      return;
    }

    persistBinding(storedBinding);
    setSyncCode(formatSyncCode(storedBinding));
    if (isSyncPausedForBinding(documentRef.current, storedBinding)) {
      setMessage("恢复默认后同步已暂停。请选择上传默认、拉取云端、解除本机或恢复备份。");
      return;
    }

    setSyncMetaFromBinding(
      storedBinding,
      "linked",
      storedBinding.accessMode === "account-managed" ? "已读取本机账号托管凭证" : "已读取本机同步码"
    );
    window.setTimeout(() => {
      performPull({ forceApply: false, source: "startup" });
    }, 0);
  }, [onBindingChange, performPull, persistBinding, setSyncMetaFromBinding, storageReady]);

  useEffect(() => {
    function requestAutoPull() {
      if (
        document.visibilityState !== "hidden"
        && bindingRef.current
        && !busyRef.current
        && documentRef.current.syncMeta.status !== "conflict"
        && !isSyncPausedForBinding(documentRef.current, bindingRef.current)
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
    if (
      !activeBinding
      || documentValue.syncMeta.status === "conflict"
      || isSyncPausedForBinding(documentValue, activeBinding)
      || busyRef.current
    ) {
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

  const isPaused = Boolean(binding && isSyncPausedForBinding(documentValue, binding));
  const isAdvanced = presentation === "advanced";
  const needsAttention = isPaused || documentValue.syncMeta.status === "conflict";
  const controlsVisible = !isAdvanced || advancedOpen || needsAttention;

  const statusText = useMemo(() => {
    if (!binding) {
      return "未绑定";
    }

    const syncedAt = binding.lastSyncedAt ? formatShortDateTime(binding.lastSyncedAt) : "未同步";
    if (isPaused) {
      return `${binding.accessMode === "account-managed" ? "账号托管" : "同步码"} 已暂停，最后同步 ${syncedAt}`;
    }

    return `${binding.accessMode === "account-managed" ? "账号托管" : "同步码"} rev ${binding.remoteRevision}，最后同步 ${syncedAt}`;
  }, [binding, isPaused]);
  const isAccountManaged = binding?.accessMode === "account-managed";
  const panelTitle = isAdvanced ? "高级同步码与恢复" : "同步码";

  async function createCode() {
    await runSyncAction(async () => {
      const secrets = createSyncSecrets();
      const result = await getSyncRepository().create(documentRef.current, secrets);
      const nextBinding: StoredSyncBinding = {
        version: 1,
        accessMode: "sync-code",
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

      if (!window.confirm(getBindConfirmMessage(isAdvanced))) {
        return;
      }

      const nextBinding: StoredSyncBinding = {
        ...parsed,
        accessMode: "sync-code",
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
    if (!syncCode || bindingRef.current?.accessMode === "account-managed") {
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
    if (!window.confirm(getUnbindConfirmMessage(currentAccountHomeSpace))) {
      return;
    }

    bindingRepositoryRef.current?.clear();
    bindingRef.current = null;
    setBinding(null);
    onBindingChange?.(null);
    setSyncCode("");
    onSyncMetaChange(localSyncMeta(), binding?.accessMode === "account-managed" ? "已解除本机账号托管凭证" : "已解除本机同步码");
    setMessage("已解除本机绑定。");
    setError("");
  }

  function restoreResetBackupFromPause() {
    if (!onRestoreResetBackup) {
      return;
    }

    onRestoreResetBackup();
    setMessage("已恢复上一次重置前页面。");
    setError("");
  }

  async function revokeCode() {
    const activeBinding = bindingRef.current;
    if (!activeBinding) {
      return;
    }

    if (activeBinding.accessMode === "account-managed") {
      setMessage("账号托管空间不能在高级同步码区域废弃；如需取消账号恢复入口，请在首页空间中从账号移除。");
      setError("");
      return;
    }

    if (!window.confirm(getRevokeConfirmMessage(currentAccountHomeSpace))) {
      return;
    }

    await runSyncAction(async () => {
      await getSyncRepository().revoke(activeBinding);
      bindingRepositoryRef.current?.clear();
      bindingRef.current = null;
      setBinding(null);
      onBindingChange?.(null);
      setSyncCode("");
      onSyncMetaChange(localSyncMeta(), "同步码已废弃");
      setMessage("同步码已废弃。");
    });
  }

  if (!visible) {
    return null;
  }

  return (
    <section className={`sync-panel${isAdvanced ? " sync-panel-advanced" : ""}`} aria-label={panelTitle}>
      <div className="sync-panel-head">
        <div>
          <h2>{panelTitle}</h2>
          <p>{statusText}</p>
        </div>
        {isAdvanced ? (
          <button
            className="utility-button"
            type="button"
            disabled={needsAttention}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            {controlsVisible ? "收起高级" : "展开高级"}
          </button>
        ) : (
          <SyncActionButtons
            binding={binding}
            busy={busy}
            isAccountManaged={isAccountManaged}
            isPaused={isPaused}
            status={documentValue.syncMeta.status}
            onCreate={createCode}
            onPull={() => performPull({ forceApply: false, source: "manual" })}
            onPush={() => performPush({ force: false, source: "manual" })}
          />
        )}
      </div>

      {isPaused ? (
        <div className="sync-paused" role="status">
          <div>
            <strong>恢复默认后同步已暂停</strong>
            <p>当前默认首页还没有上传到云端。请选择下一步，避免误覆盖已有同步空间。</p>
          </div>
          <div className="sync-panel-actions">
            <button className="utility-button" type="button" onClick={() => performPush({ force: false, source: "manual" })} disabled={busy}>上传默认</button>
            <button className="utility-button" type="button" onClick={() => performPull({ forceApply: true, source: "manual" })} disabled={busy}>拉取云端</button>
            <button className="utility-button" type="button" onClick={unbindLocal} disabled={busy}>解除本机</button>
            <button className="utility-button" type="button" onClick={restoreResetBackupFromPause} disabled={busy || !hasResetBackup || !onRestoreResetBackup}>恢复备份</button>
          </div>
        </div>
      ) : null}

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

      {controlsVisible ? (
        <>
          {isAdvanced ? (
            <SyncActionButtons
              binding={binding}
              busy={busy}
              isAccountManaged={isAccountManaged}
              isPaused={isPaused}
              status={documentValue.syncMeta.status}
              onCreate={createCode}
              onPull={() => performPull({ forceApply: false, source: "manual" })}
              onPush={() => performPush({ force: false, source: "manual" })}
            />
          ) : null}

          {isAccountManaged ? (
            <p className="sync-managed-note">当前空间由账号托管恢复凭证，不显示完整同步码，也不能在这里废弃底层同步空间。</p>
          ) : (
            <div className="sync-code-grid">
              <label className="field">
                <span>当前同步码</span>
                <input
                  value={syncCode}
                  readOnly
                  placeholder="创建后显示，用于其他设备绑定"
                />
              </label>
              <button className="utility-button" type="button" onClick={copyCode} disabled={!syncCode}>复制</button>
            </div>
          )}

          <div className="sync-code-grid">
            <label className="field">
              <span>{isAdvanced ? "输入同步码恢复" : "输入同步码"}</span>
              <input value={inputCode} onChange={(event) => setInputCode(event.target.value)} placeholder="hp1_..." />
            </label>
            <button className="utility-button" type="button" onClick={bindCode} disabled={busy || !inputCode.trim()}>绑定</button>
          </div>

          {isAdvanced ? (
            <p className="sync-boundary-note">{getBoundaryNote(currentAccountHomeSpace, isAccountManaged)}</p>
          ) : null}

          <div className="sync-panel-footer">
            <div className="sync-panel-actions">
              <button className="utility-button" type="button" onClick={unbindLocal} disabled={!binding}>解除本机</button>
              {!isAccountManaged ? (
                <button
                  className="danger-button"
                  type="button"
                  onClick={revokeCode}
                  disabled={busy || !binding}
                >
                  废弃同步码
                </button>
              ) : null}
            </div>
            <p className={error ? "form-error" : "save-status"}>{error || message}</p>
          </div>
        </>
      ) : (
        <p className="save-status">{error || message || "同步码创建、绑定和旧空间维护已收起。"}</p>
      )}
    </section>
  );
}

function SyncActionButtons({
  binding,
  busy,
  isAccountManaged,
  isPaused,
  status,
  onCreate,
  onPull,
  onPush
}: {
  binding: StoredSyncBinding | null;
  busy: boolean;
  isAccountManaged: boolean;
  isPaused: boolean;
  status: HomeSyncMeta["status"];
  onCreate: () => void;
  onPull: () => void;
  onPush: () => void;
}) {
  return (
    <div className="sync-panel-actions">
      {!isAccountManaged ? (
        <button className="utility-button" type="button" onClick={onCreate} disabled={busy || isPaused}>创建</button>
      ) : null}
      <button className="utility-button" type="button" onClick={onPull} disabled={busy || !binding || isPaused}>拉取</button>
      <button className="utility-button" type="button" onClick={onPush} disabled={busy || !binding || isPaused || status === "conflict"}>上传</button>
    </div>
  );
}

function getBoundaryNote(homeSpace: HomeSpace | null, isAccountManaged: boolean): string {
  if (isAccountManaged) {
    return homeSpace
      ? `当前账号托管空间“${homeSpace.name}”由账号保存恢复凭证。这里的解除本机只影响当前浏览器；账号空间仍保留。`
      : "当前账号托管空间由账号保存恢复凭证。这里的解除本机只影响当前浏览器；账号空间仍保留。";
  }

  if (homeSpace?.accessMode === "sync-code") {
    return `当前普通同步码已在账号中记录为首页空间“${homeSpace.name}”。废弃同步码只会让底层同步码失效，不会自动从账号移除该空间。`;
  }

  return "这里只管理当前浏览器的同步码绑定和底层同步码；输入同步码不会自动认领到账号，也不会迁移为账号托管。";
}

function getBindConfirmMessage(isAdvanced: boolean): string {
  return [
    "输入同步码会用云端首页覆盖当前本地首页。",
    isAdvanced ? "这只会绑定当前浏览器，不会自动认领到账号，也不会迁移为账号托管；账号空间请在上方“首页空间”中处理。" : "",
    "继续？"
  ].filter(Boolean).join("\n");
}

function getUnbindConfirmMessage(homeSpace: HomeSpace | null): string {
  if (homeSpace?.accessMode === "account-managed") {
    return [
      `解除本机账号托管空间“${homeSpace.name}”？`,
      "这只会清除当前浏览器的本机绑定，本地首页内容会保留。",
      "账号中的首页空间和托管恢复凭证不会删除，之后仍可在“首页空间”中恢复。",
      "继续？"
    ].join("\n");
  }

  if (homeSpace?.accessMode === "sync-code") {
    return [
      `解除本机同步码空间“${homeSpace.name}”？`,
      "这只会清除当前浏览器的本机同步码绑定，本地首页内容会保留。",
      "账号中的首页空间索引不会删除，云端同步空间和同步码也不会废弃。",
      "继续？"
    ].join("\n");
  }

  return "解除后，本机不再同步，但云端同步空间不会删除。继续？";
}

function getRevokeConfirmMessage(homeSpace: HomeSpace | null): string {
  if (homeSpace?.accessMode === "sync-code") {
    return [
      `废弃当前同步码空间“${homeSpace.name}”？`,
      "废弃后，所有设备都无法继续使用这个同步码上传或拉取。",
      "这不会自动从账号移除该首页空间索引；账号列表中仍可能保留一个无法用旧同步码激活的空间。",
      "如只想让当前浏览器停止同步，请使用“解除本机”。",
      "继续废弃？"
    ].join("\n");
  }

  return "废弃后，所有设备都无法继续使用这个同步码。继续？";
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

function isSyncPausedForBinding(documentValue: HomeDocumentV2, binding: StoredSyncBinding): boolean {
  return documentValue.syncMeta.status === "paused"
    && documentValue.syncMeta.mode === "sync-code"
    && documentValue.syncMeta.spaceId === binding.spaceId;
}

function isLikelyOfflineError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /fetch|network|offline|failed/i.test(error.message);
}
