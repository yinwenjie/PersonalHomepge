"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HomeSpace } from "@/domain/account";
import { getErrorMessage } from "@/domain/errors";
import { HomeDocumentV2, HomeSyncMeta } from "@/domain/home-document";
import { classifyHomeDocument, getHomeDocumentClassLabel } from "@/domain/home-document-protection";
import type { LocalePreference } from "@/domain/ui-preferences";
import {
  createSyncSecrets,
  formatSyncCode,
  parseSyncCode,
  StoredSyncBinding
} from "@/domain/sync-code";
import { StatusMessage } from "@/components/status-message";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import { recordLocalAuditEvent } from "@/infrastructure/local-audit-log-repository";
import type { LocalHomeSnapshotSource } from "@/infrastructure/local-home-snapshot-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";
import { isSupabaseConfigured, SUPABASE_CONFIGURATION_MESSAGE } from "@/infrastructure/supabase-client";
import { runWithSyncLock, type SyncCoordinatorOperation } from "@/infrastructure/sync-coordinator";
import { LocalSyncBindingRepository } from "@/infrastructure/sync-binding-repository";
import { SyncCodeRepository, PullSyncSpaceResult } from "@/infrastructure/sync-code-repository";

interface SyncPanelProps {
  documentValue: HomeDocumentV2;
  editorOpen: boolean;
  accountManagedStatusTargetId?: string;
  presentation?: "primary" | "advanced";
  storageReady: boolean;
  visible: boolean;
  onBeforeCloudOverwrite: (documentValue: HomeDocumentV2, source: LocalHomeSnapshotSource) => boolean;
  onBeforeOverwrite: (source: LocalHomeSnapshotSource) => boolean;
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
  accountManagedStatusTargetId,
  presentation = "primary",
  storageReady,
  visible,
  onBeforeCloudOverwrite,
  onBeforeOverwrite,
  onReplaceDocument,
  onSyncMetaChange,
  onBindingChange,
  hasResetBackup = false,
  currentAccountHomeSpace = null,
  onRestoreResetBackup
}: SyncPanelProps) {
  const { preferences } = useUiPreferences();
  const syncServiceConfigured = isSupabaseConfigured();
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

  const protectBeforeOverwrite = useCallback((source: LocalHomeSnapshotSource, failureMessage: string): boolean => {
    if (onBeforeOverwrite(source)) {
      return true;
    }

    setError(failureMessage);
    setMessage("");
    if (!visible) {
      window.alert(failureMessage);
    }
    return false;
  }, [onBeforeOverwrite, visible]);

  const protectCloudBeforeOverwrite = useCallback(async (activeBinding: StoredSyncBinding): Promise<boolean> => {
    const pulled = await getSyncRepository().pull(activeBinding);
    const cloudBinding: StoredSyncBinding = {
      ...activeBinding,
      remoteRevision: pulled.revision,
      lastSyncedAt: pulled.updatedAt,
      lastSyncedDocumentRevision: pulled.document.revision,
      lastSyncedDocumentUpdatedAt: pulled.document.updatedAt
    };
    const cloudDocument = {
      ...pulled.document,
      syncMeta: toSyncMeta(cloudBinding, "synced")
    };

    if (onBeforeCloudOverwrite(cloudDocument, "before-cloud-overwrite")) {
      return true;
    }

    setError("未能保存当前云端首页，已取消覆盖云端。");
    setMessage("");
    recordLocalAuditEvent({
      documentId: cloudDocument.documentId,
      level: "danger",
      message: "云端首页覆盖前保护失败，覆盖云端已取消。",
      metadata: {
        remoteRevision: pulled.revision
      },
      spaceId: activeBinding.spaceId,
      type: "sync.cloud_overwrite_protection_failed"
    });
    return false;
  }, [getSyncRepository, onBeforeCloudOverwrite]);

  const runSyncAction = useCallback(async (
    action: () => Promise<void>,
    options: {
      exposeBusy?: boolean;
      operation?: SyncCoordinatorOperation;
      spaceId?: string | null;
    } = {}
  ): Promise<void> => {
    if (busyRef.current) {
      return;
    }

    if (!syncServiceConfigured) {
      setMessage(SUPABASE_CONFIGURATION_MESSAGE);
      setError("");
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
      if (options.operation && options.spaceId) {
        const lockResult = await runWithSyncLock({
          operation: options.operation,
          spaceId: options.spaceId,
          storage: window.localStorage
        }, action);

        if (lockResult.status === "busy") {
          setMessage("其他标签页正在同步这个首页空间，本次操作已跳过。");
        }
      } else {
        await action();
      }
    } catch (actionError) {
      console.error(actionError);
      const activeBinding = bindingRef.current;
      setError(getErrorMessage(actionError, "同步操作失败。"));
      if (pausedBinding) {
        setSyncMetaFromBinding(pausedBinding, "paused", "同步已暂停");
        setMessage("同步仍暂停，请重试或选择其他操作。");
        return;
      }

      if (activeBinding) {
        setSyncMetaFromBinding(activeBinding, isLikelyOfflineError(actionError) ? "offline" : "error", "同步失败");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [setSyncMetaFromBinding, syncServiceConfigured]);

  const applyCloudDocument = useCallback((
    pulled: PullSyncSpaceResult,
    activeBinding: StoredSyncBinding,
    statusMessage: string,
    snapshotSource: LocalHomeSnapshotSource
  ): boolean => {
    if (!protectBeforeOverwrite(snapshotSource, "未能保存当前首页，已取消云端覆盖。")) {
      return false;
    }

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
    return true;
  }, [onReplaceDocument, persistBinding, protectBeforeOverwrite]);

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
        if (shouldAuditPullSource(options.source)) {
          setMessage(hasPendingLocalChanges ? "云端无更新，本地修改待上传。" : "云端无更新。");
          recordLocalAuditEvent({
            documentId: localDocument.documentId,
            message: "已检查云端首页，云端无更新。",
            metadata: {
              hasPendingLocalChanges,
              source: options.source
            },
            spaceId: activeBinding.spaceId,
            type: "sync.pull_no_changes"
          });
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
        recordLocalAuditEvent({
          documentId: localDocument.documentId,
          level: "warning",
          message: "检测到同步冲突：云端和本地都有修改。",
          metadata: {
            source: options.source
          },
          spaceId: activeBinding.spaceId,
          type: "sync.conflict"
        });
        trackProductEvent("sync.conflict_detected", {
          source: options.source,
          syncStatus: "conflict"
        });
        return;
      }

      const snapshotSource = options.source === "resolve" && localDocument.syncMeta.status === "conflict"
        ? "before-conflict-cloud-resolve"
        : "before-cloud-pull";
      if (shouldConfirmCloudPull(options.source) && !window.confirm(getCloudPullConfirmMessage(options.source))) {
        setSyncMetaFromBinding(activeBinding, getCancelSyncStatus(localDocument), "已取消拉取覆盖");
        setMessage("已取消拉取，当前本地首页未改变。");
        return;
      }

      const cloudDocumentApplied = applyCloudDocument(
        pulled,
        activeBinding,
        options.source === "auto" ? "已自动拉取云端首页" : "已拉取云端首页",
        snapshotSource
      );
      if (!cloudDocumentApplied) {
        setSyncMetaFromBinding(activeBinding, localDocument.syncMeta.status, "已取消拉取覆盖");
        return;
      }

      setMessage(options.source === "auto" ? "已自动拉取云端首页。" : "已拉取云端首页。");
      if (shouldAuditPullSource(options.source)) {
        recordLocalAuditEvent({
          documentId: pulled.document.documentId,
          message: "已拉取云端首页并覆盖本地首页。",
          metadata: {
            remoteRevision: pulled.revision,
            source: options.source
          },
          spaceId: activeBinding.spaceId,
          type: "sync.pull_applied"
        });
      }
      trackProductEvent("sync.pull_applied", {
        source: options.source
      });
      if (options.source === "resolve") {
        trackProductEvent("sync.resolved_cloud", {
          source: "conflict"
        });
      }
    }, {
      exposeBusy: options.source !== "auto",
      operation: "pull",
      spaceId: activeBinding.spaceId
    });
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
    }, {
      exposeBusy: false,
      operation: "check",
      spaceId: activeBinding.spaceId
    });

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

    const localClassification = classifyHomeDocument(localDocument);
    if (options.source !== "auto" && !window.confirm(getCloudOverwriteConfirmMessage(localClassification, options.force))) {
      setMessage("已取消上传，云端首页未改变。");
      setError("");
      recordLocalAuditEvent({
        documentId: localDocument.documentId,
        level: "warning",
        message: "用户取消用本地首页覆盖云端。",
        metadata: {
          documentClass: localClassification.documentClass,
          force: options.force,
          source: options.source
        },
        spaceId: activeBinding.spaceId,
        type: "sync.cloud_overwrite_cancelled"
      });
      return;
    }

    await runSyncAction(async () => {
      if (options.source !== "auto") {
        const cloudProtected = await protectCloudBeforeOverwrite(activeBinding);
        if (!cloudProtected) {
          return;
        }
      }

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
        recordLocalAuditEvent({
          documentId: localDocument.documentId,
          level: "warning",
          message: "已用本地首页覆盖云端版本。",
          metadata: {
            remoteRevision: result.revision,
            source: options.source
          },
          spaceId: activeBinding.spaceId,
          type: "sync.force_push"
        });
        trackProductEvent(options.source === "resolve" ? "sync.resolved_local" : "sync.push_applied", {
          force: true,
          source: options.source
        });
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
        recordLocalAuditEvent({
          documentId: localDocument.documentId,
          level: "warning",
          message: "上传时检测到云端已有更新。",
          metadata: {
            source: options.source
          },
          spaceId: activeBinding.spaceId,
          type: "sync.push_conflict"
        });
        trackProductEvent("sync.conflict_detected", {
          source: options.source,
          syncStatus: "conflict"
        });
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
      if (options.source !== "auto") {
        recordLocalAuditEvent({
          documentId: localDocument.documentId,
          message: "已上传本地首页到云端。",
          metadata: {
            remoteRevision: result.revision,
            source: options.source
          },
          spaceId: activeBinding.spaceId,
          type: "sync.push"
        });
        trackProductEvent("sync.push_applied", {
          force: false,
          source: options.source
        });
      }
    }, {
      exposeBusy: options.source !== "auto",
      operation: options.force ? "force-push" : "push",
      spaceId: activeBinding.spaceId
    });
  }, [getSyncRepository, persistBinding, protectCloudBeforeOverwrite, runSyncAction, setSyncMetaFromBinding]);

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

    if (!syncServiceConfigured) {
      setMessage("已读取本机同步码；配置 Supabase 后可继续连接云端同步。");
      setError("");
      return;
    }

    if (isSyncPausedForBinding(documentRef.current, storedBinding)) {
      setMessage("同步已暂停。请选择上传本地、拉取云端、解除本机或恢复备份。");
      return;
    }

    setSyncMetaFromBinding(
      storedBinding,
      "linked",
      storedBinding.accessMode === "account-managed" ? "已读取本机账号托管绑定" : "已读取本机同步码"
    );
    window.setTimeout(() => {
      performPull({ forceApply: false, source: "startup" });
    }, 0);
  }, [onBindingChange, performPull, persistBinding, setSyncMetaFromBinding, storageReady, syncServiceConfigured]);

  useEffect(() => {
    function requestAutoPull() {
      if (
        syncServiceConfigured
        && document.visibilityState !== "hidden"
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
  }, [performAutoRevisionCheck, syncServiceConfigured]);

  useEffect(() => {
    const activeBinding = binding;
    if (
      !syncServiceConfigured
      || !activeBinding
      || documentValue.syncMeta.status === "conflict"
      || isSyncPausedForBinding(documentValue, activeBinding)
      || busyRef.current
    ) {
      return;
    }

    if (!hasLocalDocumentChanges(documentValue, activeBinding)) {
      return;
    }

    const classification = classifyHomeDocument(documentValue);
    if (!classification.isUserData) {
      if (autoPushTimerRef.current) {
        clearTimeout(autoPushTimerRef.current);
      }

      const pauseTimerId = window.setTimeout(() => {
        setSyncMetaFromBinding(activeBinding, "paused", "同步已暂停");
        setMessage("当前首页属于系统态，已停止自动上传。请手动选择上传本地或拉取云端。");
        setError("");
        recordLocalAuditEvent({
          documentId: documentValue.documentId,
          level: "warning",
          message: "系统态首页已阻止自动上传，避免覆盖云端有效数据。",
          metadata: {
            documentClass: classification.documentClass
          },
          spaceId: activeBinding.spaceId,
          type: "sync.auto_push_skipped_system_document"
        });
        trackProductEvent("sync.auto_push_skipped_system_document", {
          documentClass: classification.documentClass
        });
      }, 0);

      return () => window.clearTimeout(pauseTimerId);
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
  }, [binding, documentValue, performPush, setSyncMetaFromBinding, syncServiceConfigured]);

  const isPaused = Boolean(binding && isSyncPausedForBinding(documentValue, binding));
  const isAdvanced = presentation === "advanced";
  const isAccountManaged = binding?.accessMode === "account-managed";
  const isConflict = documentValue.syncMeta.status === "conflict";
  const isAccountSyncContext = Boolean(binding && (isAdvanced || isAccountManaged || currentAccountHomeSpace));
  const shouldUseAccountManagedStatusSlot = Boolean(accountManagedStatusTargetId && isAccountSyncContext && (isPaused || isConflict));
  const accountManagedStatusTarget = shouldUseAccountManagedStatusSlot && typeof document !== "undefined" && accountManagedStatusTargetId
    ? document.getElementById(accountManagedStatusTargetId)
    : null;
  const needsAttention = ((isPaused || isConflict) && !shouldUseAccountManagedStatusSlot);
  const controlsVisible = !isAdvanced || advancedOpen || needsAttention;

  const statusText = useMemo(() => {
    if (!syncServiceConfigured) {
      return binding ? "本机已保存同步绑定，云端未配置" : "云端未配置";
    }

    if (!binding) {
      return "未绑定";
    }

    const syncedAt = binding.lastSyncedAt ? formatShortDateTime(binding.lastSyncedAt, preferences.locale) : "未同步";
    if (isConflict) {
      if (isAccountSyncContext && shouldUseAccountManagedStatusSlot) {
        return `账号同步冲突见账号栏，最后同步 ${syncedAt}`;
      }

      return `${binding.accessMode === "account-managed" ? "账号托管" : "同步码"} 同步冲突，最后同步 ${syncedAt}`;
    }

    if (isPaused) {
      if (isAccountSyncContext && shouldUseAccountManagedStatusSlot) {
        return `账号同步状态见账号栏，最后同步 ${syncedAt}`;
      }

      return `${binding.accessMode === "account-managed" ? "账号托管" : "同步码"} 已暂停，最后同步 ${syncedAt}`;
    }

    return `${binding.accessMode === "account-managed" ? "账号托管" : "同步码"} rev ${binding.remoteRevision}，最后同步 ${syncedAt}`;
  }, [binding, isAccountSyncContext, isConflict, isPaused, preferences.locale, shouldUseAccountManagedStatusSlot, syncServiceConfigured]);
  const panelTitle = isAdvanced ? "离线同步码与恢复" : "同步码";
  const syncStatusMessage = error
    || (shouldUseAccountManagedStatusSlot ? "" : message)
    || (!syncServiceConfigured ? SUPABASE_CONFIGURATION_MESSAGE : "");
  const syncStatusTone = error ? "danger" : !syncServiceConfigured ? "warning" : message ? "success" : "neutral";
  const syncStatusRole = error ? "alert" : "status";

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
      trackProductEvent("sync.code_created", {
        source: "sync-panel"
      });
      recordLocalAuditEvent({
        documentId: documentRef.current.documentId,
        message: "已为当前首页创建同步码。",
        metadata: {
          remoteRevision: result.revision
        },
        spaceId: result.spaceId,
        type: "sync.create_code"
      });
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

      if (!protectBeforeOverwrite("before-sync-code-bind", "未能保存当前首页，已取消绑定同步码。")) {
        return;
      }

      persistBinding(nextBinding);
      setSyncCode(formatSyncCode(nextBinding));
      setInputCode("");
      onReplaceDocument({
        ...pulled.document,
        syncMeta: toSyncMeta(nextBinding, "synced")
      }, "已绑定同步码并拉取云端首页");
      setMessage("已绑定同步码。");
      trackProductEvent("sync.code_bound", {
        source: isAdvanced ? "advanced" : "primary"
      });
      recordLocalAuditEvent({
        documentId: pulled.document.documentId,
        message: "已绑定同步码并拉取云端首页。",
        metadata: {
          remoteRevision: pulled.revision
        },
        spaceId: nextBinding.spaceId,
        type: "sync.bind_code"
      });
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

    const previousBinding = bindingRef.current;
    bindingRepositoryRef.current?.clear();
    bindingRef.current = null;
    setBinding(null);
    onBindingChange?.(null);
    setSyncCode("");
    onSyncMetaChange(localSyncMeta(), previousBinding?.accessMode === "account-managed" ? "已解除本机账号托管绑定" : "已解除本机同步码");
    setMessage("已解除本机绑定。");
    setError("");
    recordLocalAuditEvent({
      documentId: documentRef.current.documentId,
      message: previousBinding?.accessMode === "account-managed" ? "已解除本机账号托管绑定。" : "已解除本机同步码绑定。",
      metadata: {
        accessMode: previousBinding?.accessMode ?? "unknown"
      },
      spaceId: previousBinding?.spaceId ?? null,
      type: "sync.unbind_local"
    });
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
      setMessage("账号托管空间不能在离线同步码区域废弃；如需取消账号恢复入口，请在首页空间中从账号移除。");
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
      recordLocalAuditEvent({
        documentId: documentRef.current.documentId,
        level: "warning",
        message: "已废弃当前同步码。",
        spaceId: activeBinding.spaceId,
        type: "sync.revoke_code"
      });
    }, {
      operation: "revoke",
      spaceId: activeBinding.spaceId
    });
  }

  if (!visible) {
    return null;
  }

  const pausedNotice = (
    <div className="sync-paused" role="status">
      <div>
        <strong>同步已暂停</strong>
        <p>当前本地首页暂未自动上传。请选择下一步，避免误覆盖已有同步空间。</p>
      </div>
      <div className="sync-panel-actions">
        <button className="utility-button" type="button" onClick={() => performPush({ force: false, source: "manual" })} disabled={!syncServiceConfigured || busy} title={getRemoteActionDisabledReason(syncServiceConfigured, busy) ?? "把当前本地首页上传到当前同步空间"}>上传本地</button>
        <button className="utility-button" type="button" onClick={() => performPull({ forceApply: true, source: "manual" })} disabled={!syncServiceConfigured || busy} title={getRemoteActionDisabledReason(syncServiceConfigured, busy) ?? "用云端首页覆盖当前本地首页"}>拉取云端</button>
        <button className="utility-button" type="button" onClick={unbindLocal} disabled={busy} title={busy ? "同步操作处理中，请稍后。" : "只解除当前浏览器绑定，保留本地首页"}>解除本机</button>
        <button className="utility-button" type="button" onClick={restoreResetBackupFromPause} disabled={busy || !hasResetBackup || !onRestoreResetBackup} title={getRestoreBackupDisabledReason(busy, hasResetBackup, Boolean(onRestoreResetBackup)) ?? "恢复重置前自动保存的本地备份"}>恢复备份</button>
      </div>
    </div>
  );
  const conflictNotice = (
    <div className="sync-conflict" role="status">
      <div>
        <strong>云端和本地都有修改</strong>
        <p>自动同步已暂停。请选择保留哪一份数据。</p>
      </div>
      <div className="sync-panel-actions">
        <button className="utility-button" type="button" onClick={() => performPull({ forceApply: true, source: "resolve" })} disabled={!syncServiceConfigured || busy} title={getRemoteActionDisabledReason(syncServiceConfigured, busy) ?? "用云端首页覆盖当前本地首页"}>使用云端版本</button>
        <button className="danger-button" type="button" onClick={() => performPush({ force: true, source: "resolve" })} disabled={!syncServiceConfigured || busy} title={getRemoteActionDisabledReason(syncServiceConfigured, busy) ?? "把当前本地首页强制上传并覆盖云端"}>本地覆盖云端</button>
        <button className="utility-button" type="button" onClick={() => setMessage("已暂停自动同步，冲突状态会保留。")} disabled={busy} title={busy ? "同步操作处理中，请稍后。" : "保留冲突状态，稍后再处理"}>暂不处理</button>
      </div>
    </div>
  );

  return (
    <>
    {shouldUseAccountManagedStatusSlot && accountManagedStatusTarget
      ? createPortal(isConflict ? conflictNotice : pausedNotice, accountManagedStatusTarget)
      : null}
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
            title={needsAttention ? "请先处理暂停同步或同步冲突。" : controlsVisible ? "收起离线同步码操作" : "展开离线同步码操作"}
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
            serviceConfigured={syncServiceConfigured}
            status={documentValue.syncMeta.status}
            onCreate={createCode}
            onPull={() => performPull({ forceApply: false, source: "manual" })}
            onPush={() => performPush({ force: false, source: "manual" })}
          />
        )}
      </div>

      {isPaused && !shouldUseAccountManagedStatusSlot ? pausedNotice : null}

      {isConflict && !shouldUseAccountManagedStatusSlot ? conflictNotice : null}

      {controlsVisible ? (
        <>
          {isAdvanced ? (
            <SyncActionButtons
              binding={binding}
              busy={busy}
              isAccountManaged={isAccountManaged}
              isPaused={isPaused}
              serviceConfigured={syncServiceConfigured}
              status={documentValue.syncMeta.status}
              onCreate={createCode}
              onPull={() => performPull({ forceApply: false, source: "manual" })}
              onPush={() => performPush({ force: false, source: "manual" })}
            />
          ) : null}

          {isAccountManaged ? (
            <p className="sync-managed-note">当前空间由账号可信托管，不显示完整同步码；账号会保存恢复凭证，云端历史可用于恢复和审计。</p>
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
              <button className="utility-button" type="button" onClick={copyCode} disabled={!syncCode} title={syncCode ? "复制当前同步码" : "当前没有可复制的同步码"}>复制</button>
            </div>
          )}

          <div className="sync-code-grid">
            <label className="field">
              <span>{isAdvanced ? "输入同步码恢复" : "输入同步码"}</span>
              <input value={inputCode} onChange={(event) => setInputCode(event.target.value)} placeholder="hp1_..." />
            </label>
            <button className="utility-button" type="button" onClick={bindCode} disabled={!syncServiceConfigured || busy || !inputCode.trim()} title={getBindDisabledReason(syncServiceConfigured, busy, inputCode) ?? "绑定输入的同步码，并用云端首页覆盖当前本地首页"}>绑定</button>
          </div>

          {isAdvanced ? (
            <p className="sync-boundary-note">{getBoundaryNote(currentAccountHomeSpace, isAccountManaged)}</p>
          ) : null}

          <div className="sync-panel-footer">
            <div className="sync-panel-actions">
              <button className="utility-button" type="button" onClick={unbindLocal} disabled={!binding} title={binding ? "只解除当前浏览器绑定，保留本地首页" : "当前浏览器未绑定同步空间"}>解除本机</button>
              {!isAccountManaged ? (
                <button
                  className="danger-button"
                  type="button"
                  onClick={revokeCode}
                  disabled={!syncServiceConfigured || busy || !binding}
                  title={getRevokeDisabledReason(syncServiceConfigured, busy, binding) ?? "废弃当前同步码，所有设备都不能继续使用这个同步码"}
                >
                  废弃同步码
                </button>
              ) : null}
            </div>
            <StatusMessage role={syncStatusRole} tone={syncStatusTone}>
              {syncStatusMessage}
            </StatusMessage>
          </div>
        </>
      ) : (
        <StatusMessage role={syncStatusRole} tone={syncStatusTone}>
          {syncStatusMessage || "同步码创建、绑定和旧空间维护已收起。"}
        </StatusMessage>
      )}
    </section>
    </>
  );
}

