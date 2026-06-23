import type { BookmarkImportDraft, BookmarkImportUndoRecord } from "@/domain/bookmark-import";
import { normalizeHomeDocument } from "@/domain/home-document";

const DRAFT_STORAGE_KEY = "homepage:bookmark-import-draft:v1";
const UNDO_STORAGE_KEY = "homepage:bookmark-import-undo:v1";
const DRAFT_SCHEMA = "homepage-bookmark-import-draft-v1";
const UNDO_SCHEMA = "homepage-bookmark-import-undo-v1";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface DraftStorageValue {
  draft: BookmarkImportDraft;
  expiresAt: string;
  homeDocumentId: string;
  homeRevision: number;
  savedAt: string;
  schema: typeof DRAFT_SCHEMA;
}

interface UndoStorageValue extends BookmarkImportUndoRecord {
  schema: typeof UNDO_SCHEMA;
}

export class BookmarkImportStorageRepository {
  constructor(private readonly storage: Storage) {}

  loadDraft(homeDocumentId?: string): BookmarkImportDraft | null {
    const value = this.readJson<DraftStorageValue>(DRAFT_STORAGE_KEY);
    if (!value || value.schema !== DRAFT_SCHEMA || isExpired(value.expiresAt)) {
      this.clearDraft();
      return null;
    }

    if (homeDocumentId && value.homeDocumentId !== homeDocumentId) {
      return null;
    }

    return value.draft;
  }

  hasDraft(homeDocumentId?: string): boolean {
    return Boolean(this.loadDraft(homeDocumentId));
  }

  saveDraft(draft: BookmarkImportDraft, homeDocumentId: string, homeRevision: number): void {
    const savedAt = new Date();
    const value: DraftStorageValue = {
      schema: DRAFT_SCHEMA,
      draft,
      homeDocumentId,
      homeRevision,
      savedAt: savedAt.toISOString(),
      expiresAt: new Date(savedAt.getTime() + DEFAULT_TTL_MS).toISOString()
    };

    this.storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(value));
  }

  clearDraft(): void {
    this.storage.removeItem(DRAFT_STORAGE_KEY);
  }

  loadUndo(homeDocumentId?: string): BookmarkImportUndoRecord | null {
    const value = this.readJson<UndoStorageValue>(UNDO_STORAGE_KEY);
    if (!value || value.schema !== UNDO_SCHEMA || isExpired(value.expiresAt)) {
      this.clearUndo();
      return null;
    }

    if (homeDocumentId && value.homeDocumentId !== homeDocumentId) {
      return null;
    }

    try {
      return {
        importBatchId: value.importBatchId,
        homeDocumentId: value.homeDocumentId,
        beforeDocument: normalizeHomeDocument(value.beforeDocument),
        addedGroupIds: Array.isArray(value.addedGroupIds) ? value.addedGroupIds.map(String) : [],
        addedSiteIdsByGroupId: normalizeAddedSiteIds(value.addedSiteIdsByGroupId),
        createdAt: String(value.createdAt),
        expiresAt: String(value.expiresAt)
      };
    } catch {
      this.clearUndo();
      return null;
    }
  }

  hasUndo(homeDocumentId?: string): boolean {
    return Boolean(this.loadUndo(homeDocumentId));
  }

  saveUndo(input: Omit<BookmarkImportUndoRecord, "createdAt" | "expiresAt">): void {
    const createdAt = new Date();
    const value: UndoStorageValue = {
      schema: UNDO_SCHEMA,
      ...input,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + DEFAULT_TTL_MS).toISOString()
    };

    this.storage.setItem(UNDO_STORAGE_KEY, JSON.stringify(value));
  }

  clearUndo(): void {
    this.storage.removeItem(UNDO_STORAGE_KEY);
  }

  private readJson<T>(key: string): T | null {
    try {
      const raw = this.storage.getItem(key);
      return raw ? JSON.parse(raw) as T : null;
    } catch {
      return null;
    }
  }
}

function isExpired(expiresAt: string): boolean {
  const time = new Date(expiresAt).getTime();

  return !Number.isFinite(time) || time <= Date.now();
}

function normalizeAddedSiteIds(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([groupId, siteIds]) => [
    groupId,
    Array.isArray(siteIds) ? siteIds.map(String) : []
  ]));
}
