"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { AccountPreferences, AccountProfile, HomeSpace } from "@/domain/account";
import { getActionErrorMessage } from "@/domain/errors";
import type { HomeDocumentV2 } from "@/domain/home-document";
import type { StoredSyncBinding } from "@/domain/sync-code";
import { AccountRepository } from "@/infrastructure/account-repository";

export interface AccountDataState {
  profile: AccountProfile | null;
  preferences: AccountPreferences | null;
  homeSpaces: HomeSpace[];
  loading: boolean;
  error: string;
  claiming: boolean;
  activating: boolean;
  creatingManaged: boolean;
  claimMessage: string;
  claimError: string;
  managedCreateMessage: string;
  managedCreateError: string;
  activationMessage: string;
  activationError: string;
  refresh: () => Promise<void>;
  claimHomeSpace: (syncSpaceId: string, name: string) => Promise<void>;
  createAccountManagedHomeSpace: (name: string, documentValue: HomeDocumentV2) => Promise<StoredSyncBinding | null>;
  markHomeSpaceActive: (homeSpaceId: string) => Promise<boolean>;
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
  const [claimMessage, setClaimMessage] = useState("");
  const [claimError, setClaimError] = useState("");
  const [managedCreateMessage, setManagedCreateMessage] = useState("");
  const [managedCreateError, setManagedCreateError] = useState("");
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
      setClaimMessage("");
      setClaimError("");
      setManagedCreateMessage("");
      setManagedCreateError("");
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

    try {
      const result = await repository.claimHomeSpace(userId, syncSpaceId, normalizedName);
      const nextHomeSpaces = await repository.listHomeSpaces(userId);
      setHomeSpaces(nextHomeSpaces);
      setClaimMessage(result.status === "created" ? "首页空间已认领。" : "这个首页空间已在账号中。");
    } catch (claimError) {
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
      setManagedCreateError(getActionErrorMessage("账号托管空间创建失败", createError));
      return null;
    } finally {
      setCreatingManaged(false);
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

    try {
      const result = await repository.markHomeSpaceActive(userId, homeSpaceId);
      setPreferences(result.preferences);
      setHomeSpaces(result.homeSpaces);
      setActivationMessage("当前首页空间已更新。");
      return true;
    } catch (activationError) {
      setActivationError(getActionErrorMessage("首页空间激活失败", activationError));
      return false;
    } finally {
      setActivating(false);
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
    claimMessage,
    claimError,
    managedCreateMessage,
    managedCreateError,
    activationMessage,
    activationError,
    refresh,
    claimHomeSpace,
    createAccountManagedHomeSpace,
    markHomeSpaceActive
  };
}
