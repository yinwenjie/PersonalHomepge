"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusMessage } from "@/components/status-message";
import {
  sortByOrder,
  type HomeSite,
  type HomeWidget
} from "@/domain/home-document";
import type { LocalePreference } from "@/domain/ui-preferences";
import { getWidgetDefinition } from "@/domain/widget-registry";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import {
  LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT,
  LocalHomeSnapshotRepository,
  type LocalHomeSnapshot
} from "@/infrastructure/local-home-snapshot-repository";

interface DataRecoveryCenterPanelProps {
  hasSyncBinding: boolean;
  storageReady: boolean;
  onRestoreSnapshot: (snapshot: LocalHomeSnapshot) => boolean;
}

export function DataRecoveryCenterPanel({
  hasSyncBinding,
  storageReady,
  onRestoreSnapshot
}: DataRecoveryCenterPanelProps) {
  const { preferences } = useUiPreferences();
  const [snapshots, setSnapshots] = useState<LocalHomeSnapshot[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewSnapshot, setPreviewSnapshot] = useState<LocalHomeSnapshot | null>(null);

  useEffect(() => {
    if (!storageReady) {
      return undefined;
    }

    function refreshSnapshots() {
      setSnapshots(loadSnapshots());
    }

    refreshSnapshots();
    window.addEventListener(LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT, refreshSnapshots);

    return () => window.removeEventListener(LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT, refreshSnapshots);
  }, [storageReady]);

  const visibleSnapshots = useMemo(() => snapshots.slice(0, 30), [snapshots]);

  function refreshSnapshots() {
    setSnapshots(loadSnapshots());
    setError("");
    setMessage("本地历史版本已刷新。");
  }

  function restoreSnapshot(snapshot: LocalHomeSnapshot) {
    const confirmMessage = hasSyncBinding
      ? "恢复这个本地历史版本会覆盖当前首页。当前浏览器已绑定同步空间，恢复后会暂停自动同步，不会立刻覆盖云端首页。继续？"
      : "恢复这个本地历史版本会覆盖当前首页。恢复前会再保存一份当前首页快照。继续？";

    if (!window.confirm(confirmMessage)) {
      return;
    }

    const restored = onRestoreSnapshot(snapshot);
    if (!restored) {
      setMessage("");
      setError("本地历史版本恢复失败。");
      return;
    }

    setError("");
    setMessage(hasSyncBinding
      ? "已恢复本地历史版本；自动同步已暂停，请手动选择上传或拉取。"
      : "已恢复本地历史版本。");
    setPreviewSnapshot(null);
    setSnapshots(loadSnapshots());
  }

  return (
    <section className="settings-panel data-recovery-center" aria-label="数据恢复中心">
      <div className="panel-header">
        <h2>数据恢复中心</h2>
        <span>Recovery</span>
      </div>

      <div className="settings-actions">
        <button className="utility-button" type="button" onClick={refreshSnapshots} disabled={!storageReady}>
          刷新
        </button>
      </div>

      <StatusMessage role={error ? "alert" : "status"} tone={error ? "danger" : message ? "success" : "warning"}>
        {error || message || "本阶段只恢复当前浏览器中的本地历史版本；恢复后不会自动覆盖云端。"}
      </StatusMessage>

      {visibleSnapshots.length > 0 ? (
        <div className="local-snapshot-list">
          {visibleSnapshots.map((snapshot) => (
            <article className="local-snapshot-card" key={snapshot.id}>
              <div className="local-snapshot-copy">
                <div className="local-snapshot-title">
                  <strong>{formatSnapshotVersion(snapshot)}</strong>
                  <time>{formatDateTime(snapshot.createdAt, preferences.locale)}</time>
                </div>
                <div className="local-snapshot-meta">
                  <span>{snapshot.summary.groupCount} 分组</span>
                  <span>{snapshot.summary.siteCount} 网站</span>
                  <span>{snapshot.summary.widgetCount} 组件</span>
                  <span>主题 {snapshot.summary.themePresetId}</span>
                  <span>{formatSnapshotAssets(snapshot.summary.hasBanner, snapshot.summary.hasBackground)}</span>
                  <span>更新 {formatDateTime(snapshot.summary.updatedAt, preferences.locale)}</span>
                </div>
              </div>
              <div className="settings-actions local-snapshot-actions">
                <button className="utility-button" type="button" onClick={() => setPreviewSnapshot(snapshot)}>
                  预览
                </button>
                <button className="danger-button" type="button" onClick={() => restoreSnapshot(snapshot)} disabled={!storageReady}>
                  恢复
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <StatusMessage tone="neutral">
          {storageReady ? "当前浏览器暂无可恢复的本地历史版本。" : "本地存储尚未就绪，请稍后重试。"}
        </StatusMessage>
      )}

      {previewSnapshot ? (
        <SnapshotPreviewDialog
          locale={preferences.locale}
          snapshot={previewSnapshot}
          onClose={() => setPreviewSnapshot(null)}
          onRestore={() => restoreSnapshot(previewSnapshot)}
        />
      ) : null}
    </section>
  );
}

interface SnapshotPreviewDialogProps {
  locale: LocalePreference;
  snapshot: LocalHomeSnapshot;
  onClose: () => void;
  onRestore: () => void;
}

function SnapshotPreviewDialog({
  locale,
  snapshot,
  onClose,
  onRestore
}: SnapshotPreviewDialogProps) {
  const groups = useMemo(() => sortByOrder(snapshot.document.groups), [snapshot.document.groups]);
  const widgets = useMemo(() => sortByOrder(snapshot.document.widgets), [snapshot.document.widgets]);

  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="snapshotPreviewDialogTitle">
      <section className="settings-dialog settings-dialog-wide local-snapshot-preview-dialog">
        <header className="settings-dialog-header">
          <div>
            <h2 id="snapshotPreviewDialogTitle">历史版本预览</h2>
            <p>{formatSnapshotVersion(snapshot)} · {formatDateTime(snapshot.createdAt, locale)}</p>
          </div>
          <button className="utility-button" type="button" onClick={onClose}>取消</button>
        </header>
        <div className="settings-dialog-body">
          <div className="data-restore-summary">
            <DataRecoveryStat label="分组" value={String(snapshot.summary.groupCount)} />
            <DataRecoveryStat label="网站" value={String(snapshot.summary.siteCount)} />
            <DataRecoveryStat label="组件" value={String(snapshot.summary.widgetCount)} />
            <DataRecoveryStat label="主题" value={snapshot.summary.themePresetId} />
            <DataRecoveryStat label="图片" value={formatSnapshotAssets(snapshot.summary.hasBanner, snapshot.summary.hasBackground)} />
            <DataRecoveryStat label="同步状态" value={snapshot.summary.syncStatus} />
            <DataRecoveryStat label="文档更新" value={formatDateTime(snapshot.summary.updatedAt, locale)} />
          </div>

          <StatusMessage tone="warning">
            这是只读预览。恢复会覆盖当前首页，恢复前会再保存一份当前首页快照。
          </StatusMessage>

          <div className="snapshot-preview-section">
            <div className="snapshot-preview-section-head">
              <h3>网站分组</h3>
              <span>{snapshot.summary.siteCount} 个网站</span>
            </div>
            {groups.length > 0 ? (
              <div className="snapshot-preview-group-list">
                {groups.map((group) => {
                  const sites = sortByOrder(group.sites);

                  return (
                    <article className="snapshot-preview-group" key={group.id}>
                      <header>
                        <strong>{group.title}</strong>
                        <span>{sites.length} 个网站</span>
                      </header>
                      {sites.length > 0 ? (
                        <ul className="snapshot-preview-site-list">
                          {sites.map((site) => (
                            <SnapshotPreviewSite site={site} key={site.id} />
                          ))}
                        </ul>
                      ) : (
                        <p className="snapshot-preview-empty">暂无网站。</p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="snapshot-preview-empty">暂无分组。</p>
            )}
          </div>

          <div className="snapshot-preview-section">
            <div className="snapshot-preview-section-head">
              <h3>组件</h3>
              <span>{widgets.length} 个组件</span>
            </div>
            {widgets.length > 0 ? (
              <div className="snapshot-preview-widget-list">
                {widgets.map((widget) => (
                  <SnapshotPreviewWidget widget={widget} key={widget.id} />
                ))}
              </div>
            ) : (
              <p className="snapshot-preview-empty">暂无组件。</p>
            )}
          </div>
        </div>
        <footer className="settings-dialog-footer">
          <button className="utility-button" type="button" onClick={onClose}>取消</button>
          <button className="danger-button" type="button" onClick={onRestore}>恢复此版本</button>
        </footer>
      </section>
    </div>
  );
}

function SnapshotPreviewSite({ site }: { site: HomeSite }) {
  return (
    <li className="snapshot-preview-site">
      <strong>{site.name}</strong>
      <span>{site.url}</span>
      {site.keywords ? <small>{site.keywords}</small> : null}
    </li>
  );
}

function SnapshotPreviewWidget({ widget }: { widget: HomeWidget }) {
  const definition = getWidgetDefinition(widget.type);

  return (
    <article className="snapshot-preview-widget">
      <strong>{widget.title}</strong>
      <span>{definition.title} · {widget.layout.collapsed ? "折叠" : "展开"}</span>
    </article>
  );
}

function DataRecoveryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="data-restore-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function loadSnapshots(): LocalHomeSnapshot[] {
  try {
    return new LocalHomeSnapshotRepository(window.localStorage).load().sort(compareSnapshotCreatedAt);
  } catch {
    return [];
  }
}

function compareSnapshotCreatedAt(left: LocalHomeSnapshot, right: LocalHomeSnapshot): number {
  return getDateTime(right.createdAt) - getDateTime(left.createdAt);
}

function getDateTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatSnapshotVersion(snapshot: LocalHomeSnapshot): string {
  return `版本 ${snapshot.revision}`;
}

function formatSnapshotAssets(hasBanner: boolean, hasBackground: boolean): string {
  if (hasBanner && hasBackground) {
    return "Banner + 背景";
  }

  if (hasBanner) {
    return "Banner";
  }

  if (hasBackground) {
    return "背景";
  }

  return "无图片";
}

function formatDateTime(value: string, locale: LocalePreference): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
