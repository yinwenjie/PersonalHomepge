import type { HomeThemeAsset } from "@/domain/home-document";

export const HOME_ASSET_CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const HOME_ASSET_CACHE_MAX_ENTRIES = 20;
export const HOME_ASSET_CACHE_MAX_FILE_BYTES = 5 * 1024 * 1024;
const CACHE_DATABASE = "homepage:theme-images:v1";
const CACHE_STORE = "images";
const CACHE_TIMEOUT_MS = 1500;
const EXTERNAL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface HomeAssetCacheIdentity {
  key: string;
  resourceKey: string;
  project: string;
  userId: string | null;
  external: boolean;
}

interface CachedHomeAsset extends HomeAssetCacheIdentity {
  blob: Blob;
  lastUsedAt: number;
  savedAt: number;
}

export function getHomeAssetCacheIdentity(
  project: string,
  userId: string | null,
  asset: HomeThemeAsset
): HomeAssetCacheIdentity | null {
  if (asset.source === "storage" && (
    !userId || asset.bucket !== "home-assets" || !asset.path || asset.path.split("/")[0] !== userId
  )) {
    return null;
  }
  if (asset.source === "external" && !asset.url) {
    return null;
  }

  const resourceKey = JSON.stringify([
    project, userId, asset.source, asset.bucket, asset.source === "storage" ? asset.path : asset.url
  ]);
  return { key: JSON.stringify([resourceKey, asset.updatedAt]), resourceKey, project, userId, external: asset.source === "external" };
}

export function isCacheableHomeAssetBlob(blob: Blob): boolean {
  return blob.size > 0 && blob.size <= HOME_ASSET_CACHE_MAX_FILE_BYTES
    && isCacheableHomeAssetContentType(blob.type);
}

export function isCacheableHomeAssetContentType(type: string): boolean {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type.toLowerCase());
}

/** A disposable cache: failures must never prevent the original image from loading. */
export class HomeAssetCacheRepository {
  private accountVersions = new Map<string, number>();
  private resourceVersions = new Map<string, number>();

  resourceVersion(identity: HomeAssetCacheIdentity): number {
    return this.resourceVersions.get(identity.resourceKey) ?? 0;
  }

  accountVersion(project: string, userId: string | null): number {
    return this.accountVersions.get(JSON.stringify([project, userId])) ?? 0;
  }

  async get(identity: HomeAssetCacheIdentity): Promise<Blob | null> {
    return this.withStore<Blob | null>(null, (store, complete) => {
      const request = store.get(identity.key);
      onCacheRequestSuccess(request, () => {
        const entry = request.result as CachedHomeAsset | undefined;
        if (!entry || !(entry.blob instanceof Blob) || !isCacheableHomeAssetBlob(entry.blob)
          || (identity.external && Date.now() - entry.savedAt >= EXTERNAL_CACHE_MAX_AGE_MS)) {
          if (entry) store.delete(identity.key);
          complete(null);
          return;
        }
        store.put({ ...entry, lastUsedAt: Date.now() });
        complete(entry.blob);
      });
    });
  }

  async put(identity: HomeAssetCacheIdentity, blob: Blob, accountVersion: number, resourceVersion = this.resourceVersion(identity)): Promise<boolean> {
    if (!isCacheableHomeAssetBlob(blob)) return false;

    return this.withStore(false, (store, complete) => {
      const request = store.getAll();
      onCacheRequestSuccess(request, () => {
        if (this.accountVersion(identity.project, identity.userId) !== accountVersion
          || this.resourceVersion(identity) !== resourceVersion) {
          complete(false);
          return;
        }
        const entries = request.result as CachedHomeAsset[];
        const retained: CachedHomeAsset[] = [];
        for (const entry of entries) {
          if (entry.resourceKey === identity.resourceKey || !(entry.blob instanceof Blob)) {
            store.delete(entry.key);
          } else {
            retained.push(entry);
          }
        }
        retained.sort((left, right) => left.lastUsedAt - right.lastUsedAt);
        let bytes = retained.reduce((total, entry) => total + entry.blob.size, 0) + blob.size;
        while (retained.length >= HOME_ASSET_CACHE_MAX_ENTRIES || bytes > HOME_ASSET_CACHE_MAX_BYTES) {
          const oldest = retained.shift();
          if (!oldest) break;
          bytes -= oldest.blob.size;
          store.delete(oldest.key);
        }
        store.put({ ...identity, blob, lastUsedAt: Date.now(), savedAt: Date.now() } satisfies CachedHomeAsset);
        complete(true);
      });
    });
  }

  async remove(identity: HomeAssetCacheIdentity): Promise<void> {
    this.resourceVersions.set(identity.resourceKey, this.resourceVersion(identity) + 1);
    await this.withStore(false, (store, complete) => {
      store.delete(identity.key);
      complete(true);
    });
  }

  async clearAccount(project: string, userId: string): Promise<void> {
    const accountKey = JSON.stringify([project, userId]);
    this.accountVersions.set(accountKey, this.accountVersion(project, userId) + 1);
    await this.withStore(false, (store, complete) => {
      const request = store.openCursor();
      onCacheRequestSuccess(request, () => {
        const cursor = request.result;
        if (!cursor) {
          complete(true);
          return;
        }
        const entry = cursor.value as CachedHomeAsset;
        if (entry.project === project && entry.userId === userId) cursor.delete();
        cursor.continue();
      });
    });
  }

  private withStore<T>(fallback: T, run: (store: IDBObjectStore, complete: (value: T) => void) => void): Promise<T> {
    return new Promise((resolve) => {
      let database: IDBDatabase | undefined;
      let transaction: IDBTransaction | undefined;
      let settled = false;
      let value = fallback;
      const finish = (result: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        database?.close();
        resolve(result);
      };
      const timer = setTimeout(() => {
        try { transaction?.abort(); } catch { /* Already completed. */ }
        finish(fallback);
      }, CACHE_TIMEOUT_MS);

      try {
        if (!globalThis.indexedDB) {
          finish(fallback);
          return;
        }
        const request = globalThis.indexedDB.open(CACHE_DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE, { keyPath: "key" });
        request.onerror = () => finish(fallback);
        request.onblocked = () => finish(fallback);
        request.onsuccess = () => {
          database = request.result;
          if (settled) {
            database.close();
            return;
          }
          try {
            transaction = database.transaction(CACHE_STORE, "readwrite");
            transaction.oncomplete = () => finish(value);
            transaction.onabort = () => finish(fallback);
            transaction.onerror = () => finish(fallback);
            run(transaction.objectStore(CACHE_STORE), (result) => { value = result; });
          } catch {
            finish(fallback);
          }
        };
      } catch {
        finish(fallback);
      }
    });
  }
}

export const homeAssetCache = new HomeAssetCacheRepository();

function onCacheRequestSuccess<T>(request: IDBRequest<T>, callback: () => void): void {
  request.onsuccess = () => {
    try {
      callback();
    } catch {
      request.transaction?.abort();
    }
  };
}
