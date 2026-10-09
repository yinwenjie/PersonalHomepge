"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hasPendingDialog, requestConfirm, showAlert, waitForDialogsClosed } from "@/components/confirm-dialog";
import type { HomeDocumentV2, HomeSyncMeta } from "@/domain/home-document";
import { getErrorMessage } from "@/domain/errors";
import {
  classifyHomeDocument,
  createHomeDocumentContentFingerprint
} from "@/domain/home-document-protection";
import { formatSyncCode, type StoredSyncBinding } from "@/domain/sync-code";
import { useI18n } from "@/hooks/use-i18n";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";
import { recordLocalAuditEvent } from "@/infrastructure/local-audit-log-repository";
import type { LocalHomeSnapshotSource } from "@/infrastructure/local-home-snapshot-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";
import { isSupabaseConfigured } from "@/infrastructure/supabase-client";
import { runWithSyncLock, type SyncCoordinatorOperation } from "@/infrastructure/sync-coordinator";
import { LocalSyncBindingRepository } from "@/infrastructure/sync-binding-repository";
import { SyncCodeRepository, type PullSyncSpaceResult } from "@/infrastructure/sync-code-repository";
import { formatSettingsHomeDocumentClass } from "@/i18n/settings-presentation";
import type { I18nTranslate } from "@/i18n/messages";

export interface SyncEngineOptions {
  documentValue: HomeDocumentV2;
  editorOpen: boolean;
  storageReady: boolean;
  /**
   * Whether a sync panel shows this engine's status. When false, failures that
   * block an overwrite fall back to an alert dialog so they are not lost.
   */
  visible: boolean;
  onBeforeCloudOverwrite: (documentValue: HomeDocumentV2, source: LocalHomeSnapshotSource) => boolean;
  onBeforeOverwrite: (source: LocalHomeSnapshotSource) => boolean;
  onReplaceDocument: (documentValue: HomeDocumentV2, message: string) => void;
  onSyncMetaChange: (syncMeta: HomeSyncMeta, message: string) => void;
  onBindingChange?: (binding: StoredSyncBinding | null) => void;
}

const AUTO_PUSH_DEBOUNCE_MS = 1800;
const AUTO_PULL_COOLDOWN_MS = 10000;
const AUTO_PULL_INTERVAL_MS = 60000;

/**
 * Owns the sync binding, automatic pull/push and conflict handling for the
 * current home document. Mount it once per page that edits the document,
 * whether or not a sync panel is rendered.
 */
