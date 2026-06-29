export const SETTINGS_LAYOUT_STORAGE_KEY = "homepage:settings-layout:v1";

export type SettingsSectionId =
  | "account"
  | "home-spaces"
  | "theme-style"
  | "theme-images"
  | "account-preferences"
  | "data-recovery"
  | "advanced";

export interface SettingsLayoutPreferences {
  expandedSectionIds: SettingsSectionId[];
}

export const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  "account",
  "home-spaces",
  "theme-style",
  "theme-images",
  "account-preferences",
  "data-recovery",
  "advanced"
];

export const DEFAULT_SETTINGS_LAYOUT_PREFERENCES: SettingsLayoutPreferences = {
  expandedSectionIds: []
};

export function normalizeSettingsLayoutPreferences(input: unknown): SettingsLayoutPreferences {
  if (!input || typeof input !== "object") {
    return DEFAULT_SETTINGS_LAYOUT_PREFERENCES;
  }

  const value = input as Partial<Record<keyof SettingsLayoutPreferences, unknown>>;
  const expandedSectionIds = Array.isArray(value.expandedSectionIds)
    ? value.expandedSectionIds.filter(isSettingsSectionId)
    : DEFAULT_SETTINGS_LAYOUT_PREFERENCES.expandedSectionIds;

  return {
    expandedSectionIds: Array.from(new Set(expandedSectionIds))
  };
}

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && SETTINGS_SECTION_IDS.includes(value as SettingsSectionId);
}
