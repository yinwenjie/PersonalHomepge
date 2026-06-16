export const UI_PREFERENCES_STORAGE_KEY = "homepage:ui-preferences:v1";

export type LocalePreference = "zh-CN" | "en-US";
export type ThemePreference = "system" | "light" | "dark";
export type FontFamilyPreference = "system" | "serif" | "mono";
export type DensityPreference = "comfortable" | "compact";
export type SearchEnginePreference = "duckduckgo" | "google" | "bing" | "baidu";

export interface UiPreferences {
  locale: LocalePreference;
  themePreference: ThemePreference;
  fontFamily: FontFamilyPreference;
  density: DensityPreference;
  defaultSearchEngine: SearchEnginePreference;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  locale: "zh-CN",
  themePreference: "system",
  fontFamily: "system",
  density: "comfortable",
  defaultSearchEngine: "duckduckgo"
};

export const LOCALE_OPTIONS: Array<{ value: LocalePreference; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" }
];

export const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" }
];

export const FONT_FAMILY_OPTIONS: Array<{ value: FontFamilyPreference; label: string }> = [
  { value: "system", label: "系统默认" },
  { value: "serif", label: "衬线" },
  { value: "mono", label: "等宽" }
];

export const DENSITY_OPTIONS: Array<{ value: DensityPreference; label: string }> = [
  { value: "comfortable", label: "舒适" },
  { value: "compact", label: "紧凑" }
];

export const SEARCH_ENGINE_OPTIONS: Array<{ value: SearchEnginePreference; label: string }> = [
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "google", label: "Google" },
  { value: "bing", label: "Bing" },
  { value: "baidu", label: "Baidu" }
];

export function normalizeUiPreferences(input: Partial<Record<keyof UiPreferences, unknown>> | null | undefined): UiPreferences {
  return {
    locale: normalizeLocale(input?.locale),
    themePreference: normalizeThemePreference(input?.themePreference),
    fontFamily: normalizeFontFamily(input?.fontFamily),
    density: normalizeDensity(input?.density),
    defaultSearchEngine: normalizeSearchEngine(input?.defaultSearchEngine)
  };
}

export function searchEngineLabel(searchEngine: SearchEnginePreference): string {
  return SEARCH_ENGINE_OPTIONS.find((option) => option.value === searchEngine)?.label ?? "DuckDuckGo";
}

export function buildSearchUrl(searchEngine: SearchEnginePreference, keyword: string): string {
  const query = encodeURIComponent(keyword);

  if (searchEngine === "google") {
    return `https://www.google.com/search?q=${query}`;
  }

  if (searchEngine === "bing") {
    return `https://www.bing.com/search?q=${query}`;
  }

  if (searchEngine === "baidu") {
    return `https://www.baidu.com/s?wd=${query}`;
  }

  return `https://duckduckgo.com/?q=${query}`;
}

function normalizeLocale(value: unknown): LocalePreference {
  return value === "en-US" ? "en-US" : DEFAULT_UI_PREFERENCES.locale;
}

function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }

  return DEFAULT_UI_PREFERENCES.themePreference;
}

function normalizeFontFamily(value: unknown): FontFamilyPreference {
  if (value === "serif" || value === "mono" || value === "system") {
    return value;
  }

  return DEFAULT_UI_PREFERENCES.fontFamily;
}

function normalizeDensity(value: unknown): DensityPreference {
  return value === "compact" ? "compact" : DEFAULT_UI_PREFERENCES.density;
}

function normalizeSearchEngine(value: unknown): SearchEnginePreference {
  if (value === "google" || value === "bing" || value === "baidu" || value === "duckduckgo") {
    return value;
  }

  return DEFAULT_UI_PREFERENCES.defaultSearchEngine;
}
