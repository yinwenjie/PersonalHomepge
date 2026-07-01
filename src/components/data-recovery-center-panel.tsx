"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusMessage, type StatusTone } from "@/components/status-message";
import type { HomeSpace } from "@/domain/account";
import {
  sortByOrder,
  type HomeSite,
  type HomeWidget
} from "@/domain/home-document";
import { bucketCount } from "@/domain/product-analytics";
import { resolveLocalePreference, type LocalePreference } from "@/domain/ui-preferences";
import { getWidgetDefinition } from "@/domain/widget-registry";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import {
  CloudHomeSnapshotRepository,
  type CloudHomeSnapshot
} from "@/infrastructure/cloud-home-snapshot-repository";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";
import {
  LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT,
  LocalHomeSnapshotRepository,
  type LocalHomeSnapshot
} from "@/infrastructure/local-home-snapshot-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

interface DataRecoveryCenterPanelProps {
  currentHomeSpace?: HomeSpace | null;
  embedded?: boolean;
  hasSyncBinding: boolean;
  storageReady: boolean;
  onStatusSummaryChange?: (summary: { text: string; tone: StatusTone } | null) => void;
  onRestoreCloudSnapshot: (snapshot: CloudHomeSnapshot) => boolean;
  onRestoreSnapshot: (snapshot: LocalHomeSnapshot) => boolean;
}

type SnapshotPreviewState =
  | { kind: "local"; snapshot: LocalHomeSnapshot }
  | { kind: "cloud"; snapshot: CloudHomeSnapshot };

