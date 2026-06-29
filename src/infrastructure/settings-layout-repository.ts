import {
  DEFAULT_SETTINGS_LAYOUT_PREFERENCES,
  normalizeSettingsLayoutPreferences,
  SETTINGS_LAYOUT_STORAGE_KEY,
  type SettingsLayoutPreferences
} from "@/domain/settings-layout";

export class LocalSettingsLayoutRepository {
  constructor(private readonly storage: Storage) {}

  load(): SettingsLayoutPreferences {
    try {
      const rawValue = this.storage.getItem(SETTINGS_LAYOUT_STORAGE_KEY);
      if (!rawValue) {
        return DEFAULT_SETTINGS_LAYOUT_PREFERENCES;
      }

      return normalizeSettingsLayoutPreferences(JSON.parse(rawValue) as unknown);
    } catch {
      return DEFAULT_SETTINGS_LAYOUT_PREFERENCES;
    }
  }

  save(preferences: SettingsLayoutPreferences): void {
    try {
      this.storage.setItem(
        SETTINGS_LAYOUT_STORAGE_KEY,
        JSON.stringify(normalizeSettingsLayoutPreferences(preferences))
      );
    } catch {
      // Layout preferences are best-effort local UI state.
    }
  }
}
