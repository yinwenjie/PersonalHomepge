// Append-only administrator audit for admin-read. Server-only.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import type { AuthenticatedAdmin } from "./admin-auth.ts";
import { ADMIN_API_VERSION, type AdminAuditAction } from "./admin-contract.ts";

/** Low-sensitivity metadata allowed by admin_audit_events_metadata_keys_valid. */
export interface AdminAuditMetadata {
  page_direction?: "initial" | "next" | "previous";
  access_mode?: "sync-code" | "account-managed" | "password-protected";
  result_status?: "ok" | "empty";
}

export interface AdminAuditEntry {
  requestId: string;
  admin: AuthenticatedAdmin;
  action: AdminAuditAction;
  severity: "info" | "warning" | "danger";
  reason: string;
  targetUserId?: string | null;
  targetHomeSpaceId?: string | null;
  targetSyncSpaceId?: string | null;
  targetSnapshotId?: string | null;
  resultCount?: number | null;
  metadata?: AdminAuditMetadata;
}

export interface AdminAuditPort {
  /** Inserts one audit row. Rejects when the row was not stored; callers must fail closed. */
  record(entry: AdminAuditEntry): Promise<void>;
}

export function toAuditRow(entry: AdminAuditEntry): Record<string, unknown> {
  return {
    request_id: entry.requestId,
    admin_user_id: entry.admin.adminId,
    admin_auth_user_id: entry.admin.authUserId,
    admin_role: entry.admin.role,
    action: entry.action,
    severity: entry.severity,
    reason: entry.reason,
    target_user_id: entry.targetUserId ?? null,
    target_home_space_id: entry.targetHomeSpaceId ?? null,
    target_sync_space_id: entry.targetSyncSpaceId ?? null,
    target_snapshot_id: entry.targetSnapshotId ?? null,
    result_count: entry.resultCount ?? null,
    metadata: { api_version: ADMIN_API_VERSION, ...entry.metadata },
  };
}

export function createSupabaseAdminAudit(serviceClient: SupabaseClient): AdminAuditPort {
  return {
    async record(entry) {
      const { error } = await serviceClient.from("admin_audit_events").insert(toAuditRow(entry));
      if (error) {
        throw new Error("admin audit insert failed");
      }
    },
  };
}
