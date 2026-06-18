"use client";

import { useEffect } from "react";
import type { HomeTheme } from "@/domain/home-document";
import {
  getHomeThemeCssVariables,
  HOME_THEME_CSS_VARIABLE_NAMES,
  type HomeThemeColorScheme
} from "@/domain/theme-preset";
import type { ThemePreference } from "@/domain/ui-preferences";
import { useUiPreferences } from "@/hooks/use-ui-preferences";

interface HomeThemeStyleBridgeProps {
  theme: HomeTheme;
}

export function HomeThemeStyleBridge({ theme }: HomeThemeStyleBridgeProps) {
  const { preferences } = useUiPreferences();

  useEffect(() => {
    const root = document.documentElement;
    const darkSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");

    function applyThemeVariables() {
      const scheme = resolveColorScheme(preferences.themePreference, darkSchemeMedia);
      const variables = getHomeThemeCssVariables(theme, scheme);

      for (const [name, value] of Object.entries(variables)) {
        root.style.setProperty(name, value);
      }
    }

    applyThemeVariables();

    if (preferences.themePreference === "system") {
      darkSchemeMedia.addEventListener("change", applyThemeVariables);
    }

    return () => {
      darkSchemeMedia.removeEventListener("change", applyThemeVariables);
      for (const name of HOME_THEME_CSS_VARIABLE_NAMES) {
        root.style.removeProperty(name);
      }
    };
  }, [preferences.themePreference, theme]);

  return null;
}

function resolveColorScheme(themePreference: ThemePreference, darkSchemeMedia: MediaQueryList): HomeThemeColorScheme {
  if (themePreference === "dark") {
    return "dark";
  }

  if (themePreference === "light") {
    return "light";
  }

  return darkSchemeMedia.matches ? "dark" : "light";
}
