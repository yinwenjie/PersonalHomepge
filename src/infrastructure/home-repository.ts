import {
  createDefaultHomeDocument,
  HomeDocumentV2,
  migrateV1ToV2,
  normalizeHomeDocument,
  RESET_BACKUP_STORAGE_KEY,
  V1_STORAGE_KEY,
  V2_STORAGE_KEY
} from "@/domain/home-document";
import {
  createDocumentProtectionState,
  DOCUMENT_PROTECTION_STORAGE_KEY,
  type DocumentProtectionState
} from "@/domain/home-document-protection";

export interface HomeRepository {
  load(): HomeDocumentV2;
  save(documentValue: HomeDocumentV2): void;
  reset(): void;
  hasResetBackup(): boolean;
  loadDocumentProtection(): DocumentProtectionState | null;
  loadResetBackup(): HomeDocumentV2 | null;
  saveResetBackup(documentValue: HomeDocumentV2): void;
  clearResetBackup(): void;
}

export interface CloudHomeRepository {
  pull(): Promise<HomeDocumentV2>;
  push(documentValue: HomeDocumentV2): Promise<void>;
}

export class LocalHomeRepository implements HomeRepository {
  constructor(private readonly storage: Storage) {}

  hasStoredDocument(): boolean {
    return Boolean(this.storage.getItem(V2_STORAGE_KEY) || this.storage.getItem(V1_STORAGE_KEY));
  }

  load(): HomeDocumentV2 {
    const v2Document = this.loadV2();
    if (v2Document) {
      this.trySaveDocumentProtection(v2Document);
      return v2Document;
    }

    const migratedDocument = this.loadMigratedV1();
    if (migratedDocument) {
      this.save(migratedDocument);
      return migratedDocument;
    }

    const defaultDocument = createDefaultHomeDocument();
    this.trySaveDocumentProtection(defaultDocument);
    return defaultDocument;
  }

  save(documentValue: HomeDocumentV2): void {
    const normalized = normalizeHomeDocument(documentValue);
    this.storage.setItem(V2_STORAGE_KEY, JSON.stringify(normalized));
    this.trySaveDocumentProtection(normalized);
  }

  reset(): void {
    this.storage.removeItem(V2_STORAGE_KEY);
    this.storage.removeItem(V1_STORAGE_KEY);
    this.trySaveDocumentProtection(createDefaultHomeDocument());
  }

  hasResetBackup(): boolean {
    return Boolean(this.storage.getItem(RESET_BACKUP_STORAGE_KEY));
  }

  loadDocumentProtection(): DocumentProtectionState | null {
    try {
      const raw = this.storage.getItem(DOCUMENT_PROTECTION_STORAGE_KEY);
      const value = raw ? JSON.parse(raw) as DocumentProtectionState : null;
      if (!value || !isDocumentProtectionState(value)) {
        return null;
      }

      return value;
    } catch {
      return null;
    }
  }

  loadResetBackup(): HomeDocumentV2 | null {
    try {
      const raw = this.storage.getItem(RESET_BACKUP_STORAGE_KEY);
      return raw ? normalizeHomeDocument(JSON.parse(raw)) : null;
    } catch (error) {
      console.warn("Ignoring invalid reset backup:", error);
      return null;
    }
  }

  saveResetBackup(documentValue: HomeDocumentV2): void {
    this.storage.setItem(RESET_BACKUP_STORAGE_KEY, JSON.stringify(normalizeHomeDocument(documentValue)));
  }

  clearResetBackup(): void {
    this.storage.removeItem(RESET_BACKUP_STORAGE_KEY);
  }

  private trySaveDocumentProtection(documentValue: HomeDocumentV2): void {
    try {
      this.storage.setItem(DOCUMENT_PROTECTION_STORAGE_KEY, JSON.stringify(createDocumentProtectionState(documentValue)));
    } catch (error) {
      console.warn("Failed to persist document protection state:", error);
    }
  }

  private loadV2(): HomeDocumentV2 | null {
    try {
      const raw = this.storage.getItem(V2_STORAGE_KEY);
      return raw ? normalizeHomeDocument(JSON.parse(raw)) : null;
    } catch (error) {
      console.warn("Ignoring invalid HomeDocumentV2:", error);
      return null;
    }
  }

  private loadMigratedV1(): HomeDocumentV2 | null {
    try {
      const raw = this.storage.getItem(V1_STORAGE_KEY);
      return raw ? migrateV1ToV2(JSON.parse(raw)) : null;
    } catch (error) {
      console.warn("Ignoring invalid legacy HomeDocument:", error);
      return null;
    }
  }
}

function isDocumentProtectionState(value: unknown): value is DocumentProtectionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const state = value as Record<string, unknown>;
  return typeof state.documentId === "string"
    && typeof state.classifiedAt === "string"
    && typeof state.contentFingerprint === "string"
    && typeof state.documentClass === "string"
    && typeof state.isSystemDocument === "boolean"
    && typeof state.isUserData === "boolean";
}
