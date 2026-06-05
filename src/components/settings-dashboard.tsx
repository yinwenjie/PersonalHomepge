"use client";

import type { ChangeEvent } from "react";
import { useRef } from "react";
import Link from "next/link";
import { AccountPanel } from "@/components/account-panel";
import { SyncPanel } from "@/components/sync-panel";
import { useHomeDocumentController } from "@/hooks/use-home-document-controller";

export function SettingsDashboard() {
  const {
    homeDocument,
    storageReady,
    saveStatus,
    replaceHomeDocument,
    updateSyncMeta,
    importJson,
    exportJson,
    resetDefault
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
        <AccountPanel />

        <SyncPanel
          documentValue={homeDocument}
          editorOpen={false}
          storageReady={storageReady}
          visible
          onReplaceDocument={replaceHomeDocument}
          onSyncMetaChange={updateSyncMeta}
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
            <button className="danger-button" type="button" onClick={resetDefault}>恢复默认</button>
          </div>
          <p className="save-status">{saveStatus || "导入会覆盖当前浏览器中的本地首页配置。"}</p>
        </section>

        <section className="settings-panel" aria-label="通用设置">
          <div className="panel-header">
            <h2>通用设置</h2>
            <span>Coming soon</span>
          </div>
          <div className="settings-placeholder">
            <strong>通用偏好设置将在后续阶段开放</strong>
            <p>这里会承载启动行为、界面偏好、默认搜索引擎和组件显示策略。</p>
          </div>
        </section>
      </div>
    </main>
  );
}
