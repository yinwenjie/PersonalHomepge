"use client";

import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import { AccountPanel } from "@/components/account-panel";
import { AccountPreferencesPanel } from "@/components/account-preferences-panel";
import { BookmarkImportPanel } from "@/components/bookmark-import-panel";
import { HomeSpacesPanel } from "@/components/home-spaces-panel";
import { HomeThemeStyleBridge } from "@/components/home-theme-style-bridge";
import { StatusMessage } from "@/components/status-message";
import { SyncPanel } from "@/components/sync-panel";
import { ThemeImagePanel } from "@/components/theme-image-panel";
import { ThemePresetPanel } from "@/components/theme-preset-panel";
import type { HomeSpace } from "@/domain/account";
import { buildHomepageDataExportV1, downloadJsonFile } from "@/domain/data-export";
import type { HomeDocumentV2, HomeSyncMeta } from "@/domain/home-document";
import { parseSyncCode, type StoredSyncBinding } from "@/domain/sync-code";
import { useAccountData } from "@/hooks/use-account-data";
import { useHomeDocumentController } from "@/hooks/use-home-document-controller";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { LocalSyncBindingRepository } from "@/infrastructure/sync-binding-repository";
import { SyncCodeRepository } from "@/infrastructure/sync-code-repository";

export function SettingsDashboard() {
  const auth = useSupabaseAuth();
  const accountData = useAccountData(auth.user);
  const [currentBinding, setCurrentBinding] = useState<StoredSyncBinding | null>(null);
  const [advancedActionMessage, setAdvancedActionMessage] = useState("");
  const [advancedActionError, setAdvancedActionError] = useState("");
  const [syncPanelKey, setSyncPanelKey] = useState(0);
  const {
    homeDocument,
    storageReady,
    saveStatus,
    hasStoredDocument,
    hasResetBackup,
    isDefaultDocument,
    commitHomeDocument,
    replaceHomeDocument,
    updateSyncMeta,
    importJson,
    exportJson,
    resetDefault,
    restoreResetBackup
  } = useHomeDocumentController();
  const importInputRef = useRef<HTMLInputElement | null>(null);

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
          currentBinding
        }
      });

      downloadJsonFile(exportValue, "homepage-data-export");
      setAdvancedActionMessage("数据包已导出，不包含完整同步码或账号托管凭证。");
    } catch (error) {
      console.error(error);
      setAdvancedActionError(error instanceof Error ? error.message : "数据包导出失败。");
    }
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

  const signedIn = Boolean(auth.user);
  const currentAccountHomeSpace = currentBinding
    ? accountData.homeSpaces.find((homeSpace) => homeSpace.syncSpaceId === currentBinding.spaceId) ?? null
    : null;
  const resetDefaultTitle = getResetDefaultTitle(storageReady, isDefaultDocument, Boolean(currentBinding));
  const syncPanel = (
    <SyncPanel
      key={syncPanelKey}
      documentValue={homeDocument}
      editorOpen={false}
      presentation={signedIn ? "advanced" : "primary"}
      storageReady={storageReady}
      visible
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
      signedIn={signedIn}
      currentBinding={currentBinding}
      documentValue={homeDocument}
      storageReady={storageReady}
      onActivateHomeSpace={activateHomeSpace}
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
        <AccountPanel
          accountData={accountData}
          currentBinding={currentBinding}
          currentHomeSpace={currentAccountHomeSpace}
          syncStatus={homeDocument.syncMeta.status}
        />

        {signedIn ? (
          homeSpacesPanel
        ) : (
          <>
            {syncPanel}
            {homeSpacesPanel}
          </>
        )}

        <ThemePresetPanel
          documentValue={homeDocument}
          storageReady={storageReady}
          onCommitDocument={commitHomeDocument}
        />

        <ThemeImagePanel
          documentValue={homeDocument}
          storageReady={storageReady}
          userId={auth.user?.id ?? null}
          onCommitDocument={commitHomeDocument}
        />

        <AccountPreferencesPanel
          accountData={accountData}
          authLoading={auth.loading}
          signedIn={signedIn}
        />

        <section className="settings-panel" aria-label="高级操作">
          <div className="panel-header">
            <h2>高级操作</h2>
            <span>Advanced</span>
          </div>
          <div className="advanced-operation-grid">
            {signedIn ? (
              <div className="advanced-operation-block">
                <div className="advanced-operation-head">
                  <h3>离线同步码与恢复</h3>
                  <span>Sync</span>
                </div>
                {syncPanel}
              </div>
            ) : null}

            <BookmarkImportPanel
              documentValue={homeDocument}
              storageReady={storageReady}
              onCommitDocument={commitHomeDocument}
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
              </div>
              <StatusMessage role={advancedActionError ? "alert" : "status"} tone={advancedActionError ? "danger" : advancedActionMessage ? "success" : "neutral"}>
                {advancedActionError || advancedActionMessage || "数据包用于备份和排障，不包含完整同步码、账号托管凭证或登录 session。"}
              </StatusMessage>
            </div>
          </div>
        </section>
      </div>
      </main>
    </>
  );
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
