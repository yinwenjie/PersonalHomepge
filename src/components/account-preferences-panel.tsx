"use client";

import type { AccountDataState } from "@/hooks/use-account-data";

interface AccountPreferencesPanelProps {
  accountData: AccountDataState;
  authLoading: boolean;
  signedIn: boolean;
}

export function AccountPreferencesPanel({ accountData, authLoading, signedIn }: AccountPreferencesPanelProps) {
  const preferences = accountData.preferences;

  return (
    <section className="settings-panel" aria-label="通用设置">
      <div className="panel-header">
        <h2>通用设置</h2>
        <span>{signedIn ? "Account" : "Sign in"}</span>
      </div>

      {authLoading ? (
        <div className="settings-placeholder">
          <strong>正在读取账号状态</strong>
          <p>账号偏好会在登录状态确认后显示。</p>
        </div>
      ) : !signedIn ? (
        <div className="settings-placeholder">
          <strong>登录后同步账号偏好</strong>
          <p>这里会展示语言、主题偏好和默认首页空间。当前浏览器首页不会被覆盖。</p>
        </div>
      ) : accountData.error ? (
        <div className="settings-placeholder">
          <strong>账号偏好加载失败</strong>
          <p className="form-error">{accountData.error}</p>
        </div>
      ) : (
        <>
          <div className="preference-grid">
            <div className="preference-row">
              <span>语言</span>
              <strong>{preferences?.locale ?? "读取中"}</strong>
            </div>
            <div className="preference-row">
              <span>主题偏好</span>
              <strong>{preferences?.themePreference ?? "读取中"}</strong>
            </div>
            <div className="preference-row">
              <span>默认首页空间</span>
              <strong>{preferences?.defaultSpaceId ?? "未设置"}</strong>
            </div>
          </div>
          <p className="save-status">
            {accountData.loading ? "正在初始化账号偏好。" : "当前阶段仅展示账号偏好骨架，不会改变首页显示。"}
          </p>
        </>
      )}
    </section>
  );
}
