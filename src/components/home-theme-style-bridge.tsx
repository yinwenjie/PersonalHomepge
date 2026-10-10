"use client";

import { useEffect } from "react";
import { homeThemeImageController } from "@/infrastructure/home-theme-image-controller";
import type { HomeTheme } from "@/domain/home-document";
import {
  getHomeThemeAppearanceAttribute,
  getHomeThemeCssVariables,
  type HomeThemeColorScheme
} from "@/domain/theme-preset";
import type { ThemePreference } from "@/domain/ui-preferences";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { useUiPreferences } from "@/hooks/use-ui-preferences";

interface HomeThemeStyleBridgeProps {
  theme: HomeTheme;
  documentId: string;
  spaceId: string | null;
  storageReady: boolean;
}

export function HomeThemeStyleBridge({ theme, documentId, spaceId, storageReady }: HomeThemeStyleBridgeProps) {
  const { preferences } = useUiPreferences();
  const { user, loading } = useSupabaseAuth();
  const userId = user?.id ?? null;
  // Document normalization recreates asset objects even when only colors/masks changed.
  const imageAssetsJson = JSON.stringify({ bannerAsset: theme.bannerAsset, backgroundAsset: theme.backgroundAsset });

  useEffect(() => {
    const root = document.documentElement;
    const darkSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");

    function applyThemeVariables() {
      const scheme = resolveColorScheme(preferences.themePreference, darkSchemeMedia);
      const variables = getHomeThemeCssVariables(theme, scheme);

      root.dataset.appearancePreset = getHomeThemeAppearanceAttribute(theme);
      for (const [name, value] of Object.entries(variables)) {
        root.style.setProperty(name, value);
      }

      root.style.setProperty("--home-banner-mask-opacity", toMaskOpacityCssValue(theme.bannerMaskOpacity));
      root.style.setProperty("--home-background-mask-opacity", toMaskOpacityCssValue(theme.backgroundMaskOpacity));
    }

    applyThemeVariables();

    if (preferences.themePreference === "system") {
      darkSchemeMedia.addEventListener("change", applyThemeVariables);
    }

    return () => {
      darkSchemeMedia.removeEventListener("change", applyThemeVariables);
    };
  }, [preferences.themePreference, theme]);

  useEffect(() => {
    // Preserve images while a new route restores the saved document.
    if (!storageReady || loading) return;
    const assets = JSON.parse(imageAssetsJson) as Pick<HomeTheme, "bannerAsset" | "backgroundAsset">;
    return homeThemeImageController.apply(assets, JSON.stringify([documentId, spaceId]), userId);
  }, [imageAssetsJson, documentId, spaceId, storageReady, loading, userId]);

  return null;
}

function toMaskOpacityCssValue(value: number): string {
  return String(Math.min(100, Math.max(0, value)) / 100);
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
