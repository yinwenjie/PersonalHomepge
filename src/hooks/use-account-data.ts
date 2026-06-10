"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { AccountPreferences, AccountProfile } from "@/domain/account";
import { AccountRepository } from "@/infrastructure/account-repository";

export interface AccountDataState {
  profile: AccountProfile | null;
  preferences: AccountPreferences | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

export function useAccountData(user: User | null): AccountDataState {
  const repository = useMemo(() => new AccountRepository(), []);
  const requestIdRef = useRef(0);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [preferences, setPreferences] = useState<AccountPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!userId) {
      setProfile(null);
      setPreferences(null);
      setLoading(false);
      setError("");
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
    } catch (accountError) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setProfile(null);
      setPreferences(null);
      setError(getErrorMessage(accountError));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [repository, userEmail, userId]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [refresh]);

  return {
    profile,
    preferences,
    loading,
    error,
    refresh
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "账号资料加载失败。";
}
