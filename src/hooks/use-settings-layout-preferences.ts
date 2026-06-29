"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS_LAYOUT_PREFERENCES,
  type SettingsLayoutPreferences,
  type SettingsSectionId
} from "@/domain/settings-layout";
import { LocalSettingsLayoutRepository } from "@/infrastructure/settings-layout-repository";

export function useSettingsLayoutPreferences() {
  const repositoryRef = useRef<LocalSettingsLayoutRepository | null>(null);
  const [preferences, setPreferences] = useState<SettingsLayoutPreferences>(DEFAULT_SETTINGS_LAYOUT_PREFERENCES);

  useEffect(() => {
    try {
      repositoryRef.current = new LocalSettingsLayoutRepository(window.localStorage);
      setPreferences(repositoryRef.current.load());
    } catch {
      repositoryRef.current = null;
      setPreferences(DEFAULT_SETTINGS_LAYOUT_PREFERENCES);
    }
  }, []);

  const setSectionExpanded = useCallback((sectionId: SettingsSectionId, expanded: boolean) => {
    setPreferences((current) => {
      const nextExpandedSectionIds = expanded
        ? Array.from(new Set([...current.expandedSectionIds, sectionId]))
        : current.expandedSectionIds.filter((id) => id !== sectionId);
      const nextPreferences = {
        expandedSectionIds: nextExpandedSectionIds
      };

      repositoryRef.current?.save(nextPreferences);
      return nextPreferences;
    });
  }, []);

  const isSectionExpanded = useCallback((sectionId: SettingsSectionId) => {
    return preferences.expandedSectionIds.includes(sectionId);
  }, [preferences.expandedSectionIds]);

  return {
    expandedSectionIds: preferences.expandedSectionIds,
    isSectionExpanded,
    setSectionExpanded
  };
}
