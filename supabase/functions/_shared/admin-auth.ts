// Administrator authentication for admin-read. Server-only.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { ADMIN_ROLES, AdminRequestError, type AdminRole } from "./admin-contract.ts";

export interface AuthenticatedAdmin {
  /** admin_users.id */
  adminId: string;
  /** auth.users.id */
  authUserId: string;
  role: AdminRole;
}

/** Thrown when Supabase Auth or the database cannot answer; maps to service_unavailable. */
export class AdminBackendError extends Error {
  constructor(readonly stage: "auth" | "admin_lookup" | "audit" | "query") {
    super(stage);
    this.name = "AdminBackendError";
  }
}

export interface AdminAuthPort {
  /** Returns the verified auth user id for an access token, or null when the token is not valid. */
  verifyAccessToken(accessToken: string): Promise<string | null>;
  /** Returns the enabled administrator for an auth user id, or null when there is none. */
  findEnabledAdmin(authUserId: string): Promise<AuthenticatedAdmin | null>;
}

/** Reads a `Bearer <token>` Authorization header; anything else yields null. */
export function readBearerToken(header: string | null): string | null {
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header?.trim() ?? "");
  return match ? match[1] : null;
}

export function createSupabaseAdminAuth(serviceClient: SupabaseClient): AdminAuthPort {
  return {
    async verifyAccessToken(accessToken) {
      const { data, error } = await serviceClient.auth.getUser(accessToken);
      if (error) {
        // A rate limit says nothing about the token, so it must not read as signed out.
        if (error.status === 429) {
          throw new AdminRequestError("rate_limited");
        }
        // Other 4xx from Auth means the token itself is bad; anything else is an outage.
        if (typeof error.status === "number" && error.status >= 400 && error.status < 500) {
          return null;
        }
        throw new AdminBackendError("auth");
      }

      return data.user?.id ?? null;
    },

    async findEnabledAdmin(authUserId) {
      const { data, error } = await serviceClient
        .from("admin_users")
        .select("id, user_id, role")
        .eq("user_id", authUserId)
        .eq("enabled", true)
        .maybeSingle();
      if (error) {
        throw new AdminBackendError("admin_lookup");
      }

      if (!data || !ADMIN_ROLES.includes(data.role as AdminRole)) {
        return null;
      }

      return { adminId: data.id, authUserId: data.user_id, role: data.role as AdminRole };
    },
  };
}
