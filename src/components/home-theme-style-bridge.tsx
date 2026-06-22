"use client";

import { useEffect } from "react";
import { HomeAssetStorageRepository } from "@/infrastructure/home-asset-storage-repository";
import type { HomeTheme } from "@/domain/home-document";
import {
  getHomeThemeCssVariables,
  type HomeThemeColorScheme
} from "@/domain/theme-preset";
import type { ThemePreference } from "@/domain/ui-preferences";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { useUiPreferences } from "@/hooks/use-ui-preferences";

interface HomeThemeStyleBridgeProps {
  theme: HomeTheme;
}

export function HomeThemeStyleBridge({ theme }: HomeThemeStyleBridgeProps) {
  const { preferences } = useUiPreferences();
  const { user } = useSupabaseAuth();
  const signedIn = Boolean(user);

  useEffect(() => {
    const root = document.documentElement;
    const darkSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");

    function applyThemeVariables() {
      const scheme = resolveColorScheme(preferences.themePreference, darkSchemeMedia);
      const variables = getHomeThemeCssVariables(theme, scheme);

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
    let cancelled = false;
    const root = document.documentElement;
    const repository = new HomeAssetStorageRepository();

    async function applyImageVariables() {
      try {
        const [bannerUrl, backgroundUrl] = await Promise.all([
          resolveThemeAssetUrl(theme.bannerAsset, signedIn, repository),
          resolveThemeAssetUrl(theme.backgroundAsset, signedIn, repository)
        ]);
        await preloadThemeImages([bannerUrl, backgroundUrl]);

        if (cancelled) {
          return;
        }

        root.style.setProperty("--home-banner-image", toCssImageValue(bannerUrl));
        root.style.setProperty("--home-background-image", toCssImageValue(backgroundUrl));
        root.style.setProperty("--home-background-image-scrim", backgroundUrl ? "var(--home-background-scrim)" : "linear-gradient(transparent, transparent)");
      } catch (error) {
        console.warn(error);
        if (!cancelled) {
          if (!theme.bannerAsset) {
            root.style.setProperty("--home-banner-image", "none");
          }

          if (!theme.backgroundAsset) {
            root.style.setProperty("--home-background-image", "none");
            root.style.setProperty("--home-background-image-scrim", "linear-gradient(transparent, transparent)");
          }
        }
      }
    }

    applyImageVariables();

    return () => {
      cancelled = true;
    };
  }, [theme.bannerAsset, theme.backgroundAsset, signedIn]);

  return null;
}

async function resolveThemeAssetUrl(
  asset: HomeTheme["bannerAsset"],
  signedIn: boolean,
  repository: HomeAssetStorageRepository
): Promise<string | null> {
  if (!asset) {
    return null;
  }

  if (asset.source === "external") {
    return asset.url;
  }

  if (!signedIn) {
    return null;
  }

  return repository.createSignedUrl(asset);
}

function toCssImageValue(url: string | null): string {
  return url ? `url(${JSON.stringify(url)})` : "none";
}

function toMaskOpacityCssValue(value: number): string {
  return String(Math.min(100, Math.max(0, value)) / 100);
}

async function preloadThemeImages(urls: Array<string | null>): Promise<void> {
  await Promise.all(urls.filter((url): url is string => Boolean(url)).map(preloadImage));
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });
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
