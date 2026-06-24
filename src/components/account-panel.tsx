"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { StatusMessage } from "@/components/status-message";
import type { HomeSpace } from "@/domain/account";
import type { HomeSyncMeta } from "@/domain/home-document";
import type { StoredSyncBinding } from "@/domain/sync-code";
import type { AccountDataState } from "@/hooks/use-account-data";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";

interface AccountPanelProps {
  accountData: AccountDataState;
  currentBinding?: StoredSyncBinding | null;
  currentHomeSpace?: HomeSpace | null;
  syncActionSlotId?: string;
  syncStatus?: HomeSyncMeta["status"];
}

export function AccountPanel({
  accountData,
  currentBinding = null,
  currentHomeSpace = null,
  syncActionSlotId,
  syncStatus = "local-only"
}: AccountPanelProps) {
  const [email, setEmail] = useState("");
  const {
    user,
    configured,
    loading,
    actionPending,
    message,
    error,
    signInWithMagicLink,
    signOut
  } = useSupabaseAuth();

  const accountInitial = useMemo(() => getAccountInitial(user?.email), [user?.email]);
  const accountHasError = Boolean((configured && error) || accountData.error);
  const accountStatusTone = !configured ? "warning" : accountHasError ? "danger" : accountData.profile ? "success" : "neutral";
  const authActionDisabledReason = getAuthActionDisabledReason(configured, loading, actionPending);
  const syncSummary = getAccountSyncSummary({
    configured,
    currentBinding,
    currentHomeSpace,
    signedIn: Boolean(user),
    syncStatus
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await signInWithMagicLink(email);
  }

  return (
    <section className="settings-panel account-panel" aria-label="账号登录">
      <div className="panel-header">
        <h2>账号</h2>
        <span>{user ? "Signed in" : "Magic Link"}</span>
      </div>

      {user ? (
        <div className="account-card">
          <span className="avatar account-avatar">{accountInitial}</span>
          <div className="account-card-copy">
            <strong>{user.email ?? "已登录账号"}</strong>
            <p>{getAccountDescription(accountData)}</p>
          </div>
          <button className="utility-button account-sign-out-button" type="button" onClick={signOut} disabled={actionPending} title={actionPending ? "账号操作处理中，请稍后。" : "退出当前账号"}>
            {actionPending ? "退出中" : "退出登录"}
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={!configured || loading || actionPending}
              title={authActionDisabledReason}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="utility-button" type="submit" disabled={!configured || loading || actionPending} title={authActionDisabledReason}>
            {actionPending ? "发送中" : "发送登录链接"}
          </button>
        </form>
      )}

      <div className="account-sync-summary" aria-label="账号与当前首页状态">
        <div>
          <span>当前首页</span>
          <strong>{syncSummary.title}</strong>
        </div>
        <StatusMessage tone={syncSummary.tone}>
          {syncSummary.detail}
        </StatusMessage>
        {syncActionSlotId ? (
          <div id={syncActionSlotId} className="account-sync-action-slot" />
        ) : null}
      </div>

      <StatusMessage role={accountHasError ? "alert" : "status"} tone={accountStatusTone}>
        {error || getAccountStatus(accountData, message, loading)}
      </StatusMessage>
    </section>
  );
}

function getAccountInitial(email?: string): string {
  const value = email?.trim();
  if (!value) {
    return "A";
  }

  return value.slice(0, 1).toUpperCase();
}

function getAccountDescription(accountData: AccountDataState): string {
  if (accountData.loading) {
    return "正在初始化账号资料。";
  }

  if (accountData.error) {
    return "账号已登录，但资料初始化暂时失败。";
  }

  if (accountData.profile) {
    return "账号资料和偏好已就绪。";
  }

  return "账号状态已保存在当前浏览器。";
}

function getAccountStatus(accountData: AccountDataState, authMessage: string, authLoading: boolean): string {
  if (accountData.error) {
    return `账号资料加载失败：${accountData.error}`;
  }

  if (accountData.loading) {
    return "正在读取或初始化账号资料。";
  }

  if (accountData.profile) {
    return "账号资料和偏好已就绪。";
  }

  return authMessage || (authLoading ? "正在读取账号状态。" : "登录仅建立账号身份，不会覆盖本地首页。");
}

function getAuthActionDisabledReason(configured: boolean, loading: boolean, actionPending: boolean): string | undefined {
  if (!configured) {
    return "账号与云端同步服务尚未配置 Supabase 环境变量。";
  }

  if (actionPending) {
    return "账号操作处理中，请稍后。";
  }

  if (loading) {
    return "正在读取账号状态，请稍后。";
  }

  return undefined;
}

function getAccountSyncSummary({
  configured,
  currentBinding,
  currentHomeSpace,
  signedIn,
  syncStatus
}: {
  configured: boolean;
  currentBinding: StoredSyncBinding | null;
  currentHomeSpace: HomeSpace | null;
  signedIn: boolean;
  syncStatus: HomeSyncMeta["status"];
}): { detail: string; title: string; tone: "neutral" | "info" | "success" | "warning" | "danger" } {
  if (!configured) {
    return {
      detail: "账号登录、账号托管空间和云端同步码当前不可用；本地首页仍可继续编辑。",
      title: "账号服务未配置",
      tone: "warning"
    };
  }

  if (syncStatus === "conflict") {
    if (signedIn && currentBinding) {
      return {
        detail: "云端和本地都有修改，自动同步已暂停；请在下方选择使用云端版本、本地覆盖云端或暂不处理。",
        title: "同步冲突",
        tone: "danger"
      };
    }

    return {
      detail: "云端和本地都有修改，自动同步已暂停；请在高级操作中处理同步冲突。",
      title: "同步冲突",
      tone: "danger"
    };
  }

  if (syncStatus === "paused") {
    if (signedIn && currentBinding) {
      return {
        detail: "自动同步已暂停；请在下方选择上传本地、拉取云端、解除本机或恢复备份。",
        title: "同步暂停",
        tone: "warning"
      };
    }

    return {
      detail: "自动同步已暂停；请在高级操作中选择下一步。",
      title: "同步暂停",
      tone: "warning"
    };
  }

  if (currentBinding?.accessMode === "account-managed") {
    return {
      detail: currentHomeSpace
        ? `当前本机使用账号托管空间“${currentHomeSpace.name}”，可在首页空间中管理。`
        : "当前本机使用账号托管空间，账号空间列表刷新后会显示名称。",
      title: "账号托管",
      tone: "success"
    };
  }

  if (currentBinding?.accessMode === "sync-code") {
    return {
      detail: currentHomeSpace
        ? `当前普通同步码已记录到账号空间“${currentHomeSpace.name}”。`
        : signedIn
          ? "当前浏览器绑定普通同步码；可在首页空间中认领或迁移。"
          : "当前浏览器绑定普通同步码；登录后可认领到账号。",
      title: "普通同步码",
      tone: "info"
    };
  }

  return {
    detail: signedIn
      ? "当前浏览器未绑定同步空间；可在首页空间中创建账号托管空间。"
      : "当前首页只保存在本地浏览器，登录不会自动覆盖本地内容。",
    title: "本地首页",
    tone: "neutral"
  };
}
