import type { StoredSyncBinding } from "@/domain/sync-code";
import type { HomeDocumentV2 } from "@/domain/home-document";
import type {
  DensityPreference,
  FontFamilyPreference,
  LocalePreference,
  SearchEnginePreference,
  ThemePreference,
  UiPreferences
} from "@/domain/ui-preferences";

export type HomeSpaceAccessMode = "sync-code" | "account-managed" | "password-protected";

export interface AccountProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountPreferences {
  userId: string;
  locale: LocalePreference;
  themePreference: ThemePreference;
  fontFamily: FontFamilyPreference;
  density: DensityPreference;
  defaultSearchEngine: SearchEnginePreference;
  defaultSpaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AccountPreferencesUpdateInput = UiPreferences;

export interface HomeSpace {
  id: string;
  userId: string;
  syncSpaceId: string;
  accessMode: HomeSpaceAccessMode;
  name: string;
  isDefault: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountData {
  profile: AccountProfile;
  preferences: AccountPreferences;
  homeSpaces: HomeSpace[];
}

export type ClaimHomeSpaceResult =
  | { status: "created"; homeSpace: HomeSpace }
  | { status: "already-claimed"; homeSpace: HomeSpace };

export interface ActivatedHomeSpaceResult {
  preferences: AccountPreferences;
  homeSpaces: HomeSpace[];
}

export interface CreatedAccountManagedHomeSpaceResult extends ActivatedHomeSpaceResult {
  homeSpace: HomeSpace;
  binding: StoredSyncBinding;
}

export interface RestoredAccountManagedHomeSpaceResult extends ActivatedHomeSpaceResult {
  homeSpace: HomeSpace;
  binding: StoredSyncBinding;
  document: HomeDocumentV2;
}

export interface MigratedAccountManagedHomeSpaceResult extends ActivatedHomeSpaceResult {
  status: "migrated" | "already-managed";
  homeSpace: HomeSpace;
  binding: StoredSyncBinding;
}
