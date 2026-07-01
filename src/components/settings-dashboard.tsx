"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccountPanel } from "@/components/account-panel";
import { AccountPreferencesPanel } from "@/components/account-preferences-panel";
import { BookmarkImportPanel } from "@/components/bookmark-import-panel";
import { DataRecoveryCenterPanel } from "@/components/data-recovery-center-panel";
import { DeviceStatusPanel } from "@/components/device-status-panel";
import { HomeSpacesPanel } from "@/components/home-spaces-panel";
import { HomeThemeStyleBridge } from "@/components/home-theme-style-bridge";
import { LocalAuditLogPanel } from "@/components/local-audit-log-panel";
import { ProductAnalyticsSettingsPanel } from "@/components/product-analytics-settings-panel";
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
import { localePreferenceLabel, searchEngineLabel } from "@/domain/ui-preferences";
import { useAccountData } from "@/hooks/use-account-data";
import { useHomeDocumentController } from "@/hooks/use-home-document-controller";
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

interface DataPackageRestoreDialogState extends ParsedHomepageDataRestore {
  fileName: string;
}

const ACCOUNT_MANAGED_SYNC_STATUS_SLOT_ID = "account-managed-sync-status-slot";

export function SettingsDashboard() {
  const auth = useSupabaseAuth();
  const accountData = useAccountData(auth.user);
  const uiPreferences = useUiPreferences();
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
      confirmMessage: "清空内容并恢复默认会覆盖当前浏览器中的首页，并自动保存一份重置前备份。当前浏览器已绑定同步空间，本次重置后会暂停自动同步，不会立刻覆盖云端首页。继续？",
      syncMeta: toSyncMeta(currentBinding, "paused"),
      successMessage: "已清空内容并恢复默认，自动同步已暂停，云端暂未覆盖"
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
      setAdvancedActionMessage("数据包已导出，不包含完整同步码、账号托管恢复凭证、登录 session 或云端历史 document_json。");
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
      setAdvancedActionError(error instanceof Error ? error.message : "数据包导出失败。");
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
      setAdvancedActionMessage("数据包已读取，请确认恢复内容。");
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
      const message = error instanceof Error ? error.message : "数据包读取失败。";
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
    }, currentBinding ? "已恢复数据包，自动同步已暂停" : "已恢复数据包");

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

    setAdvancedActionMessage(currentBinding ? "数据包已恢复；当前同步空间已暂停自动同步，请手动选择上传或拉取。" : "数据包已恢复到当前浏览器。");
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
    }, "已激活首页空间并拉取云端首页");
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
    }, "已恢复账号托管空间到本机");
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
      "同步码空间已迁移为账号托管"
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
    }, "账号托管空间已创建并绑定本机");
    setSyncPanelKey((value) => value + 1);
  }

  const currentAccountHomeSpace = currentBinding
    ? accountData.homeSpaces.find((homeSpace) => homeSpace.syncSpaceId === currentBinding.spaceId) ?? null
    : null;
  const resetDefaultTitle = getResetDefaultTitle(storageReady, isDefaultDocument, Boolean(currentBinding));
  const activeThemePreset = getHomeThemePreset(normalizeHomeThemePresetId(homeDocument.theme.presetId, homeDocument.theme.accent));
  const sectionSummaries = {
    account: getAccountSectionSummary({
      accountData,
      authConfigured: auth.configured,
      authError: auth.error,
      currentBinding,
      currentHomeSpace: currentAccountHomeSpace,
      signedIn,
      syncStatus: homeDocument.syncMeta.status
    }),
    homeSpaces: getHomeSpacesSectionSummary({
      accountData,
      currentHomeSpace: currentAccountHomeSpace,
      signedIn
    }),
    themeStyle: {
      summary: `当前主题：${activeThemePreset.name}`,
      tone: "neutral" as StatusTone
    },
    themeImages: getThemeImagesSectionSummary(homeDocument),
    accountPreferences: {
      summary: `${signedIn ? "账号偏好" : "本地偏好"} · ${localePreferenceLabel(uiPreferences.preferences.locale)} · ${searchEngineLabel(uiPreferences.preferences.defaultSearchEngine)}`,
      tone: uiPreferences.error ? "warning" as StatusTone : "neutral" as StatusTone
    },
    dataRecovery: recoverySectionStatus
      ? { summary: recoverySectionStatus.text, tone: recoverySectionStatus.tone }
      : {
          summary: currentAccountHomeSpace?.accessMode === "account-managed" ? "本地历史 + 账号托管云端历史" : "当前浏览器本地历史",
          tone: "neutral" as StatusTone
        },
    advanced: {
      summary: advancedActionError || advancedActionMessage || "导入、导出、审计、同步码和本机状态",
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
      <HomeThemeStyleBridge theme={homeDocument.theme} />
      <main className="page settings-page">
      <header className="settings-page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>设置</h1>
        </div>
        <Link className="utility-button" href="/">返回首页</Link>
      </header>

      <div className="settings-stack">
        <SettingsSection
          id="account"
          title="账号"
          kicker={signedIn ? "Signed in" : "Magic Link"}
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
          title="首页空间"
          kicker={signedIn ? `${accountData.homeSpaces.length} spaces` : "Sign in"}
          summary={sectionSummaries.homeSpaces.summary}
          tone={sectionSummaries.homeSpaces.tone}
          expanded={settingsLayout.isSectionExpanded("home-spaces")}
          onToggle={() => toggleSection("home-spaces")}
        >
          {homeSpacesPanel}
        </SettingsSection>

        <SettingsSection
          id="theme-style"
          title="主题风格"
          kicker="Theme"
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
          title="Banner / 背景"
          kicker="Images"
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
          title="通用设置"
          kicker={signedIn ? "Account" : "Local"}
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
          title="数据恢复中心"
          kicker="Recovery"
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
                successMessage: currentBinding ? "已恢复云端历史版本，自动同步已暂停" : "已恢复云端历史版本"
              });

              if (restored) {
                setSyncPanelKey((value) => value + 1);
              }

              return restored;
            }}
            onRestoreSnapshot={(snapshot) => {
              const restored = restoreLocalSnapshot(snapshot, {
                syncMeta: currentBinding ? toSyncMeta(currentBinding, "paused") : localSyncMeta(),
                successMessage: currentBinding ? "已恢复本地历史版本，自动同步已暂停" : "已恢复本地历史版本"
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
          title="高级操作"
          kicker="Advanced"
          summary={sectionSummaries.advanced.summary}
          tone={sectionSummaries.advanced.tone}
          expanded={settingsLayout.isSectionExpanded("advanced")}
          onToggle={() => toggleSection("advanced")}
        >
          <div className="advanced-operation-grid">
            <div className="advanced-operation-block">
              <div className="advanced-operation-head">
                <h3>{signedIn ? "离线同步码与恢复" : "同步码"}</h3>
                <span>Sync</span>
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
                <h3>配置文件</h3>
                <span>JSON</span>
              </div>
              <div className="settings-actions">
                <button className="utility-button" type="button" onClick={exportJson}>导出 JSON</button>
                <label className="file-button" htmlFor="settingsImportInput">导入 JSON</label>
                <input ref={importInputRef} id="settingsImportInput" type="file" accept="application/json" hidden onChange={handleFileChange} />
                {hasResetBackup ? (
                  <button className="utility-button" type="button" onClick={restoreResetBackup} title="用最近一次重置前备份覆盖当前本地首页">恢复上一次重置前页面</button>
                ) : null}
                <button
                  className="danger-button"
                  type="button"
                  onClick={handleResetDefault}
                  disabled={!storageReady || isDefaultDocument}
                  title={resetDefaultTitle}
                >
                  清空内容并恢复默认
                </button>
              </div>
              <StatusMessage tone={saveStatus ? "success" : "neutral"}>
                {saveStatus || "导入会覆盖当前浏览器中的本地首页配置。"}
              </StatusMessage>
            </div>

            <div className="advanced-operation-block">
              <div className="advanced-operation-head">
                <h3>数据包</h3>
                <span>Export</span>
              </div>
              <div className="settings-actions">
                <button
                  className="utility-button"
                  type="button"
                  disabled={!storageReady}
                  title={storageReady ? "导出当前首页、账号摘要、首页空间索引和诊断信息" : "本地存储尚未就绪，请稍后重试。"}
                  onClick={handleExportDataPackage}
                >
                  导出数据包
                </button>
                <button
                  className="utility-button"
                  type="button"
                  disabled={!storageReady}
                  title={storageReady ? "读取数据包并预览可恢复内容" : "本地存储尚未就绪，请稍后重试。"}
                  onClick={() => dataPackageImportInputRef.current?.click()}
                >
                  导入/恢复数据包
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
                {advancedActionError || advancedActionMessage || "数据包用于备份和排障，不包含完整同步码、账号托管恢复凭证、登录 session 或云端历史 document_json。"}
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
                <h2 id="dataRestoreDialogTitle">恢复数据包</h2>
                <p>{dataPackageRestore.fileName}</p>
              </div>
            </header>
            <div className="settings-dialog-body">
              <div className="data-restore-summary">
                <DataRestoreStat label="标题" value={dataPackageRestore.preview.documentTitle} />
                <DataRestoreStat label="来源" value={formatRestoreSource(dataPackageRestore.preview.source)} />
                <DataRestoreStat label="分组" value={String(dataPackageRestore.preview.groupCount)} />
                <DataRestoreStat label="网站" value={String(dataPackageRestore.preview.siteCount)} />
                <DataRestoreStat label="组件" value={String(dataPackageRestore.preview.widgetCount)} />
                <DataRestoreStat label="主题" value={dataPackageRestore.preview.themePresetId} />
                <DataRestoreStat label="图片" value={formatRestoreAssets(dataPackageRestore.preview.hasBanner, dataPackageRestore.preview.hasBackground)} />
                <DataRestoreStat label="导出时间" value={formatRestoreDate(dataPackageRestore.preview.exportedAt)} />
                <DataRestoreStat label="文档更新" value={formatRestoreDate(dataPackageRestore.preview.updatedAt)} />
              </div>
              <StatusMessage tone="warning">
                只会恢复数据包里的本机首页内容；账号资料、首页空间索引、同步码摘要、账号托管恢复凭证、云端历史 document_json 和诊断信息不会写回。恢复前会保存当前首页备份。
              </StatusMessage>
              {currentBinding ? (
                <StatusMessage tone="warning">
                  当前浏览器已绑定同步空间。恢复后会暂停自动同步，避免立刻覆盖云端首页。
                </StatusMessage>
              ) : null}
              {dataPackageRestore.ignoredSections.length > 0 ? (
                <p className="data-restore-ignored">忽略区块：{dataPackageRestore.ignoredSections.join("、")}</p>
              ) : null}
            </div>
            <footer className="settings-dialog-footer">
              <button className="utility-button" type="button" onClick={() => setDataPackageRestore(null)}>取消</button>
              <button className="danger-button" type="button" onClick={handleConfirmDataPackageRestore}>确认恢复</button>
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
  syncStatus
}: {
  accountData: ReturnType<typeof useAccountData>;
  authConfigured: boolean;
  authError: string;
  currentBinding: StoredSyncBinding | null;
  currentHomeSpace: HomeSpace | null;
  signedIn: boolean;
  syncStatus: HomeSyncMeta["status"];
}): { summary: string; tone: StatusTone } {
  if (!authConfigured) {
    return { summary: "账号服务未配置，本地首页仍可编辑", tone: "warning" };
  }

  if (authError || accountData.error) {
    return { summary: authError || accountData.error, tone: "danger" };
  }

  if (syncStatus === "conflict") {
    return { summary: "云端和本地都有修改，需要处理同步冲突", tone: "danger" };
  }

  if (syncStatus === "paused") {
    return { summary: "自动同步已暂停，请选择上传、拉取或解除本机", tone: "warning" };
  }

  if (currentBinding?.accessMode === "account-managed") {
    return {
      summary: currentHomeSpace ? `账号托管 · ${currentHomeSpace.name}` : "账号托管空间已绑定",
      tone: "success"
    };
  }

  if (currentBinding?.accessMode === "sync-code") {
    return {
      summary: currentHomeSpace ? `普通同步码 · ${currentHomeSpace.name}` : "当前浏览器绑定普通同步码",
      tone: "info"
    };
  }

  return {
    summary: signedIn ? "已登录 · 当前浏览器未绑定同步空间" : "未登录 · 当前首页只保存在本机",
    tone: signedIn ? "success" : "neutral"
  };
}

function getHomeSpacesSectionSummary({
  accountData,
  currentHomeSpace,
  signedIn
}: {
  accountData: ReturnType<typeof useAccountData>;
  currentHomeSpace: HomeSpace | null;
  signedIn: boolean;
}): { summary: string; tone: StatusTone } {
  if (!signedIn) {
    return { summary: "登录后可创建、恢复和管理账号首页空间", tone: "neutral" };
  }

  if (accountData.homeSpaceError || accountData.error) {
    return { summary: accountData.homeSpaceError || accountData.error, tone: "danger" };
  }

  if (accountData.loading) {
    return { summary: "正在读取首页空间", tone: "neutral" };
  }

  const currentSpaceText = currentHomeSpace ? ` · 当前 ${currentHomeSpace.name}` : "";
  return {
    summary: `${accountData.homeSpaces.length} 个空间${currentSpaceText}`,
    tone: currentHomeSpace ? "success" : "neutral"
  };
}

function getThemeImagesSectionSummary(documentValue: HomeDocumentV2): { summary: string; tone: StatusTone } {
  const hasBanner = Boolean(documentValue.theme.bannerAsset || documentValue.theme.bannerUrl);
  const hasBackground = Boolean(documentValue.theme.backgroundAsset || documentValue.theme.backgroundUrl);

  if (hasBanner && hasBackground) {
    return { summary: "已设置 Banner 和背景", tone: "success" };
  }

  if (hasBanner) {
    return { summary: "已设置 Banner，背景未设置", tone: "info" };
  }

  if (hasBackground) {
    return { summary: "已设置背景，Banner 未设置", tone: "info" };
  }

  return { summary: "未设置图片", tone: "neutral" };
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

function formatRestoreSource(source: DataPackageRestoreDialogState["preview"]["source"]): string {
  if (source === "data-package-v1") {
    return "数据包 v1";
  }

  if (source === "home-document-v2") {
    return "首页 JSON v2";
  }

  return "旧版首页 JSON";
}

function formatRestoreAssets(hasBanner: boolean, hasBackground: boolean): string {
  if (hasBanner && hasBackground) {
    return "Banner + 背景";
  }

  if (hasBanner) {
    return "Banner";
  }

  if (hasBackground) {
    return "背景";
  }

  return "无";
}

function formatRestoreDate(value: string | null): string {
  if (!value) {
    return "未知";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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

function getResetDefaultTitle(storageReady: boolean, isDefaultDocument: boolean, hasSyncBinding: boolean): string {
  if (!storageReady) {
    return "本地存储尚未就绪，请稍后重试。";
  }

  if (isDefaultDocument) {
    return "当前首页已经是默认内容，不会覆盖重置前备份。";
  }

  if (hasSyncBinding) {
    return "清空当前本地首页并自动备份；恢复默认后会暂停自动同步，避免立刻覆盖云端。";
  }

  return "清空当前本地首页并自动保存最近一次重置前备份。";
}
