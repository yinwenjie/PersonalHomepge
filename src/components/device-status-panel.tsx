"use client";

import { useEffect, useState } from "react";
import type { HomeSpace } from "@/domain/account";
import type { HomeDocumentV2 } from "@/domain/home-document";
import {
  getHomeDocumentClassLabel,
  type DocumentProtectionState
} from "@/domain/home-document-protection";
import type { LocalePreference } from "@/domain/ui-preferences";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import {
  formatDeviceShortId,
  loadOrTouchLocalDevice,
  type LocalDeviceRecord
} from "@/infrastructure/local-device-repository";
import type { StoredSyncBinding } from "@/domain/sync-code";

interface DeviceStatusPanelProps {
  currentBinding: StoredSyncBinding | null;
  currentHomeSpace: HomeSpace | null;
  documentProtection: DocumentProtectionState;
  documentValue: HomeDocumentV2;
  signedIn: boolean;
}

export function DeviceStatusPanel({
  currentBinding,
  currentHomeSpace,
  documentProtection,
  documentValue,
  signedIn
}: DeviceStatusPanelProps) {
  const { preferences } = useUiPreferences();
  const [device, setDevice] = useState<LocalDeviceRecord | null>(null);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setDevice(loadOrTouchLocalDevice());
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  const bindingLabel = currentBinding
    ? currentBinding.accessMode === "account-managed"
      ? "账号托管"
      : "同步码"
    : "未绑定";

  return (
    <div className="advanced-operation-block">
      <div className="advanced-operation-head">
        <h3>本机状态</h3>
        <span>Device</span>
      </div>
      <div className="device-status-grid">
        <DeviceStatusItem label="本机 ID" value={formatDeviceShortId(device?.id)} />
        <DeviceStatusItem label="账号状态" value={signedIn ? "已登录" : "未登录"} />
        <DeviceStatusItem label="同步方式" value={bindingLabel} />
        <DeviceStatusItem label="首页空间" value={currentHomeSpace?.name ?? currentBinding?.spaceId ?? "本地首页"} />
        <DeviceStatusItem label="首页状态" value={documentValue.syncMeta.status} />
        <DeviceStatusItem label="数据分类" value={getHomeDocumentClassLabel(documentProtection)} />
        <DeviceStatusItem label="本地版本" value={`rev ${documentValue.revision}`} />
        <DeviceStatusItem label="文档更新" value={formatDateTime(documentValue.updatedAt, preferences.locale)} />
        <DeviceStatusItem label="最后在线" value={formatDateTime(device?.lastSeenAt, preferences.locale)} />
      </div>
    </div>
  );
}

function DeviceStatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="device-status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDateTime(value: string | null | undefined, locale: LocalePreference): string {
  if (!value) {
    return "未知";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
