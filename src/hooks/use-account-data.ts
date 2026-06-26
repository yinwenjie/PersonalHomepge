"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type {
  AccountPreferences,
  AccountPreferencesUpdateInput,
  AccountProfile,
  HomeSpace,
  RestoredAccountManagedHomeSpaceResult
} from "@/domain/account";
import { getActionErrorMessage } from "@/domain/errors";
import type { HomeDocumentV2 } from "@/domain/home-document";
import type { StoredSyncBinding } from "@/domain/sync-code";
import { AccountRepository } from "@/infrastructure/account-repository";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";

export interface AccountDataState {
  profile: AccountProfile | null;
  preferences: AccountPreferences | null;
  homeSpaces: HomeSpace[];
  loading: boolean;
  error: string;
  claiming: boolean;
  activating: boolean;
  creatingManaged: boolean;
  restoringManaged: boolean;
  migratingManaged: boolean;
  renamingHomeSpace: boolean;
  settingDefaultHomeSpace: boolean;
  removingHomeSpace: boolean;
  updatingPreferences: boolean;
  claimMessage: string;
  claimError: string;
  managedCreateMessage: string;
  managedCreateError: string;
  managedRestoreMessage: string;
  managedRestoreError: string;
  managedMigrationMessage: string;
  managedMigrationError: string;
  homeSpaceMessage: string;
  homeSpaceError: string;
  preferencesMessage: string;
  preferencesError: string;
  activationMessage: string;
  activationError: string;
  refresh: () => Promise<void>;
  claimHomeSpace: (syncSpaceId: string, name: string) => Promise<void>;
  createAccountManagedHomeSpace: (name: string, documentValue: HomeDocumentV2) => Promise<StoredSyncBinding | null>;
  restoreAccountManagedHomeSpace: (homeSpaceId: string) => Promise<RestoredAccountManagedHomeSpaceResult | null>;
  migrateSyncCodeHomeSpaceToAccountManaged: (homeSpaceId: string, binding: StoredSyncBinding) => Promise<StoredSyncBinding | null>;
  markHomeSpaceActive: (homeSpaceId: string) => Promise<boolean>;
  renameHomeSpace: (homeSpaceId: string, name: string) => Promise<boolean>;
  setDefaultHomeSpace: (homeSpaceId: string) => Promise<boolean>;
  removeHomeSpaceFromAccount: (homeSpaceId: string) => Promise<boolean>;
  updatePreferences: (input: AccountPreferencesUpdateInput) => Promise<AccountPreferences | null>;
}

