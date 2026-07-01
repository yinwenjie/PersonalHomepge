export const UI_PREFERENCES_STORAGE_KEY = "homepage:ui-preferences:v1";

export const SUPPORTED_RESOLVED_LOCALES = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "fr-FR",
  "es-ES",
  "ja-JP",
  "ko-KR",
  "it-IT"
] as const;

export type ResolvedLocale = typeof SUPPORTED_RESOLVED_LOCALES[number];
export type LocalePreference = "system" | ResolvedLocale;
export const DEFAULT_RESOLVED_LOCALE: ResolvedLocale = "zh-CN";
export type ThemePreference = "system" | "light" | "dark";
export type FontFamilyPreference = "system" | "serif" | "mono";
export type DensityPreference = "comfortable" | "compact";
export type SearchEnginePreference = "duckduckgo" | "google" | "bing" | "yandex";

export interface SearchEngineDefinition {
  id: SearchEnginePreference;
  iconText: string;
  label: string;
  searchUrl: (keyword: string) => string;
}

export interface UiPreferences {
  locale: LocalePreference;
  themePreference: ThemePreference;
  fontFamily: FontFamilyPreference;
  density: DensityPreference;
  defaultSearchEngine: SearchEnginePreference;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  locale: DEFAULT_RESOLVED_LOCALE,
  themePreference: "system",
  fontFamily: "system",
  density: "comfortable",
  defaultSearchEngine: "duckduckgo"
};

export const LOCALE_OPTIONS: Array<{ value: LocalePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" },
  { value: "fr-FR", label: "Français" },
  { value: "es-ES", label: "Español" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "it-IT", label: "Italiano" }
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

export const SEARCH_ENGINE_DEFINITIONS: Record<SearchEnginePreference, SearchEngineDefinition> = {
  duckduckgo: {
    id: "duckduckgo",
    iconText: "D",
    label: "DuckDuckGo",
    searchUrl: (keyword) => `https://duckduckgo.com/?q=${encodeURIComponent(keyword)}`
  },
  google: {
    id: "google",
    iconText: "G",
    label: "Google",
    searchUrl: (keyword) => `https://www.google.com/search?q=${encodeURIComponent(keyword)}`
  },
  bing: {
    id: "bing",
    iconText: "B",
    label: "Bing",
    searchUrl: (keyword) => `https://www.bing.com/search?q=${encodeURIComponent(keyword)}`
  },
  yandex: {
    id: "yandex",
    iconText: "Y",
    label: "Yandex",
    searchUrl: (keyword) => `https://yandex.com/search/?text=${encodeURIComponent(keyword)}`
  }
};

export const SEARCH_ENGINE_OPTIONS: Array<{ value: SearchEnginePreference; label: string }> = Object.values(SEARCH_ENGINE_DEFINITIONS)
  .map((definition) => ({ value: definition.id, label: definition.label }));

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
  return getSearchEngineDefinition(searchEngine).label;
}

export function buildSearchUrl(searchEngine: SearchEnginePreference, keyword: string): string {
  return getSearchEngineDefinition(searchEngine).searchUrl(keyword);
}

export function getSearchEngineDefinition(searchEngine: SearchEnginePreference): SearchEngineDefinition {
  return SEARCH_ENGINE_DEFINITIONS[searchEngine] ?? SEARCH_ENGINE_DEFINITIONS.duckduckgo;
}

export function localePreferenceLabel(locale: LocalePreference): string {
  return LOCALE_OPTIONS.find((option) => option.value === locale)?.label ?? locale;
}

export function resolveLocalePreference(locale: LocalePreference, candidates = getBrowserLocaleCandidates()): ResolvedLocale {
  if (locale !== "system") {
    return locale;
  }

  for (const candidate of candidates) {
    const matchedLocale = matchSupportedLocale(candidate);
    if (matchedLocale) {
      return matchedLocale;
    }
  }

  return DEFAULT_RESOLVED_LOCALE;
}

function normalizeLocale(value: unknown): LocalePreference {
  if (typeof value === "string" && (value === "system" || isResolvedLocale(value))) {
    return value;
  }

  return DEFAULT_UI_PREFERENCES.locale;
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
  if (value === "google" || value === "bing" || value === "yandex" || value === "duckduckgo") {
    return value;
  }

  return DEFAULT_UI_PREFERENCES.defaultSearchEngine;
}

function isResolvedLocale(value: string): value is ResolvedLocale {
  return (SUPPORTED_RESOLVED_LOCALES as readonly string[]).includes(value);
}

function getBrowserLocaleCandidates(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }

  return navigator.languages.length > 0 ? [...navigator.languages] : [navigator.language];
}

function matchSupportedLocale(rawValue: string): ResolvedLocale | null {
  const normalized = rawValue.replace("_", "-");
  const exactMatch = SUPPORTED_RESOLVED_LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }

  const [language = "", region = ""] = normalized.toLowerCase().split("-");
  switch (language) {
    case "zh":
      return region === "tw" || region === "hk" || region === "mo" || normalized.toLowerCase().includes("hant")
        ? "zh-TW"
        : "zh-CN";
    case "en":
      return "en-US";
    case "fr":
      return "fr-FR";
    case "es":
      return "es-ES";
    case "ja":
      return "ja-JP";
    case "ko":
      return "ko-KR";
    case "it":
      return "it-IT";
    default:
      return null;
  }
}
