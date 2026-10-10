"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccountPanel } from "@/components/account-panel";
import {
  AccountPreferencesPanel,
  formatPreferenceLocaleLabel,
  formatPreferenceSearchEngineLabel
} from "@/components/account-preferences-panel";
import { BookmarkImportPanel } from "@/components/bookmark-import-panel";
import { DataRecoveryCenterPanel } from "@/components/data-recovery-center-panel";
import { DeviceStatusPanel } from "@/components/device-status-panel";
import { HomeSpacesPanel } from "@/components/home-spaces-panel";
import { HomeThemeStyleBridge } from "@/components/home-theme-style-bridge";
import { HomepageGuideButton } from "@/components/homepage-guide";
import { LocalAuditLogPanel } from "@/components/local-audit-log-panel";
import { ProductAnalyticsSettingsPanel } from "@/components/product-analytics-settings-panel";
import { PublicHomeSharePanel } from "@/components/public-home-share-panel";
import { SettingsSection } from "@/components/settings-section";
import { StatusMessage, type StatusTone } from "@/components/status-message";
import { SyncPanel } from "@/components/sync-panel";
import { ThemeImagePanel } from "@/components/theme-image-panel";
import { ThemePresetPanel } from "@/components/theme-preset-panel";
import type { HomeSpace } from "@/domain/account";
import { buildHomepageDataExportV1, downloadJsonFile } from "@/domain/data-export";
import { parseHomepageDataRestore, type ParsedHomepageDataRestore } from "@/domain/data-restore";
import type { HomeDocumentV2, HomeSyncMeta } from "@/domain/home-document";
import type { SettingsSectionId } from "@/domain/settings-layout";
import { parseSyncCode, type StoredSyncBinding } from "@/domain/sync-code";
import { getHomeThemePreset, normalizeHomeThemePresetId } from "@/domain/theme-preset";
import { useAccountData } from "@/hooks/use-account-data";
import { useHomeDocumentController } from "@/hooks/use-home-document-controller";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsLayoutPreferences } from "@/hooks/use-settings-layout-preferences";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";
import { LocalAuditLogRepository, recordLocalAuditEvent } from "@/infrastructure/local-audit-log-repository";
import type { CloudHomeSnapshot } from "@/infrastructure/cloud-home-snapshot-repository";
import { LocalDeviceRepository } from "@/infrastructure/local-device-repository";
import type { LocalHomeSnapshotSource } from "@/infrastructure/local-home-snapshot-repository";
import { summarizeDocumentForAnalytics } from "@/domain/product-analytics";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";
import { LocalSyncBindingRepository } from "@/infrastructure/sync-binding-repository";
import { SyncCodeRepository } from "@/infrastructure/sync-code-repository";
import {
  formatSettingsSnapshotAssets,
  formatSettingsThemePresetName
} from "@/i18n/settings-presentation";

interface DataPackageRestoreDialogState extends ParsedHomepageDataRestore {
  fileName: string;
}

const ACCOUNT_MANAGED_SYNC_STATUS_SLOT_ID = "account-managed-sync-status-slot";

