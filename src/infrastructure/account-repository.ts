import type {
  AccountData,
  AccountPreferences,
  AccountProfile,
  ActivatedHomeSpaceResult,
  ClaimHomeSpaceResult,
  CreatedAccountManagedHomeSpaceResult,
  MigratedAccountManagedHomeSpaceResult,
  RestoredAccountManagedHomeSpaceResult,
  HomeSpaceAccessMode,
  HomeSpace
} from "@/domain/account";
import type { HomeDocumentV2 } from "@/domain/home-document";
import { createSyncSecrets, SYNC_CODE_VERSION, type StoredSyncBinding } from "@/domain/sync-code";
import { encryptHomeDocument, type EncryptedHomeDocument } from "@/infrastructure/sync-crypto";
import { SyncCodeRepository } from "@/infrastructure/sync-code-repository";
import { getSupabaseBrowserClient } from "@/infrastructure/supabase-client";

const PROFILE_SELECT = "id, email, display_name, created_at, updated_at";
const PREFERENCES_SELECT = "user_id, locale, theme_preference, default_space_id, created_at, updated_at";
const HOME_SPACE_SELECT = "id, user_id, sync_space_id, access_mode, name, is_default, last_used_at, created_at, updated_at";
const HOME_SPACE_CREDENTIAL_SELECT = "access_token, encryption_key";

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

interface MigrateSyncCodeHomeSpaceRow {
  status: "migrated" | "already-managed";
  home_space_id: string;
  sync_space_id: string;
  access_mode: "account-managed";
  updated_at: string;
}

interface HomeSpaceCredentialRow {
  access_token: string;
  encryption_key: string;
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

  async restoreAccountManagedHomeSpace(
    userId: string,
    homeSpaceId: string
  ): Promise<RestoredAccountManagedHomeSpaceResult> {
    const homeSpace = await this.getHomeSpaceById(userId, homeSpaceId);
    if (!homeSpace) {
      throw new Error("首页空间不存在或不属于当前账号");
    }

    if (homeSpace.accessMode !== "account-managed") {
      throw new Error("该首页空间不是账号托管空间，仍需完整同步码激活");
    }

    const credential = await this.getActiveManagedCredential(userId, homeSpaceId);
    const pulled = await new SyncCodeRepository().pull({
      spaceId: homeSpace.syncSpaceId,
      accessToken: credential.access_token,
      encryptionKey: credential.encryption_key
    });
    const activated = await this.markHomeSpaceActive(userId, homeSpaceId);
    const activatedHomeSpace = activated.homeSpaces.find((candidate) => candidate.id === homeSpaceId);
    if (!activatedHomeSpace) {
      throw new Error("账号托管空间恢复后未能读取空间列表");
    }

    return {
      ...activated,
      homeSpace: activatedHomeSpace,
      document: pulled.document,
      binding: {
        version: SYNC_CODE_VERSION,
        accessMode: "account-managed",
        spaceId: homeSpace.syncSpaceId,
        accessToken: credential.access_token,
        encryptionKey: credential.encryption_key,
        remoteRevision: pulled.revision,
        lastSyncedAt: pulled.updatedAt,
        lastSyncedDocumentRevision: pulled.document.revision,
        lastSyncedDocumentUpdatedAt: pulled.document.updatedAt
      }
    };
  }

