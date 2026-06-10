import type { AccountData, AccountPreferences, AccountProfile } from "@/domain/account";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase-client";

const PROFILE_SELECT = "id, email, display_name, created_at, updated_at";
const PREFERENCES_SELECT = "user_id, locale, theme_preference, default_space_id, created_at, updated_at";

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface PreferencesRow {
  user_id: string;
  locale: string;
  theme_preference: string;
  default_space_id: string | null;
  created_at: string;
  updated_at: string;
}

export class AccountRepository {
  async ensureAccountData(userId: string, email: string | null): Promise<AccountData> {
    const profile = await this.ensureProfile(userId, email);
    const preferences = await this.ensurePreferences(userId);

    return {
      profile,
      preferences
    };
  }

  private async ensureProfile(userId: string, email: string | null): Promise<AccountProfile> {
    const existingProfile = await this.getProfile(userId);
    if (existingProfile) {
      if (email && existingProfile.email !== email) {
        return this.updateProfileEmail(userId, email);
      }

      return existingProfile;
    }

    return this.insertProfile(userId, email);
  }

  private async getProfile(userId: string): Promise<AccountProfile | null> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapProfile(data as ProfileRow) : null;
  }

  private async insertProfile(userId: string, email: string | null): Promise<AccountProfile> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("profiles")
      .insert({ id: userId, email })
      .select(PROFILE_SELECT)
      .single();

    if (!error && data) {
      return mapProfile(data as ProfileRow);
    }

    const existingProfile = await this.getProfile(userId);
    if (existingProfile) {
      if (email && existingProfile.email !== email) {
        return this.updateProfileEmail(userId, email);
      }

      return existingProfile;
    }

    throw error ?? new Error("账号资料初始化失败");
  }

  private async updateProfileEmail(userId: string, email: string): Promise<AccountProfile> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("profiles")
      .update({ email })
      .eq("id", userId)
      .select(PROFILE_SELECT)
      .single();

    if (error) {
      throw error;
    }

    return mapProfile(data as ProfileRow);
  }

  private async ensurePreferences(userId: string): Promise<AccountPreferences> {
    const existingPreferences = await this.getPreferences(userId);
    if (existingPreferences) {
      return existingPreferences;
    }

    return this.insertPreferences(userId);
  }

  private async getPreferences(userId: string): Promise<AccountPreferences | null> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("account_preferences")
      .select(PREFERENCES_SELECT)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapPreferences(data as PreferencesRow) : null;
  }

  private async insertPreferences(userId: string): Promise<AccountPreferences> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("account_preferences")
      .insert({ user_id: userId })
      .select(PREFERENCES_SELECT)
      .single();

    if (!error && data) {
      return mapPreferences(data as PreferencesRow);
    }

    const existingPreferences = await this.getPreferences(userId);
    if (existingPreferences) {
      return existingPreferences;
    }

    throw error ?? new Error("账号偏好初始化失败");
  }
}

function mapProfile(row: ProfileRow): AccountProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPreferences(row: PreferencesRow): AccountPreferences {
  return {
    userId: row.user_id,
    locale: row.locale,
    themePreference: row.theme_preference,
    defaultSpaceId: row.default_space_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
