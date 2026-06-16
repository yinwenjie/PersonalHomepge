"use client";

import { useMemo, useState } from "react";
import {
  DENSITY_OPTIONS,
  FONT_FAMILY_OPTIONS,
  LOCALE_OPTIONS,
  normalizeUiPreferences,
  SEARCH_ENGINE_OPTIONS,
  THEME_OPTIONS,
  type UiPreferences
} from "@/domain/ui-preferences";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import type { AccountDataState } from "@/hooks/use-account-data";

interface AccountPreferencesPanelProps {
  accountData: AccountDataState;
  authLoading: boolean;
  signedIn: boolean;
}

export function AccountPreferencesPanel({ accountData, authLoading, signedIn }: AccountPreferencesPanelProps) {
  const uiPreferences = useUiPreferences();
  const accountPreferencesReady = Boolean(signedIn && accountData.preferences && !accountData.error);
  const usesAccountPreferences = accountPreferencesReady;
  const basePreferences = useMemo(() => {
    if (accountPreferencesReady && accountData.preferences) {
      return normalizeUiPreferences({
        locale: accountData.preferences.locale,
        themePreference: accountData.preferences.themePreference,
        fontFamily: accountData.preferences.fontFamily,
        density: accountData.preferences.density,
        defaultSearchEngine: accountData.preferences.defaultSearchEngine
      });
    }

    return uiPreferences.preferences;
  }, [accountData.preferences, accountPreferencesReady, uiPreferences.preferences]);
  const defaultSpaceName = useMemo(() => {
    const defaultSpaceId = accountData.preferences?.defaultSpaceId;
    if (!defaultSpaceId) {
      return "未设置";
    }

    return accountData.homeSpaces.find((homeSpace) => homeSpace.id === defaultSpaceId)?.name ?? defaultSpaceId;
  }, [accountData.homeSpaces, accountData.preferences?.defaultSpaceId]);
  const formDisabled = authLoading || accountData.loading;

  return (
    <section className="settings-panel" aria-label="通用设置">
      <div className="panel-header">
        <h2>通用设置</h2>
        <span>{signedIn ? "Account" : "Local"}</span>
      </div>

      {authLoading ? (
        <div className="settings-placeholder">
          <strong>正在读取账号状态</strong>
          <p>账号状态确认前，会先使用当前浏览器的本地偏好。</p>
        </div>
      ) : (
        <>
          {signedIn && accountData.error ? (
            <div className="settings-placeholder">
              <strong>账号偏好加载失败</strong>
              <p className="form-error">{accountData.error}</p>
              <p>当前页面继续使用本地偏好，不会尝试写入账号表。</p>
            </div>
          ) : null}

          <PreferencesEditor
            key={preferencesKey(basePreferences)}
            accountData={accountData}
            basePreferences={basePreferences}
            defaultSpaceName={defaultSpaceName}
            formDisabled={formDisabled}
            usesAccountPreferences={usesAccountPreferences}
          />
        </>
      )}
    </section>
  );
}

interface PreferencesEditorProps {
  accountData: AccountDataState;
  basePreferences: UiPreferences;
  defaultSpaceName: string;
  formDisabled: boolean;
  usesAccountPreferences: boolean;
}

function PreferencesEditor({
  accountData,
  basePreferences,
  defaultSpaceName,
  formDisabled,
  usesAccountPreferences
}: PreferencesEditorProps) {
  const uiPreferences = useUiPreferences();
  const [formValues, setFormValues] = useState<UiPreferences>(basePreferences);
  const [localMessage, setLocalMessage] = useState("");
  const saving = accountData.updatingPreferences;
  const controlsDisabled = formDisabled || saving;
  const formChanged = !preferencesEqual(formValues, basePreferences);
  const statusMessage = accountData.preferencesError
    || localMessage
    || accountData.preferencesMessage
    || uiPreferences.error
    || (usesAccountPreferences ? "账号偏好会同步到当前账号。" : "偏好仅保存在当前浏览器。");

  async function savePreferences() {
    const normalized = normalizeUiPreferences(formValues);
    setLocalMessage("");

    if (usesAccountPreferences) {
      const updated = await accountData.updatePreferences(normalized);
      if (updated) {
        uiPreferences.applyAccountPreferences(updated);
      }
      return;
    }

    uiPreferences.updateLocalPreferences(normalized);
    setLocalMessage("本地偏好已保存。");
  }

  return (
    <>
      <div className="preference-form-grid">
        <label className="field">
          <span>语言</span>
          <select
            value={formValues.locale}
            disabled={controlsDisabled}
            onChange={(event) => setFormValues((current) => normalizeUiPreferences({ ...current, locale: event.target.value }))}
          >
            {LOCALE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>主题偏好</span>
          <select
            value={formValues.themePreference}
            disabled={controlsDisabled}
            onChange={(event) => setFormValues((current) => normalizeUiPreferences({ ...current, themePreference: event.target.value }))}
          >
            {THEME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>字体</span>
          <select
            value={formValues.fontFamily}
            disabled={controlsDisabled}
            onChange={(event) => setFormValues((current) => normalizeUiPreferences({ ...current, fontFamily: event.target.value }))}
          >
            {FONT_FAMILY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>界面密度</span>
          <select
            value={formValues.density}
            disabled={controlsDisabled}
            onChange={(event) => setFormValues((current) => normalizeUiPreferences({ ...current, density: event.target.value }))}
          >
            {DENSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>默认搜索引擎</span>
          <select
            value={formValues.defaultSearchEngine}
            disabled={controlsDisabled}
            onChange={(event) => setFormValues((current) => normalizeUiPreferences({ ...current, defaultSearchEngine: event.target.value }))}
          >
            {SEARCH_ENGINE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <div className="preference-readonly-row">
          <span>默认首页空间</span>
          <strong>{defaultSpaceName}</strong>
        </div>
      </div>

      <div className="settings-actions">
        <button className="utility-button" type="button" disabled={controlsDisabled || !formChanged} onClick={savePreferences}>
          {saving ? "保存中" : "保存偏好"}
        </button>
      </div>

      <p className={accountData.preferencesError || uiPreferences.error ? "form-error" : "save-status"}>
        {statusMessage}
      </p>
    </>
  );
}

function preferencesEqual(left: UiPreferences, right: UiPreferences): boolean {
  return left.locale === right.locale
    && left.themePreference === right.themePreference
    && left.fontFamily === right.fontFamily
    && left.density === right.density
    && left.defaultSearchEngine === right.defaultSearchEngine;
}

function preferencesKey(preferences: UiPreferences): string {
  return [
    preferences.locale,
    preferences.themePreference,
    preferences.fontFamily,
    preferences.density,
    preferences.defaultSearchEngine
  ].join(":");
}