export function useSyncEngine({
  documentValue,
  editorOpen,
  storageReady,
  visible,
  onBeforeCloudOverwrite,
  onBeforeOverwrite,
  onReplaceDocument,
  onSyncMetaChange,
  onBindingChange
}: SyncEngineOptions) {
  const { t } = useI18n();
  const syncServiceConfigured = isSupabaseConfigured();
  const [binding, setBinding] = useState<StoredSyncBinding | null>(null);
  const [syncCode, setSyncCode] = useState("");
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
      void showAlert(failureMessage);
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

    setError(t("settings.sync.cloudProtectFailed"));
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
  }, [getSyncRepository, onBeforeCloudOverwrite, t]);

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
      setMessage(t("settings.sync.serviceNotConfigured"));
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
          setMessage(t("settings.sync.otherTabBusy"));
        }
      } else {
        await action();
      }
    } catch (actionError) {
      console.error(actionError);
      const activeBinding = bindingRef.current;
      captureClientError(actionError, {
        eventType: "async_operation_failed",
        operation: options.operation ? `sync.${options.operation}` : "sync.action",
        properties: {
          accessMode: activeBinding?.accessMode ?? "none",
          source: "sync-panel",
          supabaseConfigured: syncServiceConfigured,
          syncStatus: documentRef.current.syncMeta.status
        },
        severity: isLikelyOfflineError(actionError) ? "warning" : "error"
      });
      setError(getErrorMessage(actionError, t("settings.sync.actionFailed")));
      if (pausedBinding) {
        setSyncMetaFromBinding(pausedBinding, "paused", t("settings.sync.paused"));
        setMessage(t("settings.sync.stillPaused"));
        return;
      }

      if (activeBinding) {
        setSyncMetaFromBinding(activeBinding, isLikelyOfflineError(actionError) ? "offline" : "error", t("settings.sync.failed"));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [setSyncMetaFromBinding, syncServiceConfigured, t]);

  const applyCloudDocument = useCallback((
    pulled: PullSyncSpaceResult,
    activeBinding: StoredSyncBinding,
    statusMessage: string,
    snapshotSource: LocalHomeSnapshotSource
  ): boolean => {
    if (!protectBeforeOverwrite(snapshotSource, t("settings.sync.localProtectFailed"))) {
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
  }, [onReplaceDocument, persistBinding, protectBeforeOverwrite, t]);

  const performPull = useCallback(async (options: { forceApply: boolean; source: "auto" | "manual" | "resolve" | "startup" }) => {
    const activeBinding = bindingRef.current;
    if (!activeBinding) {
      setError(t("settings.sync.createOrEnterRequired"));
      return;
    }

    if (documentRef.current.syncMeta.status === "conflict" && !options.forceApply) {
      setMessage(t("settings.sync.conflictChooseFirst"));
      return;
    }

    await runSyncAction(async () => {
      const localDocument = documentRef.current;
      const shouldApplyCloudVersion = options.forceApply
        && (localDocument.syncMeta.status === "conflict" || isSyncPausedForBinding(localDocument, activeBinding));

      setSyncMetaFromBinding(activeBinding, "syncing", t("settings.sync.pulling"));
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
        setSyncMetaFromBinding(nextBinding, hasPendingLocalChanges ? "linked" : "synced", hasPendingLocalChanges ? t("settings.sync.localChangesPending") : t("settings.sync.upToDate"));
        if (!hasPendingLocalChanges && hasHomeDocumentContentDrift(localDocument, pulled.document)) {
          const refreshed = applyCloudDocument(
            pulled,
            nextBinding,
            t("settings.sync.localRefreshed"),
            "before-cloud-pull"
          );
          if (refreshed) {
            setMessage(t("settings.sync.localRefreshedFromCloud"));
            recordLocalAuditEvent({
              documentId: pulled.document.documentId,
              message: "云端版本号未变化，但本地内容与云端不一致，已重新应用云端首页。",
              metadata: {
                remoteRevision: pulled.revision,
                source: options.source
              },
              spaceId: activeBinding.spaceId,
              type: "sync.same_revision_cloud_refresh"
            });
          }
          return;
        }
        if (shouldAuditPullSource(options.source)) {
          setMessage(hasPendingLocalChanges ? t("settings.sync.noCloudChangesLocalPending") : t("settings.sync.noCloudChanges"));
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
        setSyncMetaFromBinding(conflictBinding, "conflict", t("settings.sync.cloudAndLocalChanged"));
        setMessage(t("settings.sync.conflictDetectedCloudLocal"));
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
      if (shouldConfirmCloudPull(options.source) && !(await requestConfirm(getCloudPullConfirmMessage(options.source, t)))) {
        setSyncMetaFromBinding(activeBinding, getCancelSyncStatus(localDocument), t("settings.sync.pullCancelled"));
        setMessage(t("settings.sync.pullCancelledLocalUnchanged"));
        return;
      }

      const cloudDocumentApplied = applyCloudDocument(
        pulled,
        activeBinding,
        options.source === "auto" ? t("settings.sync.autoPulled") : t("settings.sync.pulled"),
        snapshotSource
      );
      if (!cloudDocumentApplied) {
        setSyncMetaFromBinding(activeBinding, localDocument.syncMeta.status, t("settings.sync.pullCancelled"));
        return;
      }

      setMessage(options.source === "auto" ? t("settings.sync.autoPulledMessage") : t("settings.sync.pulledMessage"));
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
  }, [applyCloudDocument, getSyncRepository, persistBinding, runSyncAction, setSyncMetaFromBinding, t]);

  const performAutoRevisionCheck = useCallback(async () => {
    const activeBinding = bindingRef.current;
    if (
      !activeBinding
      || busyRef.current
      || documentRef.current.syncMeta.status === "conflict"
      || isSyncPausedForBinding(documentRef.current, activeBinding)
      || editorOpenRef.current
      || hasPendingDialog()
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
        setSyncMetaFromBinding(nextBinding, hasPendingLocalChanges ? "linked" : "synced", hasPendingLocalChanges ? t("settings.sync.localChangesPending") : t("settings.sync.noCloudChangesShort"));
      }
    }, {
      exposeBusy: false,
      operation: "check",
      spaceId: activeBinding.spaceId
    });

    if (shouldPull && bindingRef.current) {
      await performPull({ forceApply: false, source: "auto" });
    }
  }, [getSyncRepository, performPull, persistBinding, runSyncAction, setSyncMetaFromBinding, t]);

  const performPush = useCallback(async (options: { force: boolean; source: "auto" | "manual" | "resolve" }) => {
    const activeBinding = bindingRef.current;
    if (!activeBinding) {
      setError(t("settings.sync.createOrEnterRequired"));
      return;
    }

    const localDocument = documentRef.current;
    if (localDocument.syncMeta.status === "conflict" && !options.force) {
      setMessage(t("settings.sync.conflictChooseFirst"));
      return;
    }

    if (!options.force && !hasLocalDocumentChanges(localDocument, activeBinding)) {
      setMessage(t("settings.sync.noLocalChangesToUpload"));
      return;
    }

    const localClassification = classifyHomeDocument(localDocument);
    if (options.source !== "auto" && !(await requestConfirm(getCloudOverwriteConfirmMessage(localClassification, options.force, t)))) {
      setMessage(t("settings.sync.uploadCancelledCloudUnchanged"));
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

      setSyncMetaFromBinding(activeBinding, "syncing", t("settings.sync.uploading"));
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
        setSyncMetaFromBinding(nextBinding, "synced", t("settings.sync.localOverwroteCloud"));
        setMessage(t("settings.sync.localOverwroteCloudMessage"));
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
        setSyncMetaFromBinding(conflictBinding, "conflict", t("settings.sync.cloudUpdated"));
        setMessage(t("settings.sync.conflictDetectedCloudUpdated"));
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
      setSyncMetaFromBinding(nextBinding, "synced", options.source === "auto" ? t("settings.sync.autoUploaded") : t("settings.sync.uploaded"));
      setMessage(options.source === "auto" ? t("settings.sync.autoUploadedMessage") : t("settings.sync.uploadedMessage"));
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
  }, [getSyncRepository, persistBinding, protectCloudBeforeOverwrite, runSyncAction, setSyncMetaFromBinding, t]);

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
      setMessage(t("settings.sync.localBindingLoadedServiceMissing"));
      setError("");
      return;
    }

    if (isSyncPausedForBinding(documentRef.current, storedBinding)) {
      setMessage(t("settings.sync.pausedChooseAction"));
      return;
    }

    setSyncMetaFromBinding(
      storedBinding,
      "linked",
      storedBinding.accessMode === "account-managed" ? t("settings.sync.accountManagedBindingLoaded") : t("settings.sync.syncCodeLoaded")
    );
    window.setTimeout(() => {
      performPull({ forceApply: false, source: "startup" });
    }, 0);
  }, [onBindingChange, performPull, persistBinding, setSyncMetaFromBinding, storageReady, syncServiceConfigured, t]);

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
        setSyncMetaFromBinding(activeBinding, "paused", t("settings.sync.paused"));
        setMessage(t("settings.sync.systemDocumentAutoUploadStopped"));
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

    let cancelled = false;
    autoPushTimerRef.current = setTimeout(() => {
      // An open confirm dialog may still change the document; push once it is answered.
      void waitForDialogsClosed().then(() => {
        if (!cancelled) {
          performPush({ force: false, source: "auto" });
        }
      });
    }, AUTO_PUSH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (autoPushTimerRef.current) {
        clearTimeout(autoPushTimerRef.current);
      }
    };
  }, [binding, documentValue, performPush, setSyncMetaFromBinding, syncServiceConfigured, t]);

  return {
    binding,
    setBinding,
    bindingRef,
    bindingRepositoryRef,
    busy,
    documentRef,
    error,
    setError,
    getSyncRepository,
    message,
    setMessage,
    performPull,
    performPush,
    persistBinding,
    protectBeforeOverwrite,
    runSyncAction,
    setSyncMetaFromBinding,
    syncCode,
    setSyncCode,
    syncServiceConfigured
  };
}