function SyncActionButtons({
  binding,
  busy,
  isAccountManaged,
  isPaused,
  serviceConfigured,
  status,
  onCreate,
  onPull,
  onPush
}: {
  binding: StoredSyncBinding | null;
  busy: boolean;
  isAccountManaged: boolean;
  isPaused: boolean;
  serviceConfigured: boolean;
  status: HomeSyncMeta["status"];
  onCreate: () => void;
  onPull: () => void;
  onPush: () => void;
}) {
  const createDisabledReason = getCreateDisabledReason(serviceConfigured, busy, isPaused);
  const pullDisabledReason = getPullDisabledReason(serviceConfigured, busy, binding, isPaused);
  const pushDisabledReason = getPushDisabledReason(serviceConfigured, busy, binding, isPaused, status);

  return (
    <div className="sync-panel-actions">
      {!isAccountManaged ? (
        <button
          className="utility-button"
          type="button"
          onClick={onCreate}
          disabled={!serviceConfigured || busy || isPaused}
          title={createDisabledReason ?? "为当前首页创建普通同步码"}
        >
          创建
        </button>
      ) : null}
      <button
        className="utility-button"
        type="button"
        onClick={onPull}
        disabled={!serviceConfigured || busy || !binding || isPaused}
        title={pullDisabledReason ?? "从当前同步空间拉取云端首页"}
      >
        拉取
      </button>
      <button
        className="utility-button"
        type="button"
        onClick={onPush}
        disabled={!serviceConfigured || busy || !binding || isPaused || status === "conflict"}
        title={pushDisabledReason ?? "把当前本地首页上传到同步空间"}
      >
        上传
      </button>
    </div>
  );
}

