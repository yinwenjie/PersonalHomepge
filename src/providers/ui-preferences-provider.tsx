"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountPreferences } from "@/domain/account";
import { getActionErrorMessage } from "@/domain/errors";
import {
  DEFAULT_UI_PREFERENCES,
  normalizeUiPreferences,
  type UiPreferences
} from "@/domain/ui-preferences";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { AccountRepository } from "@/infrastructure/account-repository";
import { LocalUiPreferencesRepository } from "@/infrastructure/ui-preferences-repository";
import { UiPreferencesContext, type UiPreferencesState } from "@/contexts/ui-preferences-context";

interface UiPreferencesProviderProps {
  children: ReactNode;
}

export function UiPreferencesProvider({ children }: UiPreferencesProviderProps) {
  const auth = useSupabaseAuth();
  const repository = useMemo(() => new AccountRepository(), []);
  const localRepositoryRef = useRef<LocalUiPreferencesRepository | null>(null);
  const requestIdRef = useRef(0);
  const [preferences, setPreferences] = useState<UiPreferences>(DEFAULT_UI_PREFERENCES);
  const [source, setSource] = useState<UiPreferencesState["source"]>("default");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const persistLocal = useCallback((nextPreferences: UiPreferences) => {
    localRepositoryRef.current?.save(nextPreferences);
  }, []);

  const applyPreferences = useCallback((
    nextPreferences: UiPreferences,
    nextSource: UiPreferencesState["source"],
    options: { persist?: boolean } = {}
  ) => {
    const normalized = normalizeUiPreferences(nextPreferences);
    setPreferences(normalized);
    setSource(nextSource);
    if (options.persist) {
      persistLocal(normalized);
    }
  }, [persistLocal]);

  const updateLocalPreferences = useCallback((nextPreferences: UiPreferences) => {
    applyPreferences(nextPreferences, "local", { persist: true });
    setError("");
  }, [applyPreferences]);

  const applyAccountPreferences = useCallback((accountPreferences: AccountPreferences) => {
    applyPreferences(toUiPreferences(accountPreferences), "account", { persist: true });
    setError("");
  }, [applyPreferences]);

  useEffect(() => {
    localRepositoryRef.current = new LocalUiPreferencesRepository(window.localStorage);
    const localPreferences = localRepositoryRef.current.load();
    applyPreferences(localPreferences, isDefaultPreferences(localPreferences) ? "default" : "local");
  }, [applyPreferences]);

  useEffect(() => {
    applyUiPreferenceAttributes(preferences);
  }, [preferences]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (auth.loading) {
      return;
    }

    if (!auth.user) {
      const localPreferences = localRepositoryRef.current?.load() ?? DEFAULT_UI_PREFERENCES;
      applyPreferences(localPreferences, isDefaultPreferences(localPreferences) ? "default" : "local");
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    repository.ensureUserPreferences(auth.user.id)
      .then((accountPreferences) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        applyAccountPreferences(accountPreferences);
      })
      .catch((preferencesError: unknown) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setError(getActionErrorMessage("账号偏好加载失败", preferencesError));
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      });
  }, [applyAccountPreferences, applyPreferences, auth.loading, auth.user, repository]);

  const value = useMemo<UiPreferencesState>(() => ({
    preferences,
    source,
    loading,
    error,
    updateLocalPreferences,
    applyAccountPreferences
  }), [applyAccountPreferences, error, loading, preferences, source, updateLocalPreferences]);

  return (
    <UiPreferencesContext.Provider value={value}>
      {children}
    </UiPreferencesContext.Provider>
  );
}

function toUiPreferences(preferences: AccountPreferences): UiPreferences {
  return normalizeUiPreferences({
    locale: preferences.locale,
    themePreference: preferences.themePreference,
    fontFamily: preferences.fontFamily,
    density: preferences.density,
    defaultSearchEngine: preferences.defaultSearchEngine
  });
}

function isDefaultPreferences(preferences: UiPreferences): boolean {
  return JSON.stringify(preferences) === JSON.stringify(DEFAULT_UI_PREFERENCES);
}

function applyUiPreferenceAttributes(preferences: UiPreferences): void {
  const root = document.documentElement;

  if (preferences.themePreference === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = preferences.themePreference;
  }

  root.dataset.fontFamily = preferences.fontFamily;
  root.dataset.density = preferences.density;
  root.lang = preferences.locale;
}
