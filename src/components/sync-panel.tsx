"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { HomeSpace } from "@/domain/account";
import { HomeDocumentV2, HomeSyncMeta } from "@/domain/home-document";
import {
  createSyncSecrets,
  formatSyncCode,
  parseSyncCode,
  StoredSyncBinding
} from "@/domain/sync-code";
import { StatusMessage } from "@/components/status-message";
import { useI18n } from "@/hooks/use-i18n";
import {
  isSyncPausedForBinding,
  localSyncMeta,
  toSyncMeta,
  useSyncEngine
} from "@/hooks/use-sync-engine";
import { recordLocalAuditEvent } from "@/infrastructure/local-audit-log-repository";
import type { LocalHomeSnapshotSource } from "@/infrastructure/local-home-snapshot-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";
import type { I18nTranslate } from "@/i18n/messages";

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
  const { format, t } = useI18n();
  const {
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
  } = useSyncEngine({
    documentValue,
    editorOpen,
    storageReady,
    visible,
    onBeforeCloudOverwrite,
    onBeforeOverwrite,
    onReplaceDocument,
    onSyncMetaChange,
    onBindingChange
  });
  const [inputCode, setInputCode] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
      return binding ? t("settings.sync.statusBindingSavedServiceMissing") : t("settings.sync.statusServiceMissing");
    }

    if (!binding) {
      return t("settings.sync.statusUnbound");
    }

    const syncedAt = binding.lastSyncedAt ? format.shortDateTime(binding.lastSyncedAt) : t("settings.sync.neverSynced");
    const accessMode = binding.accessMode === "account-managed" ? t("settings.sync.access.accountManaged") : t("settings.sync.access.syncCode");
    if (isConflict) {
      if (isAccountSyncContext && shouldUseAccountManagedStatusSlot) {
        return t("settings.sync.statusConflictInAccount", { time: syncedAt });
      }

      return t("settings.sync.statusConflict", { mode: accessMode, time: syncedAt });
    }

    if (isPaused) {
      if (isAccountSyncContext && shouldUseAccountManagedStatusSlot) {
        return t("settings.sync.statusPausedInAccount", { time: syncedAt });
      }

      return t("settings.sync.statusPaused", { mode: accessMode, time: syncedAt });
    }

    return t("settings.sync.statusSynced", { mode: accessMode, revision: binding.remoteRevision, time: syncedAt });
  }, [binding, format, isAccountSyncContext, isConflict, isPaused, shouldUseAccountManagedStatusSlot, syncServiceConfigured, t]);
  const panelTitle = isAdvanced ? t("settings.advanced.syncTitleSignedIn") : t("settings.advanced.syncTitleLocal");
  const syncStatusMessage = error
    || (shouldUseAccountManagedStatusSlot ? "" : message)
    || (!syncServiceConfigured ? t("settings.sync.serviceNotConfigured") : "");
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
      setSyncMetaFromBinding(nextBinding, "synced", t("settings.sync.codeCreated"));
      setMessage(t("settings.sync.codeCreatedSave"));
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

      if (!window.confirm(getBindConfirmMessage(isAdvanced, t))) {
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

      if (!protectBeforeOverwrite("before-sync-code-bind", t("settings.sync.bindProtectFailed"))) {
        return;
      }

      persistBinding(nextBinding);
      setSyncCode(formatSyncCode(nextBinding));
      setInputCode("");
      onReplaceDocument({
        ...pulled.document,
        syncMeta: toSyncMeta(nextBinding, "synced")
      }, t("settings.sync.boundAndPulled"));
      setMessage(t("settings.sync.bound"));
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
      setMessage(t("settings.sync.codeCopied"));
      setError("");
    } catch {
      setError(t("settings.sync.copyFailed"));
    }
  }

  function unbindLocal() {
    if (!window.confirm(getUnbindConfirmMessage(currentAccountHomeSpace, t))) {
      return;
    }

    const previousBinding = bindingRef.current;
    bindingRepositoryRef.current?.clear();
    bindingRef.current = null;
    setBinding(null);
    onBindingChange?.(null);
    setSyncCode("");
    onSyncMetaChange(localSyncMeta(), previousBinding?.accessMode === "account-managed" ? t("settings.sync.accountManagedUnbound") : t("settings.sync.syncCodeUnbound"));
    setMessage(t("settings.sync.localUnbound"));
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
    setMessage(t("settings.sync.resetBackupRestored"));
    setError("");
  }

  async function revokeCode() {
    const activeBinding = bindingRef.current;
    if (!activeBinding) {
      return;
    }

    if (activeBinding.accessMode === "account-managed") {
      setMessage(t("settings.sync.accountManagedCannotRevokeHere"));
      setError("");
      return;
    }

    if (!window.confirm(getRevokeConfirmMessage(currentAccountHomeSpace, t))) {
      return;
    }

    await runSyncAction(async () => {
      await getSyncRepository().revoke(activeBinding);
      bindingRepositoryRef.current?.clear();
      bindingRef.current = null;
      setBinding(null);
      onBindingChange?.(null);
      setSyncCode("");
      onSyncMetaChange(localSyncMeta(), t("settings.sync.codeRevoked"));
      setMessage(t("settings.sync.codeRevokedMessage"));
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
        <strong>{t("settings.sync.paused")}</strong>
        <p>{t("settings.sync.pausedDescription")}</p>
      </div>
      <div className="sync-panel-actions">
        <button className="utility-button" type="button" onClick={() => performPush({ force: false, source: "manual" })} disabled={!syncServiceConfigured || busy} title={getRemoteActionDisabledReason(syncServiceConfigured, busy, t) ?? t("settings.sync.uploadLocalTitle")}>{t("settings.sync.uploadLocal")}</button>
        <button className="utility-button" type="button" onClick={() => performPull({ forceApply: true, source: "manual" })} disabled={!syncServiceConfigured || busy} title={getRemoteActionDisabledReason(syncServiceConfigured, busy, t) ?? t("settings.sync.pullCloudTitle")}>{t("settings.sync.pullCloud")}</button>
        <button className="utility-button" type="button" onClick={unbindLocal} disabled={busy} title={busy ? t("settings.sync.operationPending") : t("settings.sync.unbindLocalTitle")}>{t("settings.sync.unbindLocal")}</button>
        <button className="utility-button" type="button" onClick={restoreResetBackupFromPause} disabled={busy || !hasResetBackup || !onRestoreResetBackup} title={getRestoreBackupDisabledReason(busy, hasResetBackup, Boolean(onRestoreResetBackup), t) ?? t("settings.sync.restoreBackupTitle")}>{t("settings.sync.restoreBackup")}</button>
      </div>
    </div>
  );
  const conflictNotice = (
    <div className="sync-conflict" role="status">
      <div>
        <strong>{t("settings.sync.cloudAndLocalChanged")}</strong>
        <p>{t("settings.sync.conflictDescription")}</p>
      </div>
      <div className="sync-panel-actions">
        <button className="utility-button" type="button" onClick={() => performPull({ forceApply: true, source: "resolve" })} disabled={!syncServiceConfigured || busy} title={getRemoteActionDisabledReason(syncServiceConfigured, busy, t) ?? t("settings.sync.useCloudTitle")}>{t("settings.sync.useCloud")}</button>
        <button className="danger-button" type="button" onClick={() => performPush({ force: true, source: "resolve" })} disabled={!syncServiceConfigured || busy} title={getRemoteActionDisabledReason(syncServiceConfigured, busy, t) ?? t("settings.sync.localOverwriteCloudTitle")}>{t("settings.sync.localOverwriteCloud")}</button>
        <button className="utility-button" type="button" onClick={() => setMessage(t("settings.sync.conflictKept"))} disabled={busy} title={busy ? t("settings.sync.operationPending") : t("settings.sync.keepConflictTitle")}>{t("settings.sync.keepConflict")}</button>
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
            title={needsAttention ? t("settings.sync.handleAttentionFirst") : controlsVisible ? t("settings.sync.collapseAdvancedTitle") : t("settings.sync.expandAdvancedTitle")}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            {controlsVisible ? t("settings.sync.collapseAdvanced") : t("settings.sync.expandAdvanced")}
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
            <p className="sync-managed-note">{t("settings.sync.accountManagedNote")}</p>
          ) : (
            <div className="sync-code-grid">
              <label className="field">
                <span>{t("settings.sync.currentCode")}</span>
                <input
                  value={syncCode}
                  readOnly
                  placeholder={t("settings.sync.currentCodePlaceholder")}
                />
              </label>
              <button className="utility-button" type="button" onClick={copyCode} disabled={!syncCode} title={syncCode ? t("settings.sync.copyCodeTitle") : t("settings.sync.noCodeToCopyTitle")}>{t("settings.sync.copy")}</button>
            </div>
          )}

          <div className="sync-code-grid">
            <label className="field">
              <span>{isAdvanced ? t("settings.sync.enterCodeRestore") : t("settings.sync.enterCode")}</span>
              <input value={inputCode} onChange={(event) => setInputCode(event.target.value)} placeholder="hp1_..." />
            </label>
            <button className="utility-button" type="button" onClick={bindCode} disabled={!syncServiceConfigured || busy || !inputCode.trim()} title={getBindDisabledReason(syncServiceConfigured, busy, inputCode, t) ?? t("settings.sync.bindCodeTitle")}>{t("settings.sync.bind")}</button>
          </div>

          {isAdvanced ? (
            <p className="sync-boundary-note">{getBoundaryNote(currentAccountHomeSpace, isAccountManaged, t)}</p>
          ) : null}

          <div className="sync-panel-footer">
            <div className="sync-panel-actions">
              <button className="utility-button" type="button" onClick={unbindLocal} disabled={!binding} title={binding ? t("settings.sync.unbindLocalTitle") : t("settings.sync.noBindingTitle")}>{t("settings.sync.unbindLocal")}</button>
              {!isAccountManaged ? (
                <button
                  className="danger-button"
                  type="button"
                  onClick={revokeCode}
                  disabled={!syncServiceConfigured || busy || !binding}
                  title={getRevokeDisabledReason(syncServiceConfigured, busy, binding, t) ?? t("settings.sync.revokeCodeTitle")}
                >
                  {t("settings.sync.revokeCode")}
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
          {syncStatusMessage || t("settings.sync.advancedCollapsed")}
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
  const { t } = useI18n();
  const createDisabledReason = getCreateDisabledReason(serviceConfigured, busy, isPaused, t);
  const pullDisabledReason = getPullDisabledReason(serviceConfigured, busy, binding, isPaused, t);
  const pushDisabledReason = getPushDisabledReason(serviceConfigured, busy, binding, isPaused, status, t);

  return (
    <div className="sync-panel-actions">
      {!isAccountManaged ? (
        <button
          className="utility-button"
          type="button"
          onClick={onCreate}
          disabled={!serviceConfigured || busy || isPaused}
          title={createDisabledReason ?? t("settings.sync.createCodeTitle")}
        >
          {t("settings.sync.create")}
        </button>
      ) : null}
      <button
        className="utility-button"
        type="button"
        onClick={onPull}
        disabled={!serviceConfigured || busy || !binding || isPaused}
        title={pullDisabledReason ?? t("settings.sync.pullTitle")}
      >
        {t("settings.sync.pull")}
      </button>
      <button
        className="utility-button"
        type="button"
        onClick={onPush}
        disabled={!serviceConfigured || busy || !binding || isPaused || status === "conflict"}
        title={pushDisabledReason ?? t("settings.sync.pushTitle")}
      >
        {t("settings.sync.push")}
      </button>
    </div>
  );
}

function getCreateDisabledReason(serviceConfigured: boolean, busy: boolean, isPaused: boolean, t: I18nTranslate): string | undefined {
  if (!serviceConfigured) {
    return t("settings.sync.serviceNotConfigured");
  }

  if (busy) {
    return t("settings.sync.operationPending");
  }

  if (isPaused) {
    return t("settings.sync.pausedChooseAction");
  }

  return undefined;
}

function getRemoteActionDisabledReason(serviceConfigured: boolean, busy: boolean, t: I18nTranslate): string | undefined {
  if (!serviceConfigured) {
    return t("settings.sync.serviceNotConfigured");
  }

  if (busy) {
    return t("settings.sync.operationPending");
  }

  return undefined;
}

function getPullDisabledReason(
  serviceConfigured: boolean,
  busy: boolean,
  binding: StoredSyncBinding | null,
  isPaused: boolean,
  t: I18nTranslate
): string | undefined {
  if (!serviceConfigured) {
    return t("settings.sync.serviceNotConfigured");
  }

  if (busy) {
    return t("settings.sync.operationPending");
  }

  if (!binding) {
    return t("settings.sync.createOrBindRequired");
  }

  if (isPaused) {
    return t("settings.sync.pausedUsePull");
  }

  return undefined;
}

function getPushDisabledReason(
  serviceConfigured: boolean,
  busy: boolean,
  binding: StoredSyncBinding | null,
  isPaused: boolean,
  status: HomeSyncMeta["status"],
  t: I18nTranslate
): string | undefined {
  if (!serviceConfigured) {
    return t("settings.sync.serviceNotConfigured");
  }

  if (busy) {
    return t("settings.sync.operationPending");
  }

  if (!binding) {
    return t("settings.sync.createOrBindRequired");
  }

  if (isPaused) {
    return t("settings.sync.pausedUseUpload");
  }

  if (status === "conflict") {
    return t("settings.sync.conflictChooseFirst");
  }

  return undefined;
}

function getBindDisabledReason(serviceConfigured: boolean, busy: boolean, inputCode: string, t: I18nTranslate): string | undefined {
  if (!serviceConfigured) {
    return t("settings.sync.serviceNotConfigured");
  }

  if (busy) {
    return t("settings.sync.operationPending");
  }

  if (!inputCode.trim()) {
    return t("settings.sync.enterFullCode");
  }

  return undefined;
}

function getRevokeDisabledReason(serviceConfigured: boolean, busy: boolean, binding: StoredSyncBinding | null, t: I18nTranslate): string | undefined {
  if (!serviceConfigured) {
    return t("settings.sync.serviceNotConfigured");
  }

  if (busy) {
    return t("settings.sync.operationPending");
  }

  if (!binding) {
    return t("settings.sync.noCodeBinding");
  }

  return undefined;
}

function getRestoreBackupDisabledReason(
  busy: boolean,
  hasResetBackup: boolean,
  canRestoreResetBackup: boolean,
  t: I18nTranslate
): string | undefined {
  if (busy) {
    return t("settings.sync.operationPending");
  }

  if (!canRestoreResetBackup) {
    return t("settings.sync.restoreBackupUnsupported");
  }

  if (!hasResetBackup) {
    return t("settings.sync.noResetBackup");
  }

  return undefined;
}

function getBoundaryNote(homeSpace: HomeSpace | null, isAccountManaged: boolean, t: I18nTranslate): string {
  if (isAccountManaged) {
    return homeSpace
      ? t("settings.sync.boundaryAccountManagedNamed", { space: homeSpace.name })
      : t("settings.sync.boundaryAccountManaged");
  }

  if (homeSpace?.accessMode === "sync-code") {
    return t("settings.sync.boundarySyncCodeInAccount", { space: homeSpace.name });
  }

  return t("settings.sync.boundaryLocalSyncCode");
}

function getBindConfirmMessage(isAdvanced: boolean, t: I18nTranslate): string {
  return [
    t("settings.sync.confirmBindOverwrite"),
    isAdvanced ? t("settings.sync.confirmBindAdvancedBoundary") : "",
    t("settings.common.confirm")
  ].filter(Boolean).join("\n");
}

function getUnbindConfirmMessage(homeSpace: HomeSpace | null, t: I18nTranslate): string {
  if (homeSpace?.accessMode === "account-managed") {
    return [
      t("settings.sync.confirmUnbindManagedTitle", { space: homeSpace.name }),
      t("settings.sync.confirmUnbindKeepsLocal"),
      t("settings.sync.confirmUnbindManagedKeepsAccount"),
      t("settings.common.confirm")
    ].join("\n");
  }

  if (homeSpace?.accessMode === "sync-code") {
    return [
      t("settings.sync.confirmUnbindSyncTitle", { space: homeSpace.name }),
      t("settings.sync.confirmUnbindSyncKeepsLocal"),
      t("settings.sync.confirmUnbindSyncKeepsAccount"),
      t("settings.common.confirm")
    ].join("\n");
  }

  return t("settings.sync.confirmUnbindLocal");
}

function getRevokeConfirmMessage(homeSpace: HomeSpace | null, t: I18nTranslate): string {
  if (homeSpace?.accessMode === "sync-code") {
    return [
      t("settings.sync.confirmRevokeSyncTitle", { space: homeSpace.name }),
      t("settings.sync.confirmRevokeAllDevices"),
      t("settings.sync.confirmRevokeKeepsAccountIndex"),
      t("settings.sync.confirmRevokeUseUnbind"),
      t("settings.sync.confirmRevoke")
    ].join("\n");
  }

  return t("settings.sync.confirmRevokeGeneric");
}