function getCreateDisabledReason(serviceConfigured: boolean, busy: boolean, isPaused: boolean): string | undefined {
  if (!serviceConfigured) {
    return "账号与云端同步服务尚未配置 Supabase 环境变量。";
  }

  if (busy) {
    return "同步操作处理中，请稍后。";
  }

  if (isPaused) {
    return "同步已暂停，请先选择上传本地、拉取云端、解除本机或恢复备份。";
  }

  return undefined;
}

function getRemoteActionDisabledReason(serviceConfigured: boolean, busy: boolean): string | undefined {
  if (!serviceConfigured) {
    return "账号与云端同步服务尚未配置 Supabase 环境变量。";
  }

  if (busy) {
    return "同步操作处理中，请稍后。";
  }

  return undefined;
}

function getPullDisabledReason(
  serviceConfigured: boolean,
  busy: boolean,
  binding: StoredSyncBinding | null,
  isPaused: boolean
): string | undefined {
  if (!serviceConfigured) {
    return "账号与云端同步服务尚未配置 Supabase 环境变量。";
  }

  if (busy) {
    return "同步操作处理中，请稍后。";
  }

  if (!binding) {
    return "请先创建或绑定同步码。";
  }

  if (isPaused) {
    return "同步已暂停，请使用提示区中的“拉取云端”。";
  }

  return undefined;
}

