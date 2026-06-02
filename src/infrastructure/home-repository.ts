import {
  createDefaultHomeDocument,
  HomeDocumentV2,
  migrateV1ToV2,
  normalizeHomeDocument,
  V1_STORAGE_KEY,
  V2_STORAGE_KEY
} from "@/domain/home-document";

export interface HomeRepository {
  load(): HomeDocumentV2;
  save(documentValue: HomeDocumentV2): void;
  reset(): void;
}

export interface CloudHomeRepository {
  pull(): Promise<HomeDocumentV2>;
  push(documentValue: HomeDocumentV2): Promise<void>;
}

export class LocalHomeRepository implements HomeRepository {
  constructor(private readonly storage: Storage) {}

  load(): HomeDocumentV2 {
    const v2Document = this.loadV2();
    if (v2Document) {
      return v2Document;
    }

    const migratedDocument = this.loadMigratedV1();
    if (migratedDocument) {
      this.save(migratedDocument);
      return migratedDocument;
    }

    return createDefaultHomeDocument();
  }

  save(documentValue: HomeDocumentV2): void {
    this.storage.setItem(V2_STORAGE_KEY, JSON.stringify(documentValue));
  }

  reset(): void {
    this.storage.removeItem(V2_STORAGE_KEY);
    this.storage.removeItem(V1_STORAGE_KEY);
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
