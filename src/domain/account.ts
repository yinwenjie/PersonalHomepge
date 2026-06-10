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

export interface AccountData {
  profile: AccountProfile;
  preferences: AccountPreferences;
}
