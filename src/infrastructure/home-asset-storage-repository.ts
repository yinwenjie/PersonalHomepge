import {
  createHomeThemeAssetStoragePath,
  createStorageHomeThemeAsset,
  HOME_THEME_ASSET_SIGNED_URL_TTL_SECONDS,
  type PreparedHomeThemeAssetFile
} from "@/domain/home-theme-asset";
import {
  HOME_THEME_ASSET_BUCKET,
  type HomeThemeAsset,
  type HomeThemeAssetSlot
} from "@/domain/home-document";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  SUPABASE_CONFIGURATION_MESSAGE
} from "@/infrastructure/supabase-client";

const SIGNED_URL_REFRESH_SKEW_MS = 60 * 1000;
const signedUrlCache = new Map<string, { expiresAt: number; signedUrl: string }>();

export class HomeAssetStorageRepository {
  async upload(userId: string, slot: HomeThemeAssetSlot, prepared: PreparedHomeThemeAssetFile): Promise<HomeThemeAsset> {
    assertStorageConfigured();

    const path = createHomeThemeAssetStoragePath(userId, slot, prepared.extension);
    const { error } = await getSupabaseBrowserClient()
      .storage
      .from(HOME_THEME_ASSET_BUCKET)
      .upload(path, prepared.file, {
        cacheControl: "3600",
        contentType: prepared.contentType,
        upsert: true
      });

    if (error) {
      throw new Error(toHomeAssetStorageErrorMessage(error.message));
    }

    return createStorageHomeThemeAsset({
      path,
      contentType: prepared.contentType,
      width: prepared.width,
      height: prepared.height
    });
  }

  async createSignedUrl(asset: HomeThemeAsset): Promise<string | null> {
    if (asset.source === "external") {
      return asset.url;
    }

    if (!isReadableStorageAsset(asset)) {
      return null;
    }

    assertStorageConfigured();

    const cacheKey = getSignedUrlCacheKey(asset);
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt - SIGNED_URL_REFRESH_SKEW_MS > Date.now()) {
      return cached.signedUrl;
    }

    const { data, error } = await getSupabaseBrowserClient()
      .storage
      .from(HOME_THEME_ASSET_BUCKET)
      .createSignedUrl(asset.path, HOME_THEME_ASSET_SIGNED_URL_TTL_SECONDS);

    if (error) {
      throw new Error(toHomeAssetStorageErrorMessage(error.message));
    }

    signedUrlCache.set(cacheKey, {
      signedUrl: data.signedUrl,
      expiresAt: Date.now() + HOME_THEME_ASSET_SIGNED_URL_TTL_SECONDS * 1000
    });

    return data.signedUrl;
  }

  async remove(asset: HomeThemeAsset | null): Promise<void> {
    if (!asset || !isReadableStorageAsset(asset)) {
      return;
    }

    assertStorageConfigured();

    const { error } = await getSupabaseBrowserClient()
      .storage
      .from(HOME_THEME_ASSET_BUCKET)
      .remove([asset.path]);

    if (error) {
      throw new Error(toHomeAssetStorageErrorMessage(error.message));
    }

    signedUrlCache.delete(getSignedUrlCacheKey(asset));
  }
}

function assertStorageConfigured(): void {
  if (!isSupabaseConfigured()) {
    throw new Error(SUPABASE_CONFIGURATION_MESSAGE);
  }
}

function isReadableStorageAsset(asset: HomeThemeAsset): asset is HomeThemeAsset & { path: string } {
  return asset.source === "storage"
    && asset.bucket === HOME_THEME_ASSET_BUCKET
    && Boolean(asset.path);
}

function getSignedUrlCacheKey(asset: HomeThemeAsset & { path: string }): string {
  return `${asset.bucket}:${asset.path}`;
}

function toHomeAssetStorageErrorMessage(message: string): string {
  if (/row-level security|policy|not authorized|permission/i.test(message)) {
    return "图片上传权限未开通或 Storage RLS policy 尚未执行，请先执行 012_home_assets_storage.sql。";
  }

  if (/bucket/i.test(message)) {
    return "找不到 home-assets 文件桶，请确认 Supabase Storage bucket 已创建。";
  }

  if (/size|payload/i.test(message)) {
    return "图片超过允许大小，请换一张更小的图片。";
  }

  return message || "图片资源操作失败。";
}
