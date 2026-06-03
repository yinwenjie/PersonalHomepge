"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HomeDocumentV2, HomeSyncMeta } from "@/domain/home-document";
import {
  createSyncSecrets,
  formatSyncCode,
  parseSyncCode,
  StoredSyncBinding
} from "@/domain/sync-code";
import { LocalSyncBindingRepository } from "@/infrastructure/sync-binding-repository";
import { SyncCodeRepository } from "@/infrastructure/sync-code-repository";

interface SyncPanelProps {
  documentValue: HomeDocumentV2;
  onReplaceDocument: (documentValue: HomeDocumentV2, message: string) => void;
  onSyncMetaChange: (syncMeta: HomeSyncMeta, message: string) => void;
}

export function SyncPanel({ documentValue, onReplaceDocument, onSyncMetaChange }: SyncPanelProps) {
  const [binding, setBinding] = useState<StoredSyncBinding | null>(null);
  const [syncCode, setSyncCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bindingRepositoryRef = useRef<LocalSyncBindingRepository | null>(null);
  const syncRepositoryRef = useRef<SyncCodeRepository | null>(null);

  useEffect(() => {
    bindingRepositoryRef.current = new LocalSyncBindingRepository(window.localStorage);
    syncRepositoryRef.current = new SyncCodeRepository();

    const storedBinding = bindingRepositoryRef.current.load();
    if (storedBinding) {
      setBinding(storedBinding);
      setSyncCode(formatSyncCode(storedBinding));
      onSyncMetaChange(toSyncMeta(storedBinding, "linked"), "已读取本机同步码");
    }
  }, [onSyncMetaChange]);

  const statusText = useMemo(() => {
    if (!binding) {
      return "未绑定";
    }

    return `已绑定 rev ${binding.remoteRevision}`;
  }, [binding]);

  async function createCode() {
    await runSyncAction(async () => {
      const secrets = createSyncSecrets();
      const result = await getSyncRepository().create(documentValue, secrets);
      const nextBinding: StoredSyncBinding = {
        version: 1,
        spaceId: result.spaceId,
        accessToken: secrets.accessToken,
        encryptionKey: secrets.encryptionKey,
        remoteRevision: result.revision,
        lastSyncedAt: result.updatedAt
      };

      saveBinding(nextBinding);
      setSyncCode(formatSyncCode(nextBinding));
      onSyncMetaChange(toSyncMeta(nextBinding, "synced"), "同步码已创建");
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
        lastSyncedAt: pulled.updatedAt
      };
      saveBinding(nextBinding);
      setSyncCode(formatSyncCode(nextBinding));
      setInputCode("");
      onReplaceDocument({
        ...pulled.document,
        syncMeta: toSyncMeta(nextBinding, "synced")
      }, "已绑定同步码并拉取云端首页");
      setMessage("已绑定同步码。");
    });
  }

  async function pullCloud() {
    if (!binding) {
      setError("请先创建或输入同步码。");
      return;
    }

    await runSyncAction(async () => {
      onSyncMetaChange(toSyncMeta(binding, "syncing"), "正在拉取云端");
      const pulled = await getSyncRepository().pull(binding);
      const nextBinding: StoredSyncBinding = {
        ...binding,
        remoteRevision: pulled.revision,
        lastSyncedAt: pulled.updatedAt
      };
      saveBinding(nextBinding);
      onReplaceDocument({
        ...pulled.document,
        syncMeta: toSyncMeta(nextBinding, "synced")
      }, "已拉取云端首页");
      setMessage("已拉取云端首页。");
    });
  }

  async function pushLocal() {
    if (!binding) {
      setError("请先创建或输入同步码。");
      return;
    }

    await runSyncAction(async () => {
      onSyncMetaChange(toSyncMeta(binding, "syncing"), "正在上传本地首页");
      const result = await getSyncRepository().push(binding, {
        ...documentValue,
        syncMeta: toSyncMeta(binding, "syncing")
      });

      if (result.status === "conflict") {
        const conflictBinding = {
          ...binding,
          remoteRevision: result.remoteRevision,
          lastSyncedAt: result.updatedAt
        };
        saveBinding(conflictBinding);
        onSyncMetaChange(toSyncMeta(conflictBinding, "conflict"), "云端已有更新，请先拉取");
        setMessage("检测到冲突：云端版本更新。");
        return;
      }

      const nextBinding: StoredSyncBinding = {
        ...binding,
        remoteRevision: result.revision,
        lastSyncedAt: result.updatedAt
      };
      saveBinding(nextBinding);
      onSyncMetaChange(toSyncMeta(nextBinding, "synced"), "已上传本地首页");
      setMessage("已上传本地首页。");
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
    setBinding(null);
    setSyncCode("");
    onSyncMetaChange(localSyncMeta(), "已解除本机同步码");
    setMessage("已解除本机绑定。");
    setError("");
  }

  async function revokeCode() {
    if (!binding) {
      return;
    }

    if (!window.confirm("废弃后，所有设备都无法继续使用这个同步码。继续？")) {
      return;
    }

    await runSyncAction(async () => {
      await getSyncRepository().revoke(binding);
      bindingRepositoryRef.current?.clear();
      setBinding(null);
      setSyncCode("");
      onSyncMetaChange(localSyncMeta(), "同步码已废弃");
      setMessage("同步码已废弃。");
    });
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
          <button className="utility-button" type="button" onClick={pullCloud} disabled={busy || !binding}>拉取</button>
          <button className="utility-button" type="button" onClick={pushLocal} disabled={busy || !binding}>上传</button>
        </div>
      </div>

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

  async function runSyncAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await action();
    } catch (actionError) {
      console.error(actionError);
      setError(actionError instanceof Error ? actionError.message : "同步操作失败。");
      if (binding) {
        onSyncMetaChange(toSyncMeta(binding, "error"), "同步失败");
      }
    } finally {
      setBusy(false);
    }
  }

  function saveBinding(nextBinding: StoredSyncBinding): void {
    bindingRepositoryRef.current?.save(nextBinding);
    setBinding(nextBinding);
  }

  function getSyncRepository(): SyncCodeRepository {
    if (!syncRepositoryRef.current) {
      syncRepositoryRef.current = new SyncCodeRepository();
    }

    return syncRepositoryRef.current;
  }
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
