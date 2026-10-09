"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { resolveLocalePreference } from "@/domain/ui-preferences";
import { I18nContext, type I18nState } from "@/contexts/i18n-context";
import { createI18nFormatters } from "@/i18n/formatters";
import { createTranslator } from "@/i18n/messages";
import { useUiPreferences } from "@/hooks/use-ui-preferences";

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { preferences } = useUiPreferences();

  const value = useMemo<I18nState>(() => {
    const locale = resolveLocalePreference(preferences.locale);

    return {
      locale,
      localePreference: preferences.locale,
      t: createTranslator(locale),
      format: createI18nFormatters(locale)
    };
  }, [preferences.locale]);

  // The static export ships lang="zh-CN"; keep <html lang> in step with the active UI
  // language so screen readers and the browser pick the right pronunciation and fonts.
  useEffect(() => {
    document.documentElement.lang = value.locale;
  }, [value.locale]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
