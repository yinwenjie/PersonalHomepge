"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestConfirm } from "@/components/confirm-dialog";
import { StatusMessage, type StatusTone } from "@/components/status-message";
import type { HomeSpace } from "@/domain/account";
import {
  sortByOrder,
  type HomeSite,
  type HomeWidget
} from "@/domain/home-document";
import { getCountdownStatus, normalizeCountdownConfig } from "@/domain/countdown-widget";
import { getNotesStats, readNoteItems } from "@/domain/notes-widget";
import { bucketCount } from "@/domain/product-analytics";
import { readWorldClockItems } from "@/domain/world-clock-widget";
import { useI18n } from "@/hooks/use-i18n";
import {
  formatHomeWidgetDescription,
  formatHomeWidgetDisplayTitle,
  formatHomeWidgetTitle
} from "@/i18n/home-presentation";
import { formatSettingsSnapshotAssets } from "@/i18n/settings-presentation";
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
  const { format, t } = useI18n();
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
        setMessage(t("settings.recovery.cloudRefreshed"));
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
        setError(t("settings.recovery.cloudLoadFailed"));
      }
    } finally {
      setCloudLoading(false);
    }
  }, [canUseCloudSnapshots, currentHomeSpace?.accessMode, currentHomeSpace?.id, t]);

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
    setMessage(t("settings.recovery.localRefreshed"));
  }

  async function restoreSnapshot(snapshot: LocalHomeSnapshot) {
    const confirmMessage = hasSyncBinding
      ? t("settings.recovery.localConfirmBound")
      : t("settings.recovery.localConfirm");

    if (!(await requestConfirm(confirmMessage))) {
      return;
    }

    const restored = onRestoreSnapshot(snapshot);
    if (!restored) {
      setMessage("");
      setError(t("settings.recovery.localFailed"));
      return;
    }

    setError("");
    setMessage(hasSyncBinding
      ? t("settings.recovery.localRestoredPaused")
      : t("settings.recovery.localRestored"));
    trackProductEvent("recovery.local_restored", toSnapshotAnalyticsProperties(snapshot));
    setPreviewSnapshot(null);
    setSnapshots(loadSnapshots());
  }

  async function restoreCloudSnapshot(snapshot: CloudHomeSnapshot) {
    if (!(await requestConfirm(t("settings.recovery.cloudConfirm")))) {
      return;
    }

    const restored = onRestoreCloudSnapshot(snapshot);
    if (!restored) {
      setMessage("");
      setError(t("settings.recovery.cloudFailed"));
      return;
    }

    try {
      await new CloudHomeSnapshotRepository().recordRestoredToLocal(snapshot);
      setError("");
      setMessage(t("settings.recovery.cloudRestored"));
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
      setMessage(t("settings.recovery.cloudAuditFailed"));
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
          {t("settings.recovery.refreshLocal")}
        </button>
        {canUseCloudSnapshots ? (
          <button className="utility-button" type="button" onClick={() => void refreshCloudSnapshots()} disabled={!storageReady || cloudLoading}>
            {cloudLoading ? t("settings.recovery.refreshing") : t("settings.recovery.refreshCloud")}
          </button>
        ) : null}
      </div>

      <StatusMessage role={error ? "alert" : "status"} tone={error ? "danger" : message ? "success" : "warning"}>
        {error || message || (canUseCloudSnapshots
          ? t("settings.recovery.statusCloud")
          : t("settings.recovery.statusLocal"))}
      </StatusMessage>

      <div className="recovery-history-section">
        <div className="recovery-history-head">
          <h3>{t("settings.recovery.localHistory")}</h3>
          <span>{t("settings.recovery.currentBrowser")}</span>
        </div>
        {selectedLocalSnapshot ? (
          <SnapshotSelector
            formatDateTime={format.dateTime}
            label={t("settings.recovery.selectLocal")}
            snapshots={visibleSnapshots}
            selectedSnapshot={selectedLocalSnapshot}
            t={t}
            value={selectedLocalSnapshot.id}
            onChange={setSelectedLocalSnapshotId}
            onPreview={(snapshot) => {
              const localSnapshot = snapshot as LocalHomeSnapshot;
              trackProductEvent("recovery.local_previewed", toSnapshotAnalyticsProperties(snapshot));
              setPreviewSnapshot({ kind: "local", snapshot: localSnapshot });
            }}
            onRestore={(snapshot) => restoreSnapshot(snapshot as LocalHomeSnapshot)}
            restoreLabel={t("settings.recovery.restore")}
            storageReady={storageReady}
          />
        ) : (
          <StatusMessage tone="neutral">
            {storageReady ? t("settings.recovery.noLocal") : t("settings.common.storageNotReady")}
          </StatusMessage>
        )}
      </div>

      {canUseCloudSnapshots ? (
        <div className="recovery-history-section">
          <div className="recovery-history-head">
            <h3>{t("settings.recovery.cloudHistory")}</h3>
            <span>{currentHomeSpace?.name ?? t("settings.recovery.accountManagedSpace")}</span>
          </div>
          {selectedCloudSnapshot ? (
            <SnapshotSelector
              formatDateTime={format.dateTime}
              label={t("settings.recovery.selectCloud")}
              snapshots={visibleCloudSnapshots}
              selectedSnapshot={selectedCloudSnapshot}
              t={t}
              value={selectedCloudSnapshot.id}
              onChange={setSelectedCloudSnapshotId}
              onPreview={(snapshot) => {
                const cloudSnapshot = snapshot as CloudHomeSnapshot;
                trackProductEvent("recovery.cloud_previewed", toSnapshotAnalyticsProperties(snapshot));
                setPreviewSnapshot({ kind: "cloud", snapshot: cloudSnapshot });
              }}
              onRestore={(snapshot) => void restoreCloudSnapshot(snapshot as CloudHomeSnapshot)}
              restoreLabel={t("settings.recovery.restoreToLocal")}
              storageReady={storageReady}
            />
          ) : (
            <StatusMessage tone="neutral">
              {cloudLoading ? t("settings.recovery.cloudLoading") : t("settings.recovery.noCloud")}
            </StatusMessage>
          )}
        </div>
      ) : null}

      {previewSnapshot ? (
        <SnapshotPreviewDialog
          format={format}
          formatDateTime={format.dateTime}
          kind={previewSnapshot.kind}
          snapshot={previewSnapshot.snapshot}
          t={t}
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
    <section className="settings-panel data-recovery-center" aria-label={t("settings.recovery.panelAria")}>
      <div className="panel-header">
        <h2>{t("settings.section.dataRecovery.title")}</h2>
        <span>{t("settings.section.dataRecovery.kicker")}</span>
      </div>
      {content}
    </section>
  );
}

type PreviewableSnapshot = LocalHomeSnapshot | CloudHomeSnapshot;

function SnapshotSelector({
  formatDateTime,
  label,
  onChange,
  onPreview,
  onRestore,
  restoreLabel,
  selectedSnapshot,
  snapshots,
  storageReady,
  t,
  value
}: {
  formatDateTime: (value: Date | string | number) => string;
  label: string;
  onChange: (snapshotId: string) => void;
  onPreview: (snapshot: PreviewableSnapshot) => void;
  onRestore: (snapshot: PreviewableSnapshot) => void;
  restoreLabel: string;
  selectedSnapshot: PreviewableSnapshot;
  snapshots: PreviewableSnapshot[];
  storageReady: boolean;
  t: ReturnType<typeof useI18n>["t"];
  value: string;
}) {
  return (
    <div className="snapshot-selector">
      <label className="field">
        <span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>
              {formatSnapshotOption(snapshot, formatDateTime, t)}
            </option>
          ))}
        </select>
      </label>

      <article className="local-snapshot-card snapshot-selector-card">
        <SnapshotCardCopy formatDateTime={formatDateTime} snapshot={selectedSnapshot} t={t} />
        <div className="settings-actions local-snapshot-actions">
          <button className="utility-button" type="button" onClick={() => onPreview(selectedSnapshot)}>
            {t("settings.recovery.preview")}
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
  formatDateTime,
  snapshot,
  t
}: {
  formatDateTime: (value: Date | string | number) => string;
  snapshot: PreviewableSnapshot;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="local-snapshot-copy">
      <div className="local-snapshot-title">
        <strong>{formatSnapshotVersion(snapshot, t)}</strong>
        <time>{formatDateTime(snapshot.createdAt)}</time>
      </div>
      <div className="local-snapshot-meta">
        <span>{t("settings.recovery.meta.title", { title: snapshot.summary.documentTitle })}</span>
        <span>{t("settings.recovery.meta.groups", { count: snapshot.summary.groupCount })}</span>
        <span>{t("settings.recovery.meta.sites", { count: snapshot.summary.siteCount })}</span>
        <span>{t("settings.recovery.meta.widgets", { count: snapshot.summary.widgetCount })}</span>
        <span>{t("settings.recovery.meta.theme", { theme: snapshot.summary.themePresetId })}</span>
        <span>{formatSettingsSnapshotAssets(snapshot.summary.hasBanner, snapshot.summary.hasBackground, t)}</span>
        <span>{t("settings.recovery.meta.updated", { time: formatDateTime(snapshot.summary.updatedAt) })}</span>
      </div>
    </div>
  );
}

