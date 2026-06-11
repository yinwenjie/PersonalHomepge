import type {
  AccountData,
  AccountPreferences,
  AccountProfile,
  ActivatedHomeSpaceResult,
  ClaimHomeSpaceResult,
  CreatedAccountManagedHomeSpaceResult,
  HomeSpaceAccessMode,
  HomeSpace
} from "@/domain/account";
import type { HomeDocumentV2 } from "@/domain/home-document";
import { createSyncSecrets, SYNC_CODE_VERSION } from "@/domain/sync-code";
import { encryptHomeDocument, type EncryptedHomeDocument } from "@/infrastructure/sync-crypto";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase-client";

const PROFILE_SELECT = "id, email, display_name, created_at, updated_at";
const PREFERENCES_SELECT = "user_id, locale, theme_preference, default_space_id, created_at, updated_at";
const HOME_SPACE_SELECT = "id, user_id, sync_space_id, access_mode, name, is_default, last_used_at, created_at, updated_at";

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

interface HomeSpaceRow {
  id: string;
  user_id: string;
  sync_space_id: string;
  access_mode: HomeSpaceAccessMode;
  name: string;
  is_default: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateAccountManagedHomeSpaceRow {
  home_space_id: string;
  sync_space_id: string;
  revision: number;
  updated_at: string;
}

export class AccountRepository {
  async ensureAccountData(userId: string, email: string | null): Promise<AccountData> {
    const profile = await this.ensureProfile(userId, email);
    const preferences = await this.ensurePreferences(userId);
    const homeSpaces = await this.listHomeSpaces(userId);

    return {
      profile,
      preferences,
      homeSpaces
    };
  }

  async listHomeSpaces(userId: string): Promise<HomeSpace[]> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("home_spaces")
      .select(HOME_SPACE_SELECT)
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as HomeSpaceRow[]).map(mapHomeSpace);
  }

  async claimHomeSpace(userId: string, syncSpaceId: string, name: string): Promise<ClaimHomeSpaceResult> {
    const existingHomeSpace = await this.getHomeSpaceBySyncSpace(userId, syncSpaceId);
    if (existingHomeSpace) {
      return {
        status: "already-claimed",
        homeSpace: existingHomeSpace
      };
    }

    const { data, error } = await getSupabaseBrowserClient()
      .from("home_spaces")
      .insert({
        user_id: userId,
        sync_space_id: syncSpaceId,
        name: name.trim()
      })
      .select(HOME_SPACE_SELECT)
      .single();

    if (!error && data) {
      return {
        status: "created",
        homeSpace: mapHomeSpace(data as HomeSpaceRow)
      };
    }

    const homeSpaceAfterConflict = await this.getHomeSpaceBySyncSpace(userId, syncSpaceId);
    if (homeSpaceAfterConflict) {
      return {
        status: "already-claimed",
        homeSpace: homeSpaceAfterConflict
      };
    }

    throw error ?? new Error("首页空间认领失败");
  }

  async createAccountManagedHomeSpace(
    userId: string,
    name: string,
    documentValue: HomeDocumentV2
  ): Promise<CreatedAccountManagedHomeSpaceResult> {
    const secrets = createSyncSecrets();
    const encryptedDocument = await encryptHomeDocument(documentValue, secrets.encryptionKey);
    const row = await rpcSingle<CreateAccountManagedHomeSpaceRow>("create_account_managed_home_space", {
      p_name: name.trim(),
      p_access_token: secrets.accessToken,
      p_encryption_key: secrets.encryptionKey,
      ...toRpcEncryptedDocument(encryptedDocument)
    });

    const activated = await this.markHomeSpaceActive(userId, row.home_space_id);
    const homeSpace = activated.homeSpaces.find((candidate) => candidate.id === row.home_space_id);
    if (!homeSpace) {
      throw new Error("账号托管空间创建后未能读取空间列表");
    }

    return {
      ...activated,
      homeSpace,
      binding: {
        version: SYNC_CODE_VERSION,
        accessMode: "account-managed",
        spaceId: row.sync_space_id,
        accessToken: secrets.accessToken,
        encryptionKey: secrets.encryptionKey,
        remoteRevision: row.revision,
        lastSyncedAt: row.updated_at,
        lastSyncedDocumentRevision: documentValue.revision,
        lastSyncedDocumentUpdatedAt: documentValue.updatedAt
      }
    };
  }

  async markHomeSpaceActive(userId: string, homeSpaceId: string): Promise<ActivatedHomeSpaceResult> {
    const { error } = await getSupabaseBrowserClient()
      .rpc("activate_home_space", { p_home_space_id: homeSpaceId });

    if (error) {
      throw error;
    }

    const preferences = await this.getPreferences(userId);
    if (!preferences) {
      throw new Error("账号偏好更新失败");
    }

    const homeSpaces = await this.listHomeSpaces(userId);

    return {
      preferences,
      homeSpaces
    };
  }

  private async getHomeSpaceBySyncSpace(userId: string, syncSpaceId: string): Promise<HomeSpace | null> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("home_spaces")
      .select(HOME_SPACE_SELECT)
      .eq("user_id", userId)
      .eq("sync_space_id", syncSpaceId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapHomeSpace(data as HomeSpaceRow) : null;
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

function mapHomeSpace(row: HomeSpaceRow): HomeSpace {
  return {
    id: row.id,
    userId: row.user_id,
    syncSpaceId: row.sync_space_id,
    accessMode: row.access_mode,
    name: row.name,
    isDefault: row.is_default,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function rpcSingle<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(functionName, args);

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`Unexpected RPC response from ${functionName}`);
  }

  return data[0] as T;
}

function toRpcEncryptedDocument(encryptedDocument: EncryptedHomeDocument) {
  return {
    p_document_ciphertext: encryptedDocument.documentCiphertext,
    p_document_iv: encryptedDocument.documentIv,
    p_document_salt: encryptedDocument.documentSalt,
    p_document_schema_version: encryptedDocument.documentSchemaVersion
  };
}
