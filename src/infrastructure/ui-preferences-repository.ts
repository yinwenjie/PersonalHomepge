import {
  DEFAULT_UI_PREFERENCES,
  normalizeUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
  type UiPreferences
} from "@/domain/ui-preferences";

export class LocalUiPreferencesRepository {
  constructor(private readonly storage: Storage) {}

  load(): UiPreferences {
    const rawValue = this.storage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_UI_PREFERENCES;
    }

    try {
      return normalizeUiPreferences(JSON.parse(rawValue) as unknown as Partial<UiPreferences>);
    } catch {
      return DEFAULT_UI_PREFERENCES;
    }
  }

  save(preferences: UiPreferences): void {
    this.storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeUiPreferences(preferences)));
  }
}