interface SnapshotPreviewDialogProps {
  format: ReturnType<typeof useI18n>["format"];
  formatDateTime: (value: Date | string | number) => string;
  kind: "cloud" | "local";
  snapshot: PreviewableSnapshot;
  t: ReturnType<typeof useI18n>["t"];
  onClose: () => void;
  onRestore: () => void;
}

function SnapshotPreviewDialog({
  format,
  formatDateTime,
  kind,
  snapshot,
  t,
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
            <h2 id="snapshotPreviewDialogTitle">{t("settings.recovery.previewTitle")}</h2>
            <p>{formatSnapshotVersion(snapshot, t)} · {formatDateTime(snapshot.createdAt)}</p>
          </div>
          <button className="utility-button" type="button" onClick={onClose}>{t("settings.common.cancel")}</button>
        </header>
        <div className="settings-dialog-body">
          <div className="data-restore-summary">
            <DataRecoveryStat label={t("settings.recovery.stat.title")} value={snapshot.summary.documentTitle} />
            <DataRecoveryStat label={t("settings.recovery.stat.groups")} value={String(snapshot.summary.groupCount)} />
            <DataRecoveryStat label={t("settings.recovery.stat.sites")} value={String(snapshot.summary.siteCount)} />
            <DataRecoveryStat label={t("settings.recovery.stat.widgets")} value={String(snapshot.summary.widgetCount)} />
            <DataRecoveryStat label={t("settings.recovery.stat.theme")} value={snapshot.summary.themePresetId} />
            <DataRecoveryStat label={t("settings.recovery.stat.images")} value={formatSettingsSnapshotAssets(snapshot.summary.hasBanner, snapshot.summary.hasBackground, t)} />
            <DataRecoveryStat label={t("settings.recovery.stat.syncStatus")} value={snapshot.summary.syncStatus} />
            <DataRecoveryStat label={t("settings.recovery.stat.updated")} value={formatDateTime(snapshot.summary.updatedAt)} />
          </div>

          <StatusMessage tone="warning">
            {kind === "cloud"
              ? t("settings.recovery.previewCloudWarning")
              : t("settings.recovery.previewLocalWarning")}
          </StatusMessage>

          <div className="snapshot-preview-section">
            <div className="snapshot-preview-section-head">
              <h3>{t("settings.recovery.groups")}</h3>
              <span>{t("settings.recovery.siteCount", { count: snapshot.summary.siteCount })}</span>
            </div>
            {groups.length > 0 ? (
              <div className="snapshot-preview-group-list">
                {groups.map((group) => {
                  const sites = sortByOrder(group.sites);

                  return (
                    <article className="snapshot-preview-group" key={group.id}>
                      <header>
                        <strong>{group.title}</strong>
                        <span>{t("settings.recovery.siteCount", { count: sites.length })}</span>
                      </header>
                      {sites.length > 0 ? (
                        <ul className="snapshot-preview-site-list">
                          {sites.map((site) => (
                            <SnapshotPreviewSite site={site} key={site.id} />
                          ))}
                        </ul>
                      ) : (
                        <p className="snapshot-preview-empty">{t("settings.recovery.emptySites")}</p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="snapshot-preview-empty">{t("settings.recovery.emptyGroups")}</p>
            )}
          </div>

          <div className="snapshot-preview-section">
            <div className="snapshot-preview-section-head">
              <h3>{t("settings.recovery.widgets")}</h3>
              <span>{t("settings.recovery.widgetCount", { count: widgets.length })}</span>
            </div>
            {widgets.length > 0 ? (
              <div className="snapshot-preview-widget-list">
                {widgets.map((widget) => (
                  <SnapshotPreviewWidget format={format} widget={widget} key={widget.id} t={t} />
                ))}
              </div>
            ) : (
              <p className="snapshot-preview-empty">{t("settings.recovery.emptyWidgets")}</p>
            )}
          </div>
        </div>
        <footer className="settings-dialog-footer">
          <button className="utility-button" type="button" onClick={onClose}>{t("settings.common.cancel")}</button>
          <button className="danger-button" type="button" onClick={onRestore}>{t("settings.recovery.restoreVersion")}</button>
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

function SnapshotPreviewWidget({
  format,
  widget,
  t
}: {
  format: ReturnType<typeof useI18n>["format"];
  widget: HomeWidget;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <article className="snapshot-preview-widget">
      <strong>{formatHomeWidgetDisplayTitle(widget, t)}</strong>
      <span>
        {formatHomeWidgetTitle(widget.type, t)} · {formatSnapshotWidgetSummary(widget, t, format)} · {widget.layout.collapsed ? t("settings.recovery.widgetCollapsed") : t("settings.recovery.widgetExpanded")}
      </span>
    </article>
  );
}

function formatSnapshotWidgetSummary(
  widget: HomeWidget,
  t: ReturnType<typeof useI18n>["t"],
  format: ReturnType<typeof useI18n>["format"]
): string {
  if (widget.type === "notes.list") {
    const stats = getNotesStats(readNoteItems(widget.config));
    return stats.total === 0
      ? t("notes.empty")
      : t("notes.summary", { count: format.number(stats.total) });
  }

  if (widget.type === "countdown.timer") {
    const status = getCountdownStatus(normalizeCountdownConfig(widget.config));

    switch (status.kind) {
      case "future":
        return t("countdown.statusFuture");
      case "today":
        return t("countdown.statusToday");
      case "past":
        return t("countdown.statusPast");
      case "unconfigured":
        return t("countdown.statusUnconfigured");
    }
  }

  if (widget.type === "world-clock.list") {
    const total = readWorldClockItems(widget.config).length;
    return total === 0
      ? t("worldClock.empty")
      : t("worldClock.summary", { count: format.number(total) });
  }

  return formatHomeWidgetDescription(widget.type, t);
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

function formatSnapshotVersion(snapshot: PreviewableSnapshot, t: ReturnType<typeof useI18n>["t"]): string {
  return t("settings.recovery.version", { revision: snapshot.revision });
}

function formatSnapshotOption(snapshot: PreviewableSnapshot, formatDateTime: (value: Date | string | number) => string, t: ReturnType<typeof useI18n>["t"]): string {
  return t("settings.recovery.option", {
    sites: snapshot.summary.siteCount,
    time: formatDateTime(snapshot.createdAt),
    title: snapshot.summary.documentTitle,
    version: formatSnapshotVersion(snapshot, t)
  });
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
