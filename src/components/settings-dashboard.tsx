"use client";

import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import { AccountPanel } from "@/components/account-panel";
import { AccountPreferencesPanel } from "@/components/account-preferences-panel";
import { HomeSpacesPanel } from "@/components/home-spaces-panel";
import { SyncPanel } from "@/components/sync-panel";
import type { HomeSpace } from "@/domain/account";
import type { HomeSyncMeta } from "@/domain/home-document";
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
  const [syncPanelKey, setSyncPanelKey] = useState(0);
  const {
    homeDocument,
    storageReady,
    saveStatus,
    hasResetBackup,
    isDefaultDocument,
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

  function handleManagedHomeSpaceCreated(binding: StoredSyncBinding) {
    new LocalSyncBindingRepository(window.localStorage).save(binding);
    setCurrentBinding(binding);
    updateSyncMeta(toSyncMeta(binding), "账号托管空间已创建并绑定本机");
    setSyncPanelKey((value) => value + 1);
  }

  return (
    <main className="page settings-page">
      <header className="settings-page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>设置</h1>
        </div>
        <Link className="utility-button" href="/">返回首页</Link>
      </header>

      <div className="settings-stack">
        <AccountPanel accountData={accountData} />

        <SyncPanel
          key={syncPanelKey}
          documentValue={homeDocument}
          editorOpen={false}
          storageReady={storageReady}
          visible
          onReplaceDocument={replaceHomeDocument}
          onSyncMetaChange={updateSyncMeta}
          onBindingChange={setCurrentBinding}
          hasResetBackup={hasResetBackup}
          onRestoreResetBackup={restoreResetBackup}
        />

        <HomeSpacesPanel
          accountData={accountData}
          authLoading={auth.loading}
          signedIn={Boolean(auth.user)}
          currentBinding={currentBinding}
          documentValue={homeDocument}
          storageReady={storageReady}
          onActivateHomeSpace={activateHomeSpace}
          onRestoreManagedHomeSpace={restoreManagedHomeSpace}
          onManagedHomeSpaceCreated={handleManagedHomeSpaceCreated}
        />

        <section className="settings-panel" aria-label="配置文件">
          <div className="panel-header">
            <h2>配置文件</h2>
            <span>JSON</span>
          </div>
          <div className="settings-actions">
            <button className="utility-button" type="button" onClick={exportJson}>导出 JSON</button>
            <label className="file-button" htmlFor="settingsImportInput">导入 JSON</label>
            <input ref={importInputRef} id="settingsImportInput" type="file" accept="application/json" hidden onChange={handleFileChange} />
            {hasResetBackup ? (
              <button className="utility-button" type="button" onClick={restoreResetBackup}>恢复上一次重置前页面</button>
            ) : null}
            <button className="danger-button" type="button" onClick={handleResetDefault} disabled={!storageReady || isDefaultDocument}>清空内容并恢复默认</button>
          </div>
          <p className="save-status">{saveStatus || "导入会覆盖当前浏览器中的本地首页配置。"}</p>
        </section>

        <AccountPreferencesPanel
          accountData={accountData}
          authLoading={auth.loading}
          signedIn={Boolean(auth.user)}
        />
      </div>
    </main>
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
