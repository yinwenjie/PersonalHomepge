"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type { AccountDataState } from "@/hooks/use-account-data";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";

interface AccountPanelProps {
  accountData: AccountDataState;
}

export function AccountPanel({ accountData }: AccountPanelProps) {
  const [email, setEmail] = useState("");
  const {
    user,
    loading,
    actionPending,
    message,
    error,
    signInWithMagicLink,
    signOut
  } = useSupabaseAuth();

  const accountInitial = useMemo(() => getAccountInitial(user?.email), [user?.email]);

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
          <div>
            <strong>{user.email ?? "已登录账号"}</strong>
            <p>{getAccountDescription(accountData)}</p>
          </div>
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
              disabled={loading || actionPending}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="utility-button" type="submit" disabled={loading || actionPending}>
            {actionPending ? "发送中" : "发送登录链接"}
          </button>
        </form>
      )}

      {user ? (
        <div className="settings-actions">
          <button className="utility-button" type="button" onClick={signOut} disabled={actionPending}>
            {actionPending ? "退出中" : "退出登录"}
          </button>
        </div>
      ) : null}

      <p className={error || accountData.error ? "form-error" : "save-status"}>
        {error || getAccountStatus(accountData, message, loading)}
      </p>
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
    return "正在初始化账号资料。首页内容仍由同步码管理。";
  }

  if (accountData.error) {
    return "账号已登录，但资料初始化暂时失败。";
  }

  if (accountData.profile) {
    return "账号资料已保存。首页内容仍由同步码管理。";
  }

  return "账号状态已保存在当前浏览器。首页内容仍由同步码管理。";
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