export function DataRecoveryCenterPanel({
  currentHomeSpace = null,
  embedded = false,
  hasSyncBinding,
  storageReady,
  onStatusSummaryChange,
  onRestoreCloudSnapshot,
  onRestoreSnapshot
}: DataRecoveryCenterPanelProps) {
  const { preferences } = useUiPreferences();
  const [snapshots, setSnapshots] = useState<LocalHomeSnapshot[]>([]);
  const [cloudSnapshots, setCloudSnapshots] = useState<CloudHomeSnapshot[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<SnapshotPreviewState | null>(null);
  const [selectedLocalSnapshotId, setSelectedLocalSnapshotId] = useState("");
  const [selectedCloudSnapshotId, setSelectedCloudSnapshotId] = useState("");
  const recoveryOpenedTrackedRef = useRef(false);
  const currentHomeSpaceId = currentHomeSpace?.id ?? "";
  const canUseCloudSnapshots = Boolean(currentHomeSpace?.accessMode === "account-managed");
  const refreshCloudSnapshots = useCallback(async (homeSpaceId = currentHomeSpace?.id ?? "", options: { silent?: boolean } = {}) => {
    if (!homeSpaceId || !canUseCloudSnapshots) {
      return;
    }

    setCloudLoading(true);
    if (!options.silent) {
      setError("");
      setMessage("");
    }

    try {
      const nextSnapshots = await new CloudHomeSnapshotRepository().listSnapshots(homeSpaceId);
      setCloudSnapshots(nextSnapshots);
      if (!options.silent) {
        setMessage("云端历史版本已刷新。");
      }
    } catch (cloudError) {
      console.error(cloudError);
      captureClientError(cloudError, {
        eventType: "async_operation_failed",
        operation: "snapshot.cloud_list",
        properties: {
          accessMode: currentHomeSpace?.accessMode ?? "none",
          source: "data-recovery-center"
        },
        severity: "warning"
      });
      if (!options.silent) {
        setMessage("");
        setError("云端历史版本读取失败。请确认 Supabase 已执行 Phase 1.11.5 migration。");
      }
    } finally {
      setCloudLoading(false);
    }
  }, [canUseCloudSnapshots, currentHomeSpace?.accessMode, currentHomeSpace?.id]);

  useEffect(() => {
    if (!storageReady) {
      return undefined;
    }

    function refreshSnapshots() {
      setSnapshots(loadSnapshots());
    }

    refreshSnapshots();
    if (!recoveryOpenedTrackedRef.current) {
      recoveryOpenedTrackedRef.current = true;
      trackProductEvent("recovery.center_opened", {
        cloudHistoryAvailable: canUseCloudSnapshots,
        hasSyncBinding
      });
    }
    window.addEventListener(LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT, refreshSnapshots);

    return () => window.removeEventListener(LOCAL_HOME_SNAPSHOTS_UPDATED_EVENT, refreshSnapshots);
  }, [canUseCloudSnapshots, hasSyncBinding, storageReady]);

  useEffect(() => {
    const homeSpaceId = currentHomeSpace?.id;
    if (!storageReady || !canUseCloudSnapshots || !homeSpaceId) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      void refreshCloudSnapshots(homeSpaceId, { silent: true });
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [canUseCloudSnapshots, currentHomeSpace?.id, refreshCloudSnapshots, storageReady]);

  useEffect(() => {
    if (error) {
      onStatusSummaryChange?.({ text: error, tone: "danger" });
      return;
    }

    if (message) {
      onStatusSummaryChange?.({ text: message, tone: "success" });
      return;
    }

    onStatusSummaryChange?.(null);
  }, [error, message, onStatusSummaryChange]);

  const visibleSnapshots = useMemo(() => snapshots.slice(0, 30), [snapshots]);
  const visibleCloudSnapshots = useMemo(() => {
    if (!canUseCloudSnapshots || !currentHomeSpaceId) {
      return [];
    }

    return cloudSnapshots
      .filter((snapshot) => snapshot.homeSpaceId === currentHomeSpaceId)
      .slice(0, 50);
  }, [canUseCloudSnapshots, cloudSnapshots, currentHomeSpaceId]);
  const selectedLocalSnapshot = useMemo(() => {
    return visibleSnapshots.find((snapshot) => snapshot.id === selectedLocalSnapshotId) ?? visibleSnapshots[0] ?? null;
  }, [selectedLocalSnapshotId, visibleSnapshots]);
  const selectedCloudSnapshot = useMemo(() => {
    return visibleCloudSnapshots.find((snapshot) => snapshot.id === selectedCloudSnapshotId) ?? visibleCloudSnapshots[0] ?? null;
  }, [selectedCloudSnapshotId, visibleCloudSnapshots]);

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
    trackProductEvent("recovery.local_restored", toSnapshotAnalyticsProperties(snapshot));
    setPreviewSnapshot(null);
    setSnapshots(loadSnapshots());
  }

  async function restoreCloudSnapshot(snapshot: CloudHomeSnapshot) {
    if (!window.confirm("恢复这个云端历史版本会覆盖当前本机首页。恢复前会先保存当前有效本地首页快照，恢复后会暂停自动同步，不会立刻覆盖云端首页。继续？")) {
      return;
    }

    const restored = onRestoreCloudSnapshot(snapshot);
    if (!restored) {
      setMessage("");
      setError("云端历史版本恢复失败。");
      return;
    }

    try {
      await new CloudHomeSnapshotRepository().recordRestoredToLocal(snapshot);
      setError("");
      setMessage("已恢复云端历史版本到本机；自动同步已暂停，请手动选择上传或拉取。");
    } catch (auditError) {
      console.warn("Failed to record cloud snapshot restore audit event:", auditError);
      captureClientError(auditError, {
        eventType: "async_operation_failed",
        operation: "snapshot.cloud_restore_audit",
        properties: {
          accessMode: currentHomeSpace?.accessMode ?? "none",
          source: "data-recovery-center"
        },
        severity: "warning"
      });
      setMessage("已恢复云端历史版本到本机；但云端审计记录写入失败。");
      setError("");
    }

    trackProductEvent("recovery.cloud_restored", toSnapshotAnalyticsProperties(snapshot));
    setPreviewSnapshot(null);
    setSnapshots(loadSnapshots());
  }

  const content = (
    <>
      <div className="settings-actions">
        <button className="utility-button" type="button" onClick={refreshSnapshots} disabled={!storageReady}>
          刷新本地
        </button>
        {canUseCloudSnapshots ? (
          <button className="utility-button" type="button" onClick={() => void refreshCloudSnapshots()} disabled={!storageReady || cloudLoading}>
            {cloudLoading ? "刷新中" : "刷新云端"}
          </button>
        ) : null}
      </div>

      <StatusMessage role={error ? "alert" : "status"} tone={error ? "danger" : message ? "success" : "warning"}>
        {error || message || (canUseCloudSnapshots
          ? "可恢复当前浏览器本地历史版本和当前账号托管空间的云端历史版本；账号托管历史用于恢复、完整预览和审计，恢复后不会自动覆盖云端。"
          : "当前仅恢复当前浏览器中的本地历史版本；只有账号托管空间会显示可预览的云端历史版本，普通同步码空间保持云端密文边界。")}
      </StatusMessage>

      <div className="recovery-history-section">
        <div className="recovery-history-head">
          <h3>本地历史版本</h3>
          <span>当前浏览器</span>
        </div>
        {selectedLocalSnapshot ? (
          <SnapshotSelector
            label="选择本地历史版本"
            locale={preferences.locale}
            snapshots={visibleSnapshots}
            selectedSnapshot={selectedLocalSnapshot}
            value={selectedLocalSnapshot.id}
            onChange={setSelectedLocalSnapshotId}
            onPreview={(snapshot) => {
              const localSnapshot = snapshot as LocalHomeSnapshot;
              trackProductEvent("recovery.local_previewed", toSnapshotAnalyticsProperties(snapshot));
              setPreviewSnapshot({ kind: "local", snapshot: localSnapshot });
            }}
            onRestore={(snapshot) => restoreSnapshot(snapshot as LocalHomeSnapshot)}
            restoreLabel="恢复"
            storageReady={storageReady}
          />
        ) : (
          <StatusMessage tone="neutral">
            {storageReady ? "当前浏览器暂无可恢复的本地历史版本。" : "本地存储尚未就绪，请稍后重试。"}
          </StatusMessage>
        )}
      </div>

      {canUseCloudSnapshots ? (
        <div className="recovery-history-section">
          <div className="recovery-history-head">
            <h3>云端历史版本</h3>
            <span>{currentHomeSpace?.name ?? "账号托管空间"}</span>
          </div>
          {selectedCloudSnapshot ? (
            <SnapshotSelector
              label="选择云端历史版本"
              locale={preferences.locale}
              snapshots={visibleCloudSnapshots}
              selectedSnapshot={selectedCloudSnapshot}
              value={selectedCloudSnapshot.id}
              onChange={setSelectedCloudSnapshotId}
              onPreview={(snapshot) => {
                const cloudSnapshot = snapshot as CloudHomeSnapshot;
                trackProductEvent("recovery.cloud_previewed", toSnapshotAnalyticsProperties(snapshot));
                setPreviewSnapshot({ kind: "cloud", snapshot: cloudSnapshot });
              }}
              onRestore={(snapshot) => void restoreCloudSnapshot(snapshot as CloudHomeSnapshot)}
              restoreLabel="恢复到本机"
              storageReady={storageReady}
            />
          ) : (
            <StatusMessage tone="neutral">
              {cloudLoading ? "正在读取云端历史版本。" : "当前账号托管空间暂无云端历史版本；下一次成功上传有效用户首页后会自动生成。系统默认页、空白页和未编辑模板页不会进入云端历史。"}
            </StatusMessage>
          )}
        </div>
      ) : null}

      {previewSnapshot ? (
        <SnapshotPreviewDialog
          kind={previewSnapshot.kind}
          locale={preferences.locale}
          snapshot={previewSnapshot.snapshot}
          onClose={() => setPreviewSnapshot(null)}
          onRestore={() => {
            if (previewSnapshot.kind === "cloud") {
              void restoreCloudSnapshot(previewSnapshot.snapshot);
              return;
            }

            restoreSnapshot(previewSnapshot.snapshot);
          }}
        />
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="data-recovery-center">{content}</div>;
  }

  return (
    <section className="settings-panel data-recovery-center" aria-label="数据恢复中心">
      <div className="panel-header">
        <h2>数据恢复中心</h2>
        <span>Recovery</span>
      </div>
      {content}
    </section>
  );
}

type PreviewableSnapshot = LocalHomeSnapshot | CloudHomeSnapshot;

function SnapshotSelector({
  label,
  locale,
  onChange,
  onPreview,
  onRestore,
  restoreLabel,
  selectedSnapshot,
  snapshots,
  storageReady,
  value
}: {
  label: string;
  locale: LocalePreference;
  onChange: (snapshotId: string) => void;
  onPreview: (snapshot: PreviewableSnapshot) => void;
  onRestore: (snapshot: PreviewableSnapshot) => void;
  restoreLabel: string;
  selectedSnapshot: PreviewableSnapshot;
  snapshots: PreviewableSnapshot[];
  storageReady: boolean;
  value: string;
}) {
  return (
    <div className="snapshot-selector">
      <label className="field">
        <span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>
              {formatSnapshotOption(snapshot, locale)}
            </option>
          ))}
        </select>
      </label>

      <article className="local-snapshot-card snapshot-selector-card">
        <SnapshotCardCopy locale={locale} snapshot={selectedSnapshot} />
        <div className="settings-actions local-snapshot-actions">
          <button className="utility-button" type="button" onClick={() => onPreview(selectedSnapshot)}>
            预览
          </button>
          <button className="danger-button" type="button" onClick={() => onRestore(selectedSnapshot)} disabled={!storageReady}>
            {restoreLabel}
          </button>
        </div>
      </article>
    </div>
  );
}

