export interface AccountProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountPreferences {
  userId: string;
  locale: string;
  themePreference: string;
  defaultSpaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomeSpace {
  id: string;
  userId: string;
  syncSpaceId: string;
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