function getPushDisabledReason(
  serviceConfigured: boolean,
  busy: boolean,
  binding: StoredSyncBinding | null,
  isPaused: boolean,
  status: HomeSyncMeta["status"]
): string | undefined {
  if (!serviceConfigured) {
    return "账号与云端同步服务尚未配置 Supabase 环境变量。";
  }

  if (busy) {
    return "同步操作处理中，请稍后。";
  }

  if (!binding) {
    return "请先创建或绑定同步码。";
  }

  if (isPaused) {
    return "同步已暂停，请使用提示区中的“上传本地”。";
  }

  if (status === "conflict") {
    return "当前存在同步冲突，请先选择云端版本或本地版本。";
  }

  return undefined;
}

function getBindDisabledReason(serviceConfigured: boolean, busy: boolean, inputCode: string): string | undefined {
  if (!serviceConfigured) {
    return "账号与云端同步服务尚未配置 Supabase 环境变量。";
  }

  if (busy) {
    return "同步操作处理中，请稍后。";
  }

  if (!inputCode.trim()) {
    return "请输入完整同步码。";
  }

  return undefined;
}

function getRevokeDisabledReason(serviceConfigured: boolean, busy: boolean, binding: StoredSyncBinding | null): string | undefined {
  if (!serviceConfigured) {
    return "账号与云端同步服务尚未配置 Supabase 环境变量。";
  }

  if (busy) {
    return "同步操作处理中，请稍后。";
  }

  if (!binding) {
    return "当前浏览器未绑定同步码。";
  }

  return undefined;
}

