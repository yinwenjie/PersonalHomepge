"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { SupabaseAuthContext, type SupabaseAuthState } from "@/contexts/supabase-auth-context";
import { getErrorMessage } from "@/domain/errors";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  SUPABASE_CONFIGURATION_MESSAGE
} from "@/infrastructure/supabase-client";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

interface SupabaseAuthProviderProps {
  children: ReactNode;
}

export function SupabaseAuthProvider({ children }: SupabaseAuthProviderProps) {
  const configured = useMemo(() => isSupabaseConfigured(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const [actionPending, setActionPending] = useState(false);
  const [message, setMessage] = useState(configured ? "" : SUPABASE_CONFIGURATION_MESSAGE);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    if (!configured) {
      return () => {
        mounted = false;
      };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: subscriptionData } = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (!mounted) {
          return;
        }

        setSession(nextSession);
        setLoading(false);
        if (nextSession?.user) {
          setMessage("账号已登录。");
          setError("");
        }
        if (event === "SIGNED_IN") {
          trackProductEvent("auth.signed_in", {
            result: "success"
          });
        }
      });

      supabase.auth.getSession().then(({ data, error: sessionError }) => {
        if (!mounted) {
          return;
        }

        if (sessionError) {
          setError(sessionError.message);
        }

        setSession(data.session);
        setLoading(false);
      });

      return () => {
        mounted = false;
        subscriptionData.subscription.unsubscribe();
      };
    } catch (authError) {
      const message = getErrorMessage(authError, "账号服务暂时不可用。");
      const timerId = window.setTimeout(() => {
        if (!mounted) {
          return;
        }

        setError(message);
        setLoading(false);
      }, 0);

      return () => {
        mounted = false;
        window.clearTimeout(timerId);
      };
    }
  }, [configured]);

  const signInWithMagicLink = useCallback(async (email: string) => {
    if (!configured) {
      setMessage(SUPABASE_CONFIGURATION_MESSAGE);
      setError("");
      return;
    }

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("请输入邮箱地址。");
      return;
    }

    setActionPending(true);
    setMessage("");
    setError("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
          shouldCreateUser: true
        }
      });

      if (signInError) {
        setError(signInError.message);
        trackProductEvent("auth.magic_link_failed", {
          reasonCode: "provider-error"
        });
        return;
      }

      setMessage("登录链接已发送，请打开邮件完成登录。");
      trackProductEvent("auth.magic_link_requested", {
        result: "success"
      });
    } catch (authError) {
      setError(getErrorMessage(authError, "账号服务暂时不可用。"));
      trackProductEvent("auth.magic_link_failed", {
        reasonCode: "exception"
      });
    } finally {
      setActionPending(false);
    }
  }, [configured]);

  const signOut = useCallback(async () => {
    if (!configured) {
      setSession(null);
      setMessage(SUPABASE_CONFIGURATION_MESSAGE);
      setError("");
      return;
    }

    setActionPending(true);
    setMessage("");
    setError("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setError(signOutError.message);
        return;
      }

      setSession(null);
      setMessage("已退出账号。本地首页数据不会被删除。");
      trackProductEvent("auth.signed_out", {
        result: "success"
      });
    } catch (authError) {
      setError(getErrorMessage(authError, "账号服务暂时不可用。"));
    } finally {
      setActionPending(false);
    }
  }, [configured]);

  const value = useMemo<SupabaseAuthState>(() => ({
    user: session?.user ?? null,
    session,
    configured,
    loading,
    actionPending,
    message,
    error,
    signInWithMagicLink,
    signOut
  }), [actionPending, configured, error, loading, message, session, signInWithMagicLink, signOut]);

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
}

function getAuthRedirectUrl(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  return url.toString();
}