  async migrateSyncCodeHomeSpaceToAccountManaged(
    userId: string,
    homeSpaceId: string,
    binding: StoredSyncBinding
  ): Promise<MigratedAccountManagedHomeSpaceResult> {
    if (binding.accessMode !== "sync-code") {
      throw new Error("当前本机不是普通同步码绑定");
    }

    const homeSpace = await this.getHomeSpaceById(userId, homeSpaceId);
    if (!homeSpace) {
      throw new Error("首页空间不存在或不属于当前账号");
    }

    if (homeSpace.syncSpaceId !== binding.spaceId) {
      throw new Error("当前同步码不属于所选首页空间");
    }

    if (homeSpace.accessMode !== "sync-code" && homeSpace.accessMode !== "account-managed") {
      throw new Error("该首页空间不能迁移为账号托管");
    }

    const pulled = await new SyncCodeRepository().pull(binding);
    if (pulled.revision !== binding.remoteRevision || pulled.updatedAt !== binding.lastSyncedAt) {
      throw new Error("云端首页已有更新，请先拉取云端后再迁移");
    }

    const row = await rpcSingle<MigrateSyncCodeHomeSpaceRow>("migrate_sync_code_home_space_to_account_managed", {
      p_home_space_id: homeSpaceId,
      p_access_token: binding.accessToken,
      p_encryption_key: binding.encryptionKey
    });
    const activated = await this.markHomeSpaceActive(userId, row.home_space_id);
    const migratedHomeSpace = activated.homeSpaces.find((candidate) => candidate.id === row.home_space_id);
    if (!migratedHomeSpace) {
      throw new Error("首页空间迁移后未能读取空间列表");
    }

    return {
      ...activated,
      status: row.status,
      homeSpace: migratedHomeSpace,
      binding: {
        ...binding,
        accessMode: "account-managed",
        spaceId: row.sync_space_id,
        remoteRevision: pulled.revision,
        lastSyncedAt: pulled.updatedAt,
        lastSyncedDocumentRevision: pulled.document.revision,
        lastSyncedDocumentUpdatedAt: pulled.document.updatedAt
      }
    };
  }

  async markHomeSpaceActive(userId: string, homeSpaceId: string): Promise<ActivatedHomeSpaceResult> {
    await rpcVoid("activate_home_space", { p_home_space_id: homeSpaceId });

    return this.getHomeSpaceState(userId);
  }

  async renameHomeSpace(userId: string, homeSpaceId: string, name: string): Promise<ActivatedHomeSpaceResult> {
    await rpcVoid("rename_home_space", {
      p_home_space_id: homeSpaceId,
      p_name: name.trim()
    });

    return this.getHomeSpaceState(userId);
  }

  async setDefaultHomeSpace(userId: string, homeSpaceId: string): Promise<ActivatedHomeSpaceResult> {
    await rpcVoid("set_default_home_space", { p_home_space_id: homeSpaceId });

    return this.getHomeSpaceState(userId);
  }

  async removeHomeSpaceFromAccount(userId: string, homeSpaceId: string): Promise<ActivatedHomeSpaceResult> {
    await rpcVoid("remove_home_space_from_account", { p_home_space_id: homeSpaceId });

    return this.getHomeSpaceState(userId);
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

  private async getHomeSpaceById(userId: string, homeSpaceId: string): Promise<HomeSpace | null> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("home_spaces")
      .select(HOME_SPACE_SELECT)
      .eq("user_id", userId)
      .eq("id", homeSpaceId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapHomeSpace(data as HomeSpaceRow) : null;
  }

  private async getActiveManagedCredential(userId: string, homeSpaceId: string): Promise<HomeSpaceCredentialRow> {
    const { data, error } = await getSupabaseBrowserClient()
      .from("home_space_credentials")
      .select(HOME_SPACE_CREDENTIAL_SELECT)
      .eq("user_id", userId)
      .eq("home_space_id", homeSpaceId)
      .eq("credential_type", "sync-space-v1")
      .is("revoked_at", null)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error("账号托管凭证不存在或已撤销");
    }

    return data as HomeSpaceCredentialRow;
  }

  private async getHomeSpaceState(userId: string): Promise<ActivatedHomeSpaceResult> {
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

async function rpcVoid(functionName: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabaseBrowserClient().rpc(functionName, args);

  if (error) {
    throw error;
  }
}

function toRpcEncryptedDocument(encryptedDocument: EncryptedHomeDocument) {
  return {
    p_document_ciphertext: encryptedDocument.documentCiphertext,
    p_document_iv: encryptedDocument.documentIv,
    p_document_salt: encryptedDocument.documentSalt,
    p_document_schema_version: encryptedDocument.documentSchemaVersion
  };
}