function SnapshotCardCopy({
  locale,
  snapshot
}: {
  locale: LocalePreference;
  snapshot: PreviewableSnapshot;
}) {
  return (
    <div className="local-snapshot-copy">
      <div className="local-snapshot-title">
        <strong>{formatSnapshotVersion(snapshot)}</strong>
        <time>{formatDateTime(snapshot.createdAt, locale)}</time>
      </div>
      <div className="local-snapshot-meta">
        <span>标题 {snapshot.summary.documentTitle}</span>
        <span>{snapshot.summary.groupCount} 分组</span>
        <span>{snapshot.summary.siteCount} 网站</span>
        <span>{snapshot.summary.widgetCount} 组件</span>
        <span>主题 {snapshot.summary.themePresetId}</span>
        <span>{formatSnapshotAssets(snapshot.summary.hasBanner, snapshot.summary.hasBackground)}</span>
        <span>更新 {formatDateTime(snapshot.summary.updatedAt, locale)}</span>
      </div>
    </div>
  );
}

interface SnapshotPreviewDialogProps {
  kind: "cloud" | "local";
  locale: LocalePreference;
  snapshot: PreviewableSnapshot;
  onClose: () => void;
  onRestore: () => void;
}

function SnapshotPreviewDialog({
  kind,
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
            <DataRecoveryStat label="标题" value={snapshot.summary.documentTitle} />
            <DataRecoveryStat label="分组" value={String(snapshot.summary.groupCount)} />
            <DataRecoveryStat label="网站" value={String(snapshot.summary.siteCount)} />
            <DataRecoveryStat label="组件" value={String(snapshot.summary.widgetCount)} />
            <DataRecoveryStat label="主题" value={snapshot.summary.themePresetId} />
            <DataRecoveryStat label="图片" value={formatSnapshotAssets(snapshot.summary.hasBanner, snapshot.summary.hasBackground)} />
            <DataRecoveryStat label="同步状态" value={snapshot.summary.syncStatus} />
            <DataRecoveryStat label="文档更新" value={formatDateTime(snapshot.summary.updatedAt, locale)} />
          </div>

          <StatusMessage tone="warning">
            {kind === "cloud"
              ? "这是账号托管云端历史版本的只读预览。恢复只会覆盖当前本机首页，并会暂停自动同步。"
              : "这是只读预览。恢复会覆盖当前首页，恢复前会再保存一份当前首页快照。"}
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

function formatSnapshotVersion(snapshot: PreviewableSnapshot): string {
  return `版本 ${snapshot.revision}`;
}

function formatSnapshotOption(snapshot: PreviewableSnapshot, locale: LocalePreference): string {
  return `${formatSnapshotVersion(snapshot)} · ${snapshot.summary.documentTitle} · ${formatDateTime(snapshot.createdAt, locale)} · ${snapshot.summary.siteCount} 网站`;
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

  return new Intl.DateTimeFormat(resolveLocalePreference(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function toSnapshotAnalyticsProperties(snapshot: PreviewableSnapshot) {
  return {
    groupCountBucket: bucketCount(snapshot.summary.groupCount),
    hasBanner: snapshot.summary.hasBanner,
    hasBackground: snapshot.summary.hasBackground,
    siteCountBucket: bucketCount(snapshot.summary.siteCount),
    source: snapshot.source,
    syncStatus: snapshot.summary.syncStatus,
    themePresetId: snapshot.summary.themePresetId,
    widgetCountBucket: bucketCount(snapshot.summary.widgetCount)
  };
}