function getRestoreBackupDisabledReason(
  busy: boolean,
  hasResetBackup: boolean,
  canRestoreResetBackup: boolean
): string | undefined {
  if (busy) {
    return "同步操作处理中，请稍后。";
  }

  if (!canRestoreResetBackup) {
    return "当前页面不支持从这里恢复重置前备份。";
  }

  if (!hasResetBackup) {
    return "没有可恢复的重置前备份。";
  }

  return undefined;
}

function getBoundaryNote(homeSpace: HomeSpace | null, isAccountManaged: boolean): string {
  if (isAccountManaged) {
    return homeSpace
      ? `当前账号托管空间“${homeSpace.name}”采用账号可信托管模型：账号保存恢复凭证，有效用户首页可进入云端历史。这里的解除本机只影响当前浏览器；账号空间仍保留。`
      : "当前账号托管空间采用账号可信托管模型：账号保存恢复凭证，有效用户首页可进入云端历史。这里的解除本机只影响当前浏览器；账号空间仍保留。";
  }

  if (homeSpace?.accessMode === "sync-code") {
    return `当前普通同步码已在账号中记录为首页空间“${homeSpace.name}”。账号只保存索引，完整同步码仍由用户持有；废弃同步码只会让底层同步码失效，不会自动从账号移除该空间。`;
  }

  return "这里只管理当前浏览器的普通同步码绑定；输入同步码不会自动认领到账号，也不会迁移为账号托管。普通同步码空间云端默认只保存密文。";
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
      "账号中的首页空间、恢复凭证和账号托管云端历史不会删除，之后仍可在“首页空间”中恢复。",
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

function shouldConfirmCloudPull(source: "auto" | "manual" | "resolve" | "startup"): boolean {
  return source === "manual" || source === "resolve";
}

function getCloudPullConfirmMessage(source: "auto" | "manual" | "resolve" | "startup"): string {
  const action = source === "resolve" ? "使用云端版本" : "拉取云端首页";

  return [
    `${action}会用云端首页覆盖当前本地首页。`,
    "覆盖前会先保存当前有效本地首页到数据恢复中心。",
    "继续？"
  ].join("\n");
}

function getCloudOverwriteConfirmMessage(
  classification: ReturnType<typeof classifyHomeDocument>,
  force: boolean
): string {
  const overwriteLine = force
    ? "继续会强制用当前本地首页覆盖云端版本。"
    : "继续会用当前本地首页上传并覆盖云端版本。";

  if (classification.isUserData) {
    return [
      overwriteLine,
      "覆盖前会先把当前云端版本保存到本机数据恢复中心。",
      "继续？"
    ].join("\n");
  }

  return [
    `当前本地首页是${getHomeDocumentClassLabel(classification)}，系统不会自动上传这类首页。`,
    overwriteLine,
    "覆盖前会先把当前云端版本保存到本机数据恢复中心。",
    "继续？"
  ].join("\n");
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

function formatShortDateTime(value: string, locale: LocalePreference): string {
  return new Intl.DateTimeFormat(locale, {
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

function getCancelSyncStatus(documentValue: HomeDocumentV2): HomeSyncMeta["status"] {
  return documentValue.syncMeta.mode === "sync-code" && documentValue.syncMeta.status !== "local-only"
    ? documentValue.syncMeta.status
    : "linked";
}

function shouldAuditPullSource(source: "auto" | "manual" | "resolve" | "startup"): boolean {
  return source === "manual" || source === "resolve";
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