export function SettingsDashboard() {
  const auth = useSupabaseAuth();
  const accountData = useAccountData(auth.user);
  const uiPreferences = useUiPreferences();
  const { format, t } = useI18n();
  const settingsLayout = useSettingsLayoutPreferences();
  const [currentBinding, setCurrentBinding] = useState<StoredSyncBinding | null>(null);
  const [advancedActionMessage, setAdvancedActionMessage] = useState("");
  const [advancedActionError, setAdvancedActionError] = useState("");
  const [syncPanelKey, setSyncPanelKey] = useState(0);
  const [dataPackageRestore, setDataPackageRestore] = useState<DataPackageRestoreDialogState | null>(null);
  const [recoverySectionStatus, setRecoverySectionStatus] = useState<{ text: string; tone: StatusTone } | null>(null);
  const {
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
  } = useHomeDocumentController();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const dataPackageImportInputRef = useRef<HTMLInputElement | null>(null);
  const settingsOpenedTrackedRef = useRef(false);
  const signedIn = Boolean(auth.user);
  const handleBeforeOverwrite = useCallback((source: LocalHomeSnapshotSource) => {
    return protectBeforeDangerousOverwrite(source).canContinue;
  }, [protectBeforeDangerousOverwrite]);
  const handleBeforeCloudOverwrite = useCallback((documentValue: HomeDocumentV2, source: LocalHomeSnapshotSource) => {
    return protectDocumentBeforeDangerousOverwrite(documentValue, source).canContinue;
  }, [protectDocumentBeforeDangerousOverwrite]);

  useEffect(() => {
    if (!storageReady || settingsOpenedTrackedRef.current) {
      return;
    }

    settingsOpenedTrackedRef.current = true;
    trackProductEvent("settings.opened", {
      ...summarizeDocumentForAnalytics(homeDocument),
      hasSyncBinding: Boolean(currentBinding),
      signedIn
    });
  }, [currentBinding, homeDocument, signedIn, storageReady]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    try {
      await importJson(event.target.files?.[0]);
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  function handleResetDefault() {
    if (!currentBinding) {
      resetDefault();
      return;
    }

    resetDefault({
      confirmMessage: t("settings.advanced.resetDefaultConfirmBound"),
      syncMeta: toSyncMeta(currentBinding, "paused"),
      successMessage: t("settings.advanced.resetDefaultSuccessBound")
    });
  }

  function handleExportDataPackage() {
    setAdvancedActionMessage("");
    setAdvancedActionError("");

    try {
      const auditEvents = new LocalAuditLogRepository(window.localStorage).load();
      const device = new LocalDeviceRepository(window.localStorage).load();
      const exportValue = buildHomepageDataExportV1({
        account: {
          signedIn,
          loading: auth.loading || accountData.loading,
          error: auth.error || accountData.error,
          userId: auth.user?.id ?? null,
          userEmail: auth.user?.email ?? null,
          profile: accountData.profile,
          preferences: accountData.preferences,
          homeSpaces: accountData.homeSpaces
        },
        local: {
          homeDocument,
          hasStoredDocument,
          hasResetBackup,
          storageReady,
          currentBinding,
          auditEvents,
          device
        }
      });

      downloadJsonFile(exportValue, "homepage-data-export");
      setAdvancedActionMessage(t("settings.advanced.dataPackageExported"));
      trackProductEvent("data_package.exported", {
        ...summarizeDocumentForAnalytics(homeDocument),
        hasSyncBinding: Boolean(currentBinding),
        signedIn
      });
      recordLocalAuditEvent({
        documentId: homeDocument.documentId,
        message: "已导出首页数据包。",
        metadata: {
          auditEventCount: auditEvents.length,
          hasDeviceRecord: Boolean(device)
        },
        spaceId: currentBinding?.spaceId ?? null,
        type: "data_package.export"
      });
    } catch (error) {
      console.error(error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "data_package.export",
        properties: {
          hasSyncBinding: Boolean(currentBinding),
          source: "settings-dashboard",
          storageReady
        },
        severity: "error"
      });
      setAdvancedActionError(error instanceof Error ? error.message : t("settings.advanced.dataPackageExportFailed"));
    }
  }

  async function handleDataPackageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setAdvancedActionMessage("");
    setAdvancedActionError("");

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const restore = parseHomepageDataRestore(parsed);
      setDataPackageRestore({
        ...restore,
        fileName: file.name
      });
      setAdvancedActionMessage(t("settings.advanced.dataPackagePreviewReady"));
      trackProductEvent("data_package.restore_previewed", {
        groupCountBucket: summarizeCount(restore.preview.groupCount),
        hasBanner: restore.preview.hasBanner,
        hasBackground: restore.preview.hasBackground,
        siteCountBucket: summarizeCount(restore.preview.siteCount),
        source: restore.preview.source,
        widgetCountBucket: summarizeCount(restore.preview.widgetCount)
      });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : t("settings.advanced.dataPackagePreviewFailed");
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "data_package.restore_preview",
        properties: {
          reasonCode: "preview-failed",
          source: "settings-dashboard",
          storageReady
        },
        severity: "warning"
      });
      setAdvancedActionError(message);
      trackProductEvent("data_package.restore_failed", {
        reasonCode: "preview-failed",
        source: "data-package"
      });
      recordLocalAuditEvent({
        documentId: homeDocument.documentId,
        level: "warning",
        message: "数据包恢复预览失败。",
        metadata: {
          fileName: file.name,
          reason: message
        },
        spaceId: currentBinding?.spaceId ?? null,
        type: "data_package.restore_preview_failed"
      });
    } finally {
      if (dataPackageImportInputRef.current) {
        dataPackageImportInputRef.current.value = "";
      }
    }
  }

  function handleConfirmDataPackageRestore() {
    if (!dataPackageRestore) {
      return;
    }

    const nextSyncMeta = currentBinding ? toSyncMeta(currentBinding, "paused") : localSyncMeta();
    const restored = restoreHomeDocumentWithBackup({
      ...dataPackageRestore.documentValue,
      syncMeta: nextSyncMeta
    }, currentBinding ? t("settings.advanced.dataPackageRestoredPaused") : t("settings.advanced.dataPackageRestoredLocal"));

    if (!restored) {
      return;
    }

    recordLocalAuditEvent({
      documentId: dataPackageRestore.documentValue.documentId,
      message: "已从数据包恢复首页内容。",
      metadata: {
        fileName: dataPackageRestore.fileName,
        groupCount: dataPackageRestore.preview.groupCount,
        siteCount: dataPackageRestore.preview.siteCount,
        source: dataPackageRestore.preview.source,
        syncPaused: Boolean(currentBinding),
        widgetCount: dataPackageRestore.preview.widgetCount
      },
      spaceId: currentBinding?.spaceId ?? null,
      type: "data_package.restore"
    });
    trackProductEvent("data_package.restored", {
      groupCountBucket: summarizeCount(dataPackageRestore.preview.groupCount),
      hasSyncBinding: Boolean(currentBinding),
      siteCountBucket: summarizeCount(dataPackageRestore.preview.siteCount),
      source: dataPackageRestore.preview.source,
      widgetCountBucket: summarizeCount(dataPackageRestore.preview.widgetCount)
    });

    setAdvancedActionMessage(currentBinding ? t("settings.advanced.dataPackageRestoredPaused") : t("settings.advanced.dataPackageRestoredLocal"));
    setAdvancedActionError("");
    setDataPackageRestore(null);
    setSyncPanelKey((value) => value + 1);
  }

  async function activateHomeSpace(homeSpace: HomeSpace, syncCode: string): Promise<boolean> {
    const parsed = parseSyncCode(syncCode);
    const syncRepository = new SyncCodeRepository();
    const pulled = await syncRepository.pull(parsed);
    const nextBinding: StoredSyncBinding = {
      ...parsed,
      accessMode: "sync-code",
      remoteRevision: pulled.revision,
      lastSyncedAt: pulled.updatedAt,
      lastSyncedDocumentRevision: pulled.document.revision,
      lastSyncedDocumentUpdatedAt: pulled.document.updatedAt
    };

    const metadataUpdated = await accountData.markHomeSpaceActive(homeSpace.id);
    if (!metadataUpdated) {
      return false;
    }

    new LocalSyncBindingRepository(window.localStorage).save(nextBinding);
    setCurrentBinding(nextBinding);
    replaceHomeDocument({
      ...pulled.document,
      syncMeta: toSyncMeta(nextBinding)
    }, t("settings.homeSpaces.confirmActivate"));
    setSyncPanelKey((value) => value + 1);
    return true;
  }

  async function restoreManagedHomeSpace(homeSpace: HomeSpace): Promise<boolean> {
    const result = await accountData.restoreAccountManagedHomeSpace(homeSpace.id);
    if (!result) {
      return false;
    }

    new LocalSyncBindingRepository(window.localStorage).save(result.binding);
    setCurrentBinding(result.binding);
    replaceHomeDocument({
      ...result.document,
      syncMeta: toSyncMeta(result.binding)
    }, t("settings.homeSpaces.restore"));
    setSyncPanelKey((value) => value + 1);
    return true;
  }

  async function migrateSyncCodeHomeSpace(homeSpace: HomeSpace): Promise<boolean> {
    if (!currentBinding) {
      return false;
    }

    const binding = await accountData.migrateSyncCodeHomeSpaceToAccountManaged(homeSpace.id, currentBinding);
    if (!binding) {
      return false;
    }

    new LocalSyncBindingRepository(window.localStorage).save(binding);
    setCurrentBinding(binding);
    updateSyncMeta(
      toSyncMeta(binding, homeDocument.syncMeta.status === "linked" ? "linked" : "synced"),
      t("settings.homeSpaces.migrate")
    );
    setSyncPanelKey((value) => value + 1);
    return true;
  }

  function handleManagedHomeSpaceCreated(binding: StoredSyncBinding, createdDocument: HomeDocumentV2 = homeDocument) {
    new LocalSyncBindingRepository(window.localStorage).save(binding);
    setCurrentBinding(binding);
    replaceHomeDocument({
      ...createdDocument,
      syncMeta: toSyncMeta(binding)
    }, t("settings.homeSpaces.confirmCreate"));
    setSyncPanelKey((value) => value + 1);
  }

  const currentAccountHomeSpace = currentBinding
    ? accountData.homeSpaces.find((homeSpace) => homeSpace.syncSpaceId === currentBinding.spaceId) ?? null
    : null;
  const resetDefaultTitle = getResetDefaultTitle(storageReady, isDefaultDocument, Boolean(currentBinding), t);
  const activeThemePreset = getHomeThemePreset(normalizeHomeThemePresetId(homeDocument.theme.presetId, homeDocument.theme.accent));
  const sectionSummaries = {
    account: getAccountSectionSummary({
      accountData,
      authConfigured: auth.configured,
      authError: auth.error,
      currentBinding,
      currentHomeSpace: currentAccountHomeSpace,
      signedIn,
      syncStatus: homeDocument.syncMeta.status,
      t
    }),
    homeSpaces: getHomeSpacesSectionSummary({
      accountData,
      currentHomeSpace: currentAccountHomeSpace,
      signedIn,
      t
    }),
    themeStyle: {
      summary: t("settings.summary.themeCurrent", { theme: formatSettingsThemePresetName(activeThemePreset.id, t) }),
      tone: "neutral" as StatusTone
    },
    themeImages: getThemeImagesSectionSummary(homeDocument, t),
    accountPreferences: {
      summary: `${t(signedIn ? "preferences.summaryAccount" : "preferences.summaryLocal")} · ${formatPreferenceLocaleLabel(uiPreferences.preferences.locale, t)} · ${formatPreferenceSearchEngineLabel(uiPreferences.preferences.defaultSearchEngine)}`,
      tone: uiPreferences.error ? "warning" as StatusTone : "neutral" as StatusTone
    },
    dataRecovery: recoverySectionStatus
      ? { summary: recoverySectionStatus.text, tone: recoverySectionStatus.tone }
      : {
          summary: currentAccountHomeSpace?.accessMode === "account-managed" ? t("settings.summary.recoveryCloud") : t("settings.summary.recoveryLocal"),
          tone: "neutral" as StatusTone
        },
    advanced: {
      summary: advancedActionError || advancedActionMessage || t("settings.summary.advancedDefault"),
      tone: advancedActionError ? "danger" as StatusTone : advancedActionMessage ? "success" as StatusTone : "neutral" as StatusTone
    }
  };
  const toggleSection = (sectionId: SettingsSectionId) => {
    settingsLayout.setSectionExpanded(sectionId, !settingsLayout.isSectionExpanded(sectionId));
  };
  const syncPanel = (
    <SyncPanel
      key={syncPanelKey}
      documentValue={homeDocument}
      editorOpen={false}
      accountManagedStatusTargetId={ACCOUNT_MANAGED_SYNC_STATUS_SLOT_ID}
      presentation={signedIn ? "advanced" : "primary"}
      storageReady={storageReady}
      visible
      onBeforeCloudOverwrite={handleBeforeCloudOverwrite}
      onBeforeOverwrite={handleBeforeOverwrite}
      onReplaceDocument={replaceHomeDocument}
      onSyncMetaChange={updateSyncMeta}
      onBindingChange={setCurrentBinding}
      hasResetBackup={hasResetBackup}
      currentAccountHomeSpace={currentAccountHomeSpace}
      onRestoreResetBackup={restoreResetBackup}
    />
  );
  const homeSpacesPanel = (
    <HomeSpacesPanel
      accountData={accountData}
      authLoading={auth.loading}
      embedded
      signedIn={signedIn}
      currentBinding={currentBinding}
      documentValue={homeDocument}
      storageReady={storageReady}
      onActivateHomeSpace={activateHomeSpace}
      onBeforeOverwrite={handleBeforeOverwrite}
      onRestoreManagedHomeSpace={restoreManagedHomeSpace}
      onMigrateSyncCodeHomeSpace={migrateSyncCodeHomeSpace}
      onManagedHomeSpaceCreated={handleManagedHomeSpaceCreated}
    />
  );

  return (
    <>
      <HomeThemeStyleBridge theme={homeDocument.theme} documentId={homeDocument.documentId} spaceId={homeDocument.syncMeta.spaceId} storageReady={storageReady} />
      <main className="page settings-page">
      <header className="settings-page-header">
        <div>
          <p className="eyebrow">{t("settings.shell.eyebrow")}</p>
          <h1>{t("settings.shell.title")}</h1>
        </div>
        <div className="settings-page-header-actions">
          <HomepageGuideButton />
          <Link className="utility-button" href="/">{t("settings.shell.backHome")}</Link>
        </div>
      </header>

      <div className="settings-stack">
        <SettingsSection
          id="account"
          title={t("settings.section.account.title")}
          kicker={signedIn ? t("settings.section.account.signedIn") : t("settings.section.account.magicLink")}
          summary={sectionSummaries.account.summary}
          tone={sectionSummaries.account.tone}
          expanded={settingsLayout.isSectionExpanded("account")}
          onToggle={() => toggleSection("account")}
          summarySlot={<div id={ACCOUNT_MANAGED_SYNC_STATUS_SLOT_ID} className="account-sync-action-slot" />}
        >
          <AccountPanel
            accountData={accountData}
            currentBinding={currentBinding}
            currentHomeSpace={currentAccountHomeSpace}
            embedded
            syncStatus={homeDocument.syncMeta.status}
          />
        </SettingsSection>

        <SettingsSection
          id="home-spaces"
          title={t("settings.section.homeSpaces.title")}
          kicker={signedIn ? t("settings.section.homeSpaces.count", { count: accountData.homeSpaces.length }) : t("settings.section.homeSpaces.signIn")}
          summary={sectionSummaries.homeSpaces.summary}
          tone={sectionSummaries.homeSpaces.tone}
          expanded={settingsLayout.isSectionExpanded("home-spaces")}
          onToggle={() => toggleSection("home-spaces")}
        >
          {homeSpacesPanel}
          <PublicHomeSharePanel
            key={`${auth.loading || accountData.loading}:${signedIn}:${storageReady}:${currentAccountHomeSpace?.id ?? "none"}`}
            accountLoading={auth.loading || accountData.loading}
            currentHomeSpace={currentAccountHomeSpace}
            documentValue={homeDocument}
            signedIn={signedIn}
            storageReady={storageReady}
          />
        </SettingsSection>

        <SettingsSection
          id="theme-style"
          title={t("settings.section.themeStyle.title")}
          kicker={t("settings.section.themeStyle.kicker")}
          summary={sectionSummaries.themeStyle.summary}
          tone={sectionSummaries.themeStyle.tone}
          expanded={settingsLayout.isSectionExpanded("theme-style")}
          onToggle={() => toggleSection("theme-style")}
        >
          <ThemePresetPanel
            documentValue={homeDocument}
            embedded
            storageReady={storageReady}
            onCommitDocument={commitHomeDocument}
          />
        </SettingsSection>

        <SettingsSection
          id="theme-images"
          title={t("settings.section.themeImages.title")}
          kicker={t("settings.section.themeImages.kicker")}
          summary={sectionSummaries.themeImages.summary}
          tone={sectionSummaries.themeImages.tone}
          expanded={settingsLayout.isSectionExpanded("theme-images")}
          onToggle={() => toggleSection("theme-images")}
        >
          <ThemeImagePanel
            documentValue={homeDocument}
            embedded
            storageReady={storageReady}
            userId={auth.user?.id ?? null}
            onCommitDocument={commitHomeDocument}
          />
        </SettingsSection>

        <SettingsSection
          id="account-preferences"
          title={t("preferences.title")}
          kicker={signedIn ? t("preferences.accountBadge") : t("preferences.localBadge")}
          summary={sectionSummaries.accountPreferences.summary}
          tone={sectionSummaries.accountPreferences.tone}
          expanded={settingsLayout.isSectionExpanded("account-preferences")}
          onToggle={() => toggleSection("account-preferences")}
        >
          <AccountPreferencesPanel
            accountData={accountData}
            authLoading={auth.loading}
            embedded
            signedIn={signedIn}
          />
        </SettingsSection>

        <SettingsSection
          id="data-recovery"
          title={t("settings.section.dataRecovery.title")}
          kicker={t("settings.section.dataRecovery.kicker")}
          summary={sectionSummaries.dataRecovery.summary}
          tone={sectionSummaries.dataRecovery.tone}
          expanded={settingsLayout.isSectionExpanded("data-recovery")}
          onToggle={() => toggleSection("data-recovery")}
        >
          <DataRecoveryCenterPanel
            currentHomeSpace={currentAccountHomeSpace}
            embedded
            hasSyncBinding={Boolean(currentBinding)}
            storageReady={storageReady}
            onStatusSummaryChange={setRecoverySectionStatus}
            onRestoreCloudSnapshot={(snapshot: CloudHomeSnapshot) => {
              const restored = restoreCloudSnapshot(snapshot, {
                syncMeta: currentBinding ? toSyncMeta(currentBinding, "paused") : localSyncMeta(),
                successMessage: currentBinding ? t("settings.recovery.cloudRestored") : t("settings.recovery.localRestored")
              });

              if (restored) {
                setSyncPanelKey((value) => value + 1);
              }

              return restored;
            }}
            onRestoreSnapshot={(snapshot) => {
              const restored = restoreLocalSnapshot(snapshot, {
                syncMeta: currentBinding ? toSyncMeta(currentBinding, "paused") : localSyncMeta(),
                successMessage: currentBinding ? t("settings.recovery.localRestoredPaused") : t("settings.recovery.localRestored")
              });

              if (restored) {
                setSyncPanelKey((value) => value + 1);
              }

              return restored;
            }}
          />
        </SettingsSection>

        <SettingsSection
          id="advanced"
          title={t("settings.section.advanced.title")}
          kicker={t("settings.section.advanced.kicker")}
          summary={sectionSummaries.advanced.summary}
          tone={sectionSummaries.advanced.tone}
          expanded={settingsLayout.isSectionExpanded("advanced")}
          onToggle={() => toggleSection("advanced")}
        >
          <div className="advanced-operation-grid">
            <div className="advanced-operation-block">
              <div className="advanced-operation-head">
                <h3>{signedIn ? t("settings.advanced.syncTitleSignedIn") : t("settings.advanced.syncTitleLocal")}</h3>
                <span>{t("settings.advanced.syncKicker")}</span>
              </div>
              {syncPanel}
            </div>

            <BookmarkImportPanel
              documentValue={homeDocument}
              storageReady={storageReady}
              onBeforeOverwrite={handleBeforeOverwrite}
              onCommitDocument={commitHomeDocument}
            />

            <DeviceStatusPanel
              currentBinding={currentBinding}
              currentHomeSpace={currentAccountHomeSpace}
              documentProtection={documentProtection}
              documentValue={homeDocument}
              signedIn={signedIn}
            />

            <div className="advanced-operation-block">
              <div className="advanced-operation-head">
                <h3>{t("settings.advanced.configTitle")}</h3>
                <span>{t("settings.advanced.configKicker")}</span>
              </div>
              <div className="settings-actions">
                <button className="utility-button" type="button" onClick={exportJson}>{t("settings.advanced.exportJson")}</button>
                <label className="file-button" htmlFor="settingsImportInput">{t("settings.advanced.importJson")}</label>
                <input ref={importInputRef} id="settingsImportInput" type="file" accept="application/json" hidden onChange={handleFileChange} />
                {hasResetBackup ? (
                  <button className="utility-button" type="button" onClick={restoreResetBackup} title={t("settings.advanced.restoreResetBackupTitle")}>{t("settings.advanced.restoreResetBackup")}</button>
                ) : null}
                <button
                  className="danger-button"
                  type="button"
                  onClick={handleResetDefault}
                  disabled={!storageReady || isDefaultDocument}
                  title={resetDefaultTitle}
                >
                  {t("settings.advanced.clearDefault")}
                </button>
              </div>
              <StatusMessage tone={saveStatus ? "success" : "neutral"}>
                {saveStatus || t("settings.advanced.importOverwriteHint")}
              </StatusMessage>
            </div>

            <div className="advanced-operation-block">
              <div className="advanced-operation-head">
                <h3>{t("settings.advanced.dataPackageTitle")}</h3>
                <span>{t("settings.advanced.dataPackageKicker")}</span>
              </div>
              <div className="settings-actions">
                <button
                  className="utility-button"
                  type="button"
                  disabled={!storageReady}
                  title={storageReady ? t("settings.advanced.exportDataPackageTitle") : t("settings.common.storageNotReady")}
                  onClick={handleExportDataPackage}
                >
                  {t("settings.advanced.exportDataPackage")}
                </button>
                <button
                  className="utility-button"
                  type="button"
                  disabled={!storageReady}
                  title={storageReady ? t("settings.advanced.importDataPackageTitle") : t("settings.common.storageNotReady")}
                  onClick={() => dataPackageImportInputRef.current?.click()}
                >
                  {t("settings.advanced.importDataPackage")}
                </button>
                <input
                  ref={dataPackageImportInputRef}
                  id="settingsDataPackageImportInput"
                  type="file"
                  accept="application/json"
                  hidden
                  onChange={handleDataPackageFileChange}
                />
              </div>
              <StatusMessage role={advancedActionError ? "alert" : "status"} tone={advancedActionError ? "danger" : advancedActionMessage ? "success" : "neutral"}>
                {advancedActionError || advancedActionMessage || t("settings.advanced.dataPackageDefault")}
              </StatusMessage>
            </div>

            <LocalAuditLogPanel />

            <ProductAnalyticsSettingsPanel />
          </div>
        </SettingsSection>
      </div>
      </main>

      {dataPackageRestore ? (
        <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="dataRestoreDialogTitle">
          <section className="settings-dialog settings-dialog-wide data-restore-dialog">
            <header className="settings-dialog-header">
              <div>
                <h2 id="dataRestoreDialogTitle">{t("settings.advanced.dataPackageDialogTitle")}</h2>
                <p>{dataPackageRestore.fileName}</p>
              </div>
            </header>
            <div className="settings-dialog-body">
              <div className="data-restore-summary">
                <DataRestoreStat label={t("settings.recovery.stat.title")} value={dataPackageRestore.preview.documentTitle} />
                <DataRestoreStat label={t("settings.advanced.stat.source")} value={formatRestoreSource(dataPackageRestore.preview.source, t)} />
                <DataRestoreStat label={t("settings.recovery.stat.groups")} value={String(dataPackageRestore.preview.groupCount)} />
                <DataRestoreStat label={t("settings.recovery.stat.sites")} value={String(dataPackageRestore.preview.siteCount)} />
                <DataRestoreStat label={t("settings.recovery.stat.widgets")} value={String(dataPackageRestore.preview.widgetCount)} />
                <DataRestoreStat label={t("settings.recovery.stat.theme")} value={dataPackageRestore.preview.themePresetId} />
                <DataRestoreStat label={t("settings.recovery.stat.images")} value={formatRestoreAssets(dataPackageRestore.preview.hasBanner, dataPackageRestore.preview.hasBackground, t)} />
                <DataRestoreStat label={t("settings.advanced.stat.exportedAt")} value={formatRestoreDate(dataPackageRestore.preview.exportedAt, format.dateTime, t)} />
                <DataRestoreStat label={t("settings.recovery.stat.updated")} value={formatRestoreDate(dataPackageRestore.preview.updatedAt, format.dateTime, t)} />
              </div>
              <StatusMessage tone="warning">
                {t("settings.advanced.dataPackageRestoreWarning")}
              </StatusMessage>
              {currentBinding ? (
                <StatusMessage tone="warning">
                  {t("settings.advanced.dataPackageSyncWarning")}
                </StatusMessage>
              ) : null}
              {dataPackageRestore.ignoredSections.length > 0 ? (
                <p className="data-restore-ignored">{t("settings.advanced.ignoredSections", { sections: dataPackageRestore.ignoredSections.join(", ") })}</p>
              ) : null}
            </div>
            <footer className="settings-dialog-footer">
              <button className="utility-button" type="button" onClick={() => setDataPackageRestore(null)}>{t("settings.common.cancel")}</button>
              <button className="danger-button" type="button" onClick={handleConfirmDataPackageRestore}>{t("settings.advanced.confirmRestore")}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function DataRestoreStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="data-restore-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getAccountSectionSummary({
  accountData,
  authConfigured,
  authError,
  currentBinding,
  currentHomeSpace,
  signedIn,
  syncStatus,
  t
}: {
  accountData: ReturnType<typeof useAccountData>;
  authConfigured: boolean;
  authError: string;
  currentBinding: StoredSyncBinding | null;
  currentHomeSpace: HomeSpace | null;
  signedIn: boolean;
  syncStatus: HomeSyncMeta["status"];
  t: ReturnType<typeof useI18n>["t"];
}): { summary: string; tone: StatusTone } {
  if (!authConfigured) {
    return { summary: t("settings.summary.accountServiceMissing"), tone: "warning" };
  }

  if (authError || accountData.error) {
    return { summary: authError || accountData.error, tone: "danger" };
  }

  if (syncStatus === "conflict") {
    return { summary: t("settings.summary.syncConflict"), tone: "danger" };
  }

  if (syncStatus === "paused") {
    return { summary: t("settings.summary.syncPaused"), tone: "warning" };
  }

  if (currentBinding?.accessMode === "account-managed") {
    return {
      summary: currentHomeSpace ? t("settings.summary.accountManagedWithName", { space: currentHomeSpace.name }) : t("settings.summary.accountManagedBound"),
      tone: "success"
    };
  }

  if (currentBinding?.accessMode === "sync-code") {
    return {
      summary: currentHomeSpace ? t("settings.summary.syncCodeWithName", { space: currentHomeSpace.name }) : t("settings.summary.syncCodeBound"),
      tone: "info"
    };
  }

  return {
    summary: signedIn ? t("settings.summary.signedInNoBinding") : t("settings.summary.signedOutLocal"),
    tone: signedIn ? "success" : "neutral"
  };
}

function getHomeSpacesSectionSummary({
  accountData,
  currentHomeSpace,
  signedIn,
  t
}: {
  accountData: ReturnType<typeof useAccountData>;
  currentHomeSpace: HomeSpace | null;
  signedIn: boolean;
  t: ReturnType<typeof useI18n>["t"];
}): { summary: string; tone: StatusTone } {
  if (!signedIn) {
    return { summary: t("settings.summary.homeSpacesSignedOut"), tone: "neutral" };
  }

  if (accountData.homeSpaceError || accountData.error) {
    return { summary: accountData.homeSpaceError || accountData.error, tone: "danger" };
  }

  if (accountData.loading) {
    return { summary: t("settings.summary.homeSpacesLoading"), tone: "neutral" };
  }

  return {
    summary: currentHomeSpace
      ? t("settings.summary.homeSpacesCountCurrent", { count: accountData.homeSpaces.length, space: currentHomeSpace.name })
      : t("settings.summary.homeSpacesCount", { count: accountData.homeSpaces.length }),
    tone: currentHomeSpace ? "success" : "neutral"
  };
}

function getThemeImagesSectionSummary(documentValue: HomeDocumentV2, t: ReturnType<typeof useI18n>["t"]): { summary: string; tone: StatusTone } {
  const hasBanner = Boolean(documentValue.theme.bannerAsset || documentValue.theme.bannerUrl);
  const hasBackground = Boolean(documentValue.theme.backgroundAsset || documentValue.theme.backgroundUrl);

  if (hasBanner && hasBackground) {
    return { summary: t("settings.summary.imagesBoth"), tone: "success" };
  }

  if (hasBanner) {
    return { summary: t("settings.summary.imagesBannerOnly"), tone: "info" };
  }

  if (hasBackground) {
    return { summary: t("settings.summary.imagesBackgroundOnly"), tone: "info" };
  }

  return { summary: t("settings.summary.imagesEmpty"), tone: "neutral" };
}

function toSyncMeta(binding: StoredSyncBinding, status: HomeSyncMeta["status"] = "synced"): HomeSyncMeta {
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

function formatRestoreSource(source: DataPackageRestoreDialogState["preview"]["source"], t: ReturnType<typeof useI18n>["t"]): string {
  if (source === "data-package-v1") {
    return t("settings.advanced.source.dataPackageV1");
  }

  if (source === "home-document-v2") {
    return t("settings.advanced.source.homeJsonV2");
  }

  return t("settings.advanced.source.legacyJson");
}

function formatRestoreAssets(hasBanner: boolean, hasBackground: boolean, t: ReturnType<typeof useI18n>["t"]): string {
  if (hasBanner && hasBackground) {
    return formatSettingsSnapshotAssets(hasBanner, hasBackground, t);
  }

  if (hasBanner) {
    return formatSettingsSnapshotAssets(hasBanner, hasBackground, t);
  }

  if (hasBackground) {
    return formatSettingsSnapshotAssets(hasBanner, hasBackground, t);
  }

  return t("settings.advanced.assetsNone");
}

function formatRestoreDate(value: string | null, formatDateTime: (value: Date | string | number) => string, t: ReturnType<typeof useI18n>["t"]): string {
  if (!value) {
    return t("settings.recovery.dateUnknown");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("settings.recovery.dateUnknown");
  }

  return formatDateTime(date);
}

function summarizeCount(value: number): string {
  if (value <= 0) {
    return "0";
  }

  if (value === 1) {
    return "1";
  }

  if (value <= 5) {
    return "2-5";
  }

  if (value <= 20) {
    return "6-20";
  }

  if (value <= 100) {
    return "21-100";
  }

  if (value <= 500) {
    return "101-500";
  }

  return "501+";
}

function getResetDefaultTitle(storageReady: boolean, isDefaultDocument: boolean, hasSyncBinding: boolean, t: ReturnType<typeof useI18n>["t"]): string {
  if (!storageReady) {
    return t("settings.common.storageNotReady");
  }

  if (isDefaultDocument) {
    return t("settings.advanced.resetTitleDefault");
  }

  if (hasSyncBinding) {
    return t("settings.advanced.resetTitleBound");
  }

  return t("settings.advanced.resetTitleLocal");
}
