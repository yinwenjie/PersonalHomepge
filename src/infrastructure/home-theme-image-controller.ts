import type { HomeTheme, HomeThemeAssetSlot } from "@/domain/home-document";
import { getHomeAssetCacheIdentity, homeAssetCache } from "@/infrastructure/home-asset-cache-repository";
import { clearHomeAssetSignedUrls } from "@/infrastructure/home-asset-storage-repository";
import { getSupabaseAssetProjectScope } from "@/infrastructure/supabase-client";
import {
  homeThemeImageLoader,
  type HomeThemeImageLoader,
  type ResolvedHomeThemeImage
} from "@/infrastructure/home-theme-image-loader";

interface DisplayedImage {
  key: string;
  image: ResolvedHomeThemeImage;
}

/** Holds at most two object URLs, including while navigating between home/settings. */
export class HomeThemeImageController {
  private scope: string | null = null;
  private userId: string | null = null;
  private pending: AbortController | null = null;
  private images: Partial<Record<HomeThemeAssetSlot, DisplayedImage>> = {};

  constructor(
    private loader: Pick<HomeThemeImageLoader, "load"> = homeThemeImageLoader,
    private root: () => Pick<HTMLElement, "style"> = () => document.documentElement
  ) {}

  apply(theme: Pick<HomeTheme, "bannerAsset" | "backgroundAsset">, documentId: string, userId: string | null): () => void {
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    const scope = JSON.stringify([documentId, userId]);
    if (this.scope !== scope) this.clearImages();
    this.scope = scope;
    this.userId = userId;

    for (const slot of ["banner", "background"] as const) {
      const asset = slot === "banner" ? theme.bannerAsset : theme.backgroundAsset;
      const identity = asset ? getHomeAssetCacheIdentity(getSupabaseAssetProjectScope(), userId, asset) : null;
      if (!asset || !identity) {
        this.clearSlot(slot);
        continue;
      }
      const existing = this.images[slot];
      if (existing?.key === identity.key) {
        this.setImage(slot, existing.image.url);
        continue;
      }

      void this.loader.load(asset, userId, controller.signal).then((image) => {
        if (!image) return;
        if (controller.signal.aborted) {
          image.release();
          return;
        }
        const previous = this.images[slot];
        this.images[slot] = { key: identity.key, image };
        this.setImage(slot, image.url);
        previous?.image.release();
      }).catch(() => {
        // Keep the existing image only within the same account/document scope.
        // Do not log signed URLs or external user-supplied image addresses.
      });
    }

    return () => controller.abort();
  }

  clearAccount(userId: string): void {
    if (this.userId === userId) {
      this.pending?.abort();
      this.clearImages();
      this.scope = null;
      this.userId = null;
    }
  }

  private clearImages(): void {
    this.clearSlot("banner");
    this.clearSlot("background");
  }

  private clearSlot(slot: HomeThemeAssetSlot): void {
    this.setImage(slot, null);
    this.images[slot]?.image.release();
    delete this.images[slot];
  }

  private setImage(slot: HomeThemeAssetSlot, url: string | null): void {
    this.root().style.setProperty(`--home-${slot}-image`, url ? `url(${JSON.stringify(url)})` : "none");
    if (slot === "background") {
      this.root().style.setProperty("--home-background-image-scrim", url
        ? "var(--home-background-scrim)" : "linear-gradient(transparent, transparent)");
    }
  }
}

export const homeThemeImageController = new HomeThemeImageController();

export function clearHomeThemeImagesForAccount(userId: string): void {
  homeThemeImageController.clearAccount(userId);
  clearHomeAssetSignedUrls(userId);
  void homeAssetCache.clearAccount(getSupabaseAssetProjectScope(), userId);
}