function shouldConfirmCloudPull(source: "auto" | "manual" | "resolve" | "startup"): boolean {
  return source === "manual" || source === "resolve";
}

function getCloudPullConfirmMessage(source: "auto" | "manual" | "resolve" | "startup", t: I18nTranslate): string {
  const action = source === "resolve" ? t("settings.sync.useCloud") : t("settings.sync.pullCloudHome");

  return [
    t("settings.sync.confirmCloudPullOverwrite", { action }),
    t("settings.sync.confirmSaveLocalBeforeOverwrite"),
    t("settings.common.confirm")
  ].join("\n");
}

function getCloudOverwriteConfirmMessage(
  classification: ReturnType<typeof classifyHomeDocument>,
  force: boolean,
  t: I18nTranslate
): string {
  const overwriteLine = force
    ? t("settings.sync.confirmForceCloudOverwrite")
    : t("settings.sync.confirmCloudOverwrite");

  if (classification.isUserData) {
    return [
      overwriteLine,
      t("settings.sync.confirmSaveCloudBeforeOverwrite"),
      t("settings.common.confirm")
    ].join("\n");
  }

  return [
    t("settings.sync.confirmSystemDocument", { class: formatSettingsHomeDocumentClass(classification.documentClass, t) }),
    overwriteLine,
    t("settings.sync.confirmSaveCloudBeforeOverwrite"),
    t("settings.common.confirm")
  ].join("\n");
}

