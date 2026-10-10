import type { HomeThemeAsset } from "@/domain/home-document";
import {
  getHomeAssetCacheIdentity,
  HOME_ASSET_CACHE_MAX_FILE_BYTES,
  homeAssetCache,
  isCacheableHomeAssetBlob,
  isCacheableHomeAssetContentType,
  type HomeAssetCacheRepository
} from "@/infrastructure/home-asset-cache-repository";
import { HomeAssetStorageRepository } from "@/infrastructure/home-asset-storage-repository";
import { getSupabaseAssetProjectScope } from "@/infrastructure/supabase-client";

const IMAGE_TIMEOUT_MS = 15000;
const DIRECT_IMAGE_FALLBACK_STORAGE_KEY = "homepage:theme-image-direct:v1";
const DIRECT_IMAGE_FALLBACK_MAX_AGE_MS = 10 * 60 * 1000;
const DIRECT_IMAGE_FALLBACK_MAX_ENTRIES = 20;
const directImageFallbacks = new Map<string, number>();
let restoredDirectImageFallbacks = false;

export interface ResolvedHomeThemeImage {
  url: string;
  release: () => void;
}

interface DownloadedImage {
  url: string;
  blob: Blob | null;
  rememberDirect?: boolean;
}

export class HomeThemeImageLoader {
  private downloads = new Map<string, Promise<DownloadedImage>>();

  constructor(
    private cache: HomeAssetCacheRepository = homeAssetCache,
    private storage: HomeAssetStorageRepository = new HomeAssetStorageRepository()
  ) {}

  async load(asset: HomeThemeAsset, userId: string | null, signal: AbortSignal): Promise<ResolvedHomeThemeImage | null> {
    const project = getSupabaseAssetProjectScope();
    const identity = getHomeAssetCacheIdentity(project, userId, asset);
    if (!identity || signal.aborted) return null;
    const accountVersion = this.cache.accountVersion(project, userId);
    let resourceVersion = this.cache.resourceVersion(identity);
    const isCurrent = () => !signal.aborted && this.cache.accountVersion(project, userId) === accountVersion
      && this.cache.resourceVersion(identity) === resourceVersion;

    const cached = await this.cache.get(identity);
    if (!isCurrent()) return null;
    if (cached) {
      try {
        const image = await imageFromBlob(cached, signal);
        if (!isCurrent()) {
          image.release();
          return null;
        }
        return image;
      } catch {
        if (!isCurrent()) return null;
        await this.cache.remove(identity);
        resourceVersion = this.cache.resourceVersion(identity);
      }
    }

    const downloadKey = JSON.stringify([identity.key, accountVersion, resourceVersion]);
    let pending = this.downloads.get(downloadKey);
    if (!pending) {
      pending = this.download(asset, userId, identity.key);
      this.downloads.set(downloadKey, pending);
    }
    let downloaded: DownloadedImage;
    try {
      downloaded = await pending;
    } finally {
      if (this.downloads.get(downloadKey) === pending) this.downloads.delete(downloadKey);
    }
    if (!isCurrent()) return null;

    if (downloaded.blob) {
      const image = await imageFromBlob(downloaded.blob, signal);
      if (!isCurrent()) {
        image.release();
        return null;
      }
      // Display is never delayed by a best-effort disk write.
      void this.cache.put(identity, downloaded.blob, accountVersion, resourceVersion);
      return image;
    }

    // A network image may legitimately take longer than the optional Blob download budget.
    await preloadHomeThemeImage(downloaded.url, signal, null);
    if (!isCurrent()) return null;
    if (downloaded.rememberDirect) rememberDirectImageFallback(identity.key);
    return { url: downloaded.url, release: () => {} };
  }

  private async download(asset: HomeThemeAsset, userId: string | null, key: string): Promise<DownloadedImage> {
    const url = asset.source === "external"
      ? asset.url
      : await this.storage.createSignedUrl(asset, userId);
    if (!url) throw new Error("Theme image is unavailable.");
    if (asset.source === "external" && shouldUseDirectImageFallback(key)) return { url, blob: null };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    let rememberDirect = false;
    try {
      const response = await fetch(url, { mode: "cors", credentials: "omit", signal: controller.signal });
      if (!response.ok) throw new Error("Theme image download failed.");
      const blob = await readCacheableImageBlob(response);
      if (blob) return { url, blob };
    } catch (error) {
      // Cache failures must not prevent either Storage or external URLs from displaying.
      // Only remember likely CORS failures after direct image display actually succeeds.
      rememberDirect = asset.source === "external" && error instanceof TypeError && !controller.signal.aborted;
    } finally {
      clearTimeout(timer);
    }
    return { url, blob: null, rememberDirect };
  }
}

async function imageFromBlob(blob: Blob, signal: AbortSignal): Promise<ResolvedHomeThemeImage> {
  const url = URL.createObjectURL(blob);
  const release = () => URL.revokeObjectURL(url);
  try {
    await preloadHomeThemeImage(url, signal);
    return { url, release };
  } catch (error) {
    release();
    throw error;
  }
}

function preloadHomeThemeImage(url: string, signal: AbortSignal, timeoutMs: number | null = IMAGE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      if (timer !== null) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = "";
        reject(error);
      } else {
        resolve();
      }
    };
    const abort = () => finish(new Error("Theme image loading cancelled."));
    const timer = timeoutMs === null ? null
      : setTimeout(() => finish(new Error("Theme image loading timed out.")), timeoutMs);
    image.onload = () => finish();
    image.onerror = () => finish(new Error("Theme image could not be decoded."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else image.src = url;
  });
}

export const homeThemeImageLoader = new HomeThemeImageLoader();

function shouldUseDirectImageFallback(key: string): boolean {
  if (!restoredDirectImageFallbacks) {
    restoredDirectImageFallbacks = true;
    try {
      const entries: unknown = JSON.parse(sessionStorage.getItem(DIRECT_IMAGE_FALLBACK_STORAGE_KEY) ?? "[]");
      if (Array.isArray(entries)) {
        for (const entry of entries.slice(-DIRECT_IMAGE_FALLBACK_MAX_ENTRIES)) {
          if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number"
            && entry[1] > Date.now()) directImageFallbacks.set(entry[0], entry[1]);
        }
      }
    } catch { /* Storage may be disabled; the in-memory fallback still works. */ }
  }
  if ((directImageFallbacks.get(key) ?? 0) > Date.now()) return true;
  directImageFallbacks.delete(key);
  return false;
}

function rememberDirectImageFallback(key: string): void {
  directImageFallbacks.delete(key);
  directImageFallbacks.set(key, Date.now() + DIRECT_IMAGE_FALLBACK_MAX_AGE_MS);
  while (directImageFallbacks.size > DIRECT_IMAGE_FALLBACK_MAX_ENTRIES) {
    directImageFallbacks.delete(directImageFallbacks.keys().next().value!);
  }
  try {
    sessionStorage.setItem(DIRECT_IMAGE_FALLBACK_STORAGE_KEY, JSON.stringify([...directImageFallbacks]));
  } catch { /* Remember for this page only when sessionStorage is unavailable. */ }
}

async function readCacheableImageBlob(response: Response): Promise<Blob | null> {
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!isCacheableHomeAssetContentType(type)
    || Number(response.headers.get("content-length")) > HOME_ASSET_CACHE_MAX_FILE_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > HOME_ASSET_CACHE_MAX_FILE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value.slice().buffer);
    }
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks, { type });
  return isCacheableHomeAssetBlob(blob) ? blob : null;
}