export function useAccountData(user: User | null): AccountDataState {
  const repository = useMemo(() => new AccountRepository(), []);
  const requestIdRef = useRef(0);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [preferences, setPreferences] = useState<AccountPreferences | null>(null);
  const [homeSpaces, setHomeSpaces] = useState<HomeSpace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [activating, setActivating] = useState(false);
  const [creatingManaged, setCreatingManaged] = useState(false);
  const [restoringManaged, setRestoringManaged] = useState(false);
  const [migratingManaged, setMigratingManaged] = useState(false);
  const [renamingHomeSpace, setRenamingHomeSpace] = useState(false);
  const [settingDefaultHomeSpace, setSettingDefaultHomeSpace] = useState(false);
  const [removingHomeSpace, setRemovingHomeSpace] = useState(false);
  const [updatingPreferences, setUpdatingPreferences] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");
  const [claimError, setClaimError] = useState("");
  const [managedCreateMessage, setManagedCreateMessage] = useState("");
  const [managedCreateError, setManagedCreateError] = useState("");
  const [managedRestoreMessage, setManagedRestoreMessage] = useState("");
  const [managedRestoreError, setManagedRestoreError] = useState("");
  const [managedMigrationMessage, setManagedMigrationMessage] = useState("");
  const [managedMigrationError, setManagedMigrationError] = useState("");
  const [homeSpaceMessage, setHomeSpaceMessage] = useState("");
  const [homeSpaceError, setHomeSpaceError] = useState("");
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [preferencesError, setPreferencesError] = useState("");
  const [activationMessage, setActivationMessage] = useState("");
  const [activationError, setActivationError] = useState("");

  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!userId) {
      setProfile(null);
      setPreferences(null);
      setHomeSpaces([]);
      setLoading(false);
      setError("");
      setClaiming(false);
      setActivating(false);
      setCreatingManaged(false);
      setRestoringManaged(false);
      setMigratingManaged(false);
      setRenamingHomeSpace(false);
      setSettingDefaultHomeSpace(false);
      setRemovingHomeSpace(false);
      setUpdatingPreferences(false);
      setClaimMessage("");
      setClaimError("");
      setManagedCreateMessage("");
      setManagedCreateError("");
      setManagedRestoreMessage("");
      setManagedRestoreError("");
      setManagedMigrationMessage("");
      setManagedMigrationError("");
      setHomeSpaceMessage("");
      setHomeSpaceError("");
      setPreferencesMessage("");
      setPreferencesError("");
      setActivationMessage("");
      setActivationError("");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const accountData = await repository.ensureAccountData(userId, userEmail);
      if (requestIdRef.current !== requestId) {
        return;
      }

      setProfile(accountData.profile);
      setPreferences(accountData.preferences);
      setHomeSpaces(accountData.homeSpaces);
    } catch (accountError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      reportAccountDataError(accountError, "account.load");
      setProfile(null);
      setPreferences(null);
      setHomeSpaces([]);
      setError(getActionErrorMessage("账号资料加载失败", accountError));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [repository, userEmail, userId]);

  const claimHomeSpace = useCallback(async (syncSpaceId: string, name: string) => {
    const normalizedName = name.trim();
    if (!userId) {
      setClaimError("请先登录账号。");
      return;
    }

    if (!syncSpaceId) {
      setClaimError("请先创建或绑定同步码。");
      return;
    }

    if (!normalizedName) {
      setClaimError("请输入首页空间名称。");
      return;
    }

    setClaiming(true);
    setClaimMessage("");
    setClaimError("");
    setManagedMigrationMessage("");
    setManagedMigrationError("");
    setHomeSpaceMessage("");
    setHomeSpaceError("");

    try {
      const result = await repository.claimHomeSpace(userId, syncSpaceId, normalizedName);
      const nextHomeSpaces = await repository.listHomeSpaces(userId);
      setHomeSpaces(nextHomeSpaces);
      setClaimMessage(result.status === "created" ? "首页空间已认领。" : "这个首页空间已在账号中。");
    } catch (claimError) {
      reportAccountDataError(claimError, "account.home_space_claim");
      setClaimError(getActionErrorMessage("首页空间认领失败", claimError));
    } finally {
      setClaiming(false);
    }
  }, [repository, userId]);

  const createAccountManagedHomeSpace = useCallback(async (
    name: string,
    documentValue: HomeDocumentV2
  ): Promise<StoredSyncBinding | null> => {
    const normalizedName = name.trim();
    if (!userId) {
      setManagedCreateError("请先登录账号。");
      return null;
    }

    if (!normalizedName) {
      setManagedCreateError("请输入首页空间名称。");
      return null;
    }

    setCreatingManaged(true);
    setManagedCreateMessage("");
    setManagedCreateError("");
    setManagedRestoreMessage("");
    setManagedRestoreError("");
    setManagedMigrationMessage("");
    setManagedMigrationError("");
    setHomeSpaceMessage("");
    setHomeSpaceError("");
    setClaimMessage("");
    setClaimError("");
    setActivationMessage("");
    setActivationError("");

    try {
      const result = await repository.createAccountManagedHomeSpace(userId, normalizedName, documentValue);
      setPreferences(result.preferences);
      setHomeSpaces(result.homeSpaces);
      setManagedCreateMessage("账号托管空间已创建。");
      return result.binding;
    } catch (createError) {
      reportAccountDataError(createError, "account.managed_create");
      setManagedCreateError(getActionErrorMessage("账号托管空间创建失败", createError));
      return null;
    } finally {
      setCreatingManaged(false);
    }
  }, [repository, userId]);

  const restoreAccountManagedHomeSpace = useCallback(async (
    homeSpaceId: string
  ): Promise<RestoredAccountManagedHomeSpaceResult | null> => {
    if (!userId) {
      setManagedRestoreError("请先登录账号。");
      return null;
    }

    if (!homeSpaceId) {
      setManagedRestoreError("请选择账号托管空间。");
      return null;
    }

    setRestoringManaged(true);
    setManagedRestoreMessage("");
    setManagedRestoreError("");
    setManagedCreateMessage("");
    setManagedCreateError("");
    setManagedMigrationMessage("");
    setManagedMigrationError("");
    setHomeSpaceMessage("");
    setHomeSpaceError("");
    setClaimMessage("");
    setClaimError("");
    setActivationMessage("");
    setActivationError("");

    try {
      const result = await repository.restoreAccountManagedHomeSpace(userId, homeSpaceId);
      setPreferences(result.preferences);
      setHomeSpaces(result.homeSpaces);
      setManagedRestoreMessage("账号托管空间已恢复到本机。");
      return result;
    } catch (restoreError) {
      reportAccountDataError(restoreError, "account.managed_restore");
      setManagedRestoreError(getActionErrorMessage("账号托管空间恢复失败", restoreError));
      return null;
    } finally {
      setRestoringManaged(false);
    }
  }, [repository, userId]);

  const migrateSyncCodeHomeSpaceToAccountManaged = useCallback(async (
    homeSpaceId: string,
    binding: StoredSyncBinding
  ): Promise<StoredSyncBinding | null> => {
    if (!userId) {
      setManagedMigrationError("请先登录账号。");
      return null;
    }

    if (!homeSpaceId) {
      setManagedMigrationError("请选择已认领的同步码首页空间。");
      return null;
    }

    if (binding.accessMode !== "sync-code") {
      setManagedMigrationError("当前本机不是普通同步码绑定。");
      return null;
    }

    setMigratingManaged(true);
    setManagedMigrationMessage("");
    setManagedMigrationError("");
    setManagedCreateMessage("");
    setManagedCreateError("");
    setManagedRestoreMessage("");
    setManagedRestoreError("");
    setHomeSpaceMessage("");
    setHomeSpaceError("");
    setClaimMessage("");
    setClaimError("");
    setActivationMessage("");
    setActivationError("");

    try {
      const result = await repository.migrateSyncCodeHomeSpaceToAccountManaged(userId, homeSpaceId, binding);
      setPreferences(result.preferences);
      setHomeSpaces(result.homeSpaces);
      setManagedMigrationMessage(result.status === "migrated" ? "同步码空间已迁移为账号托管。" : "该空间已经是账号托管。");
      return result.binding;
    } catch (migrationError) {
      reportAccountDataError(migrationError, "account.managed_migrate");
      setManagedMigrationError(getActionErrorMessage("账号托管迁移失败", migrationError));
      return null;
    } finally {
      setMigratingManaged(false);
    }
  }, [repository, userId]);

  const markHomeSpaceActive = useCallback(async (homeSpaceId: string): Promise<boolean> => {
    if (!userId) {
      setActivationError("请先登录账号。");
      return false;
    }

    if (!homeSpaceId) {
      setActivationError("请选择首页空间。");
      return false;
    }

    setActivating(true);
    setActivationMessage("");
    setActivationError("");
    setManagedRestoreMessage("");
    setManagedRestoreError("");
    setManagedMigrationMessage("");
    setManagedMigrationError("");
    setHomeSpaceMessage("");
    setHomeSpaceError("");

    try {
      const result = await repository.markHomeSpaceActive(userId, homeSpaceId);
      setPreferences(result.preferences);
      setHomeSpaces(result.homeSpaces);
      setActivationMessage("当前首页空间已更新。");
      return true;
    } catch (activationError) {
      reportAccountDataError(activationError, "account.home_space_activate");
      setActivationError(getActionErrorMessage("首页空间激活失败", activationError));
      return false;
    } finally {
      setActivating(false);
    }
  }, [repository, userId]);

  const renameHomeSpace = useCallback(async (homeSpaceId: string, name: string): Promise<boolean> => {
    const normalizedName = name.trim();
    if (!userId) {
      setHomeSpaceError("请先登录账号。");
      return false;
    }

    if (!homeSpaceId) {
      setHomeSpaceError("请选择首页空间。");
      return false;
    }

    if (!normalizedName) {
      setHomeSpaceError("请输入首页空间名称。");
      return false;
    }

    setRenamingHomeSpace(true);
    setHomeSpaceMessage("");
    setHomeSpaceError("");
    setManagedCreateMessage("");
    setManagedCreateError("");
    setManagedRestoreMessage("");
    setManagedRestoreError("");
    setManagedMigrationMessage("");
    setManagedMigrationError("");
    setClaimMessage("");
    setClaimError("");
    setActivationMessage("");
    setActivationError("");

    try {
      const result = await repository.renameHomeSpace(userId, homeSpaceId, normalizedName);
      setPreferences(result.preferences);
      setHomeSpaces(result.homeSpaces);
      setHomeSpaceMessage("首页空间已重命名。");
      return true;
    } catch (renameError) {
      reportAccountDataError(renameError, "account.home_space_rename");
      setHomeSpaceError(getActionErrorMessage("首页空间重命名失败", renameError));
      return false;
    } finally {
      setRenamingHomeSpace(false);
    }
  }, [repository, userId]);

  const setDefaultHomeSpace = useCallback(async (homeSpaceId: string): Promise<boolean> => {
    if (!userId) {
      setHomeSpaceError("请先登录账号。");
      return false;
    }

    if (!homeSpaceId) {
      setHomeSpaceError("请选择首页空间。");
      return false;
    }

    setSettingDefaultHomeSpace(true);
    setHomeSpaceMessage("");
    setHomeSpaceError("");
    setManagedCreateMessage("");
    setManagedCreateError("");
    setManagedRestoreMessage("");
    setManagedRestoreError("");
    setManagedMigrationMessage("");
    setManagedMigrationError("");
    setClaimMessage("");
    setClaimError("");
    setActivationMessage("");
    setActivationError("");

    try {
      const result = await repository.setDefaultHomeSpace(userId, homeSpaceId);
      setPreferences(result.preferences);
      setHomeSpaces(result.homeSpaces);
      setHomeSpaceMessage("默认首页空间已更新。");
      return true;
    } catch (defaultError) {
      reportAccountDataError(defaultError, "account.home_space_set_default");
      setHomeSpaceError(getActionErrorMessage("默认首页空间更新失败", defaultError));
      return false;
    } finally {
      setSettingDefaultHomeSpace(false);
    }
  }, [repository, userId]);

  const removeHomeSpaceFromAccount = useCallback(async (homeSpaceId: string): Promise<boolean> => {
    if (!userId) {
      setHomeSpaceError("请先登录账号。");
      return false;
    }

    if (!homeSpaceId) {
      setHomeSpaceError("请选择首页空间。");
      return false;
    }

    setRemovingHomeSpace(true);
    setHomeSpaceMessage("");
    setHomeSpaceError("");
    setManagedCreateMessage("");
    setManagedCreateError("");
    setManagedRestoreMessage("");
    setManagedRestoreError("");
    setManagedMigrationMessage("");
    setManagedMigrationError("");
    setClaimMessage("");
    setClaimError("");
    setActivationMessage("");
    setActivationError("");

    try {
      const result = await repository.removeHomeSpaceFromAccount(userId, homeSpaceId);
      setPreferences(result.preferences);
      setHomeSpaces(result.homeSpaces);
      setHomeSpaceMessage("首页空间已从账号移除；底层同步空间未删除、未废弃。");
      return true;
    } catch (removeError) {
      reportAccountDataError(removeError, "account.home_space_remove");
      setHomeSpaceError(getActionErrorMessage("首页空间移除失败", removeError));
      return false;
    } finally {
      setRemovingHomeSpace(false);
    }
  }, [repository, userId]);

  const updatePreferences = useCallback(async (input: AccountPreferencesUpdateInput): Promise<AccountPreferences | null> => {
    if (!userId) {
      setPreferencesError("请先登录账号。");
      return null;
    }

    setUpdatingPreferences(true);
    setPreferencesMessage("");
    setPreferencesError("");

    try {
      const result = await repository.updatePreferences(userId, input);
      setPreferences(result);
      setPreferencesMessage("账号偏好已保存。");
      return result;
    } catch (preferencesUpdateError) {
      reportAccountDataError(preferencesUpdateError, "account.preferences_update");
      setPreferencesError(getActionErrorMessage("账号偏好保存失败", preferencesUpdateError));
      return null;
    } finally {
      setUpdatingPreferences(false);
    }
  }, [repository, userId]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [refresh]);

  const accountLoadedForUser = Boolean(
    userId
      && profile?.id === userId
      && preferences?.userId === userId
  );
  const effectiveLoading = loading || Boolean(userId && !accountLoadedForUser && !error);

  return {
    profile: accountLoadedForUser ? profile : null,
    preferences: accountLoadedForUser ? preferences : null,
    homeSpaces: accountLoadedForUser ? homeSpaces : [],
    loading: effectiveLoading,
    error,
    claiming,
    activating,
    creatingManaged,
    restoringManaged,
    migratingManaged,
    renamingHomeSpace,
    settingDefaultHomeSpace,
    removingHomeSpace,
    updatingPreferences,
    claimMessage,
    claimError,
    managedCreateMessage,
    managedCreateError,
    managedRestoreMessage,
    managedRestoreError,
    managedMigrationMessage,
    managedMigrationError,
    homeSpaceMessage,
    homeSpaceError,
    preferencesMessage,
    preferencesError,
    activationMessage,
    activationError,
    refresh,
    claimHomeSpace,
    createAccountManagedHomeSpace,
    restoreAccountManagedHomeSpace,
    migrateSyncCodeHomeSpaceToAccountManaged,
    markHomeSpaceActive,
    renameHomeSpace,
    setDefaultHomeSpace,
    removeHomeSpaceFromAccount,
    updatePreferences
  };
}

function reportAccountDataError(error: unknown, operation: string): void {
  captureClientError(error, {
    eventType: "async_operation_failed",
    operation,
    properties: {
      source: "use-account-data"
    },
    severity: "error"
  });
}