export function toSyncMeta(binding: StoredSyncBinding, status: HomeSyncMeta["status"]): HomeSyncMeta {
  return {
    mode: "sync-code",
    status,
    provider: "supabase",
    spaceId: binding.spaceId,
    remoteRevision: binding.remoteRevision,
    lastSyncedAt: binding.lastSyncedAt
  };
}

export function localSyncMeta(): HomeSyncMeta {
  return {
    mode: "local",
    status: "local-only",
    provider: null,
    spaceId: null,
    remoteRevision: null,
    lastSyncedAt: null
  };
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

function hasHomeDocumentContentDrift(localDocument: HomeDocumentV2, cloudDocument: HomeDocumentV2): boolean {
  return createHomeDocumentContentFingerprint(localDocument) !== createHomeDocumentContentFingerprint(cloudDocument);
}

function getCancelSyncStatus(documentValue: HomeDocumentV2): HomeSyncMeta["status"] {
  return documentValue.syncMeta.mode === "sync-code" && documentValue.syncMeta.status !== "local-only"
    ? documentValue.syncMeta.status
    : "linked";
}

function shouldAuditPullSource(source: "auto" | "manual" | "resolve" | "startup"): boolean {
  return source === "manual" || source === "resolve";
}

export function isSyncPausedForBinding(documentValue: HomeDocumentV2, binding: StoredSyncBinding): boolean {
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
