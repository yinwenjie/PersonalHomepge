"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";

export function AccountPanel() {
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
            <p>账号状态已保存在当前浏览器。首页内容仍由同步码管理。</p>
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

      <p className={error ? "form-error" : "save-status"}>
        {error || message || (loading ? "正在读取账号状态。" : "登录仅建立账号身份，不会覆盖本地首页。")}
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
