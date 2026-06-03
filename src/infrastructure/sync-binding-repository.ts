import {
  normalizeStoredSyncBinding,
  StoredSyncBinding,
  SYNC_BINDING_STORAGE_KEY
} from "@/domain/sync-code";

export class LocalSyncBindingRepository {
  constructor(private readonly storage: Storage) {}

  load(): StoredSyncBinding | null {
    try {
      const raw = this.storage.getItem(SYNC_BINDING_STORAGE_KEY);
      return raw ? normalizeStoredSyncBinding(JSON.parse(raw)) : null;
    } catch (error) {
      console.warn("Ignoring invalid sync binding:", error);
      return null;
    }
  }

  save(binding: StoredSyncBinding): void {
    this.storage.setItem(SYNC_BINDING_STORAGE_KEY, JSON.stringify(binding));
  }

  clear(): void {
    this.storage.removeItem(SYNC_BINDING_STORAGE_KEY);
  }
}
